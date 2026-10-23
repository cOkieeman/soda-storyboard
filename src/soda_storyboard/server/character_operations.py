"""Planned, version-checked identity changes with durable inverse transactions."""

from __future__ import annotations

import base64
import json
import os
import time
import uuid
from typing import TYPE_CHECKING

from soda_storyboard.character_references import rewrite_document
from soda_storyboard.io import write_json
from soda_storyboard.lora import select_lora
from soda_storyboard.models import Character, Page
from soda_storyboard.persistence import file_snapshot, page_lock
from soda_storyboard.production.errors import ProductionError
from soda_storyboard.validation import validate_page

from .characters import NEW_ID, RESERVED_IDS, patch_character
from .common import APIError, snapshot

if TYPE_CHECKING:
    from pathlib import Path

    from .store import Store

# Raw JSON is preserved, and diagnostics follow the editor's Chinese API.
# ruff: noqa: RUF001


def encode(value: bytes | None) -> str | None:
    return None if value is None else base64.b64encode(value).decode("ascii")


def decode(value: str | None) -> bytes | None:
    return None if value is None else base64.b64decode(value)


def json_bytes(value: dict) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode()


class CharacterOperations:
    def __init__(self, store: Store) -> None:
        self.store = store
        self.plans: dict[str, dict] = {}
        self.recover()

    def directory(self) -> Path:
        return self.store.path(".soda/character-operations")

    def scan(self) -> dict[str, tuple[dict, str]]:
        """Bind plans to all active JSON, including new pages and exported documents."""
        result = {}
        for directory, children, names in os.walk(self.store.root, followlinks=False):
            children[:] = [name for name in children if not name.startswith(".")]
            for name in names:
                if not name.endswith(".json"):
                    continue
                from pathlib import Path  # noqa: PLC0415 -- runtime walk paths

                relative = (Path(directory) / name).relative_to(self.store.root).as_posix()
                try:
                    result[relative] = snapshot(self.store.path(relative))
                except (OSError, ValueError, TypeError, APIError) as exc:
                    raise APIError(
                        409, f"无法扫描项目文件：{relative}", reason="reference_scan_failed"
                    ) from exc
        return result

    def references(self, identifier: str) -> dict:
        _, card, version = self.store.character_store.locate(identifier)
        references = []
        for path, (raw, _) in self.scan().items():
            if path.startswith("characters/"):
                continue
            _, found = rewrite_document(raw, identifier, identifier, card)
            references.extend({"path": path, **reference} for reference in found)
        return {"references": references, "version": version}

    def plan(self, identifier: str, options: dict, expected: str | None) -> dict:  # noqa: C901, PLR0912, PLR0915
        with self.store.lock, page_lock(self.store.path("project.json")):
            source_path, card, _ = self.store.character_store.match(identifier, expected)
            action = options.get("action")
            if action not in {"rename", "rename_id", "delete"}:
                raise APIError(400, "action 必须为 rename、rename_id 或 delete", reason="invalid_action")
            mode = options.get("mode", "block")
            if mode not in {"block", "replace", "anonymous"}:
                raise APIError(400, "mode 必须为 block、replace 或 anonymous", reason="invalid_delete_mode")
            target = identifier
            replacement = None
            entries, diagnostics = self.store.character_store.index()
            if any(item["code"] != "character_filename_mismatch" for item in diagnostics):
                raise APIError(
                    409, "请先修复角色目录诊断", reason="character_catalog_invalid", diagnostics=diagnostics
                )
            if action == "rename_id":
                target = options.get("new_id")
                if not isinstance(target, str) or not NEW_ID.fullmatch(target) or target in RESERVED_IDS:
                    raise APIError(400, "新 ID 格式错误或使用了保留字", reason="invalid_character_id")
                if target == identifier:
                    raise APIError(400, "新 ID 与原 ID 相同", reason="unchanged_character_id")
                occupied = {key.casefold() for key in entries} | {
                    path.stem.casefold() for path in source_path.parent.glob("*.json")
                }
                if target.casefold() in occupied:
                    raise APIError(409, "新 ID 已占用", reason="character_id_exists")
            elif action == "delete":
                target = options.get("replacement_id") if mode == "replace" else None
                if mode == "replace":
                    if not isinstance(target, str) or target == identifier:
                        raise APIError(400, "请选择另一个替换角色", reason="invalid_replacement")
                    _, replacement, _ = self.store.character_store.locate(target)

            scanned = self.scan()
            changes = {}
            references = []
            lora_changes = []
            characters = {key: Character.from_dict(item[1]) for key, item in entries.items()}
            after_characters = dict(characters)
            if action != "rename":
                del after_characters[identifier]
                if action == "rename_id":
                    after_characters[target] = Character.from_dict({**card, "id": target})
                for path, (raw, _) in scanned.items():
                    if path.startswith("characters/"):
                        continue
                    try:
                        changed, found = rewrite_document(raw, identifier, target, card, replacement)
                    except ValueError as exc:
                        raise APIError(409, str(exc), reason="reference_field_conflict", path=path) from exc
                    references.extend({"path": path, **reference} for reference in found)
                    if found and (path.startswith("pages/") or isinstance(changed.get("page"), dict)):
                        page_raw = changed.get("page", changed)
                        before_raw = raw.get("page", raw)
                        if action == "delete" and before_raw.get("lora_character") == identifier:
                            page_raw["lora_character"] = "none"
                        before_page, after_page = Page.from_dict(before_raw), Page.from_dict(page_raw)
                        policy = scanned["project.json"][0].get("lora_policy", "single")
                        before_page.lora_policy = after_page.lora_policy = policy
                        try:
                            before_lora = select_lora(before_page, characters)
                            after_lora = select_lora(after_page, after_characters)
                        except ProductionError as exc:
                            raise APIError(422, str(exc), reason="invalid_lora") from exc
                        if before_lora != after_lora:
                            if options.get("preserve_lora") and action == "rename_id" and before_lora:
                                page_raw["lora_character"] = (
                                    target
                                    if before_lora["character_id"] == identifier
                                    else before_lora["character_id"]
                                )
                                after_page = Page.from_dict(page_raw)
                                after_page.lora_policy = policy
                                after_lora = select_lora(after_page, after_characters)
                            lora_changes.append({"path": path, "before": before_lora, "after": after_lora})
                        report = validate_page(after_page, after_characters).to_dict()
                        if report["errors"]:
                            raise APIError(
                                422, "操作后的页面未通过校验", reason="invalid_result", path=path, **report
                            )
                    if changed != raw:
                        changes[path] = json_bytes(changed)
                if action == "delete" and mode == "block" and references:
                    raise APIError(
                        409, "角色仍被引用，已阻止删除", reason="character_referenced", references=references
                    )

            relative_source = source_path.relative_to(self.store.root).as_posix()
            if action == "rename":
                name = options.get("display_name")
                if not isinstance(name, str) or not name.strip():
                    raise APIError(400, "显示名不能为空", reason="invalid_display_name")
                changes[relative_source] = json_bytes(patch_character(card, {"display_name": name}))
            else:
                changes[relative_source] = None
                if action == "rename_id":
                    changes[f"characters/{target}.json"] = json_bytes({**card, "id": target})
            self.guard_production()
            plan_id = uuid.uuid4().hex
            public = {
                "plan_id": plan_id,
                "action": action,
                "character_id": identifier,
                "target_id": target,
                "references": references,
                "affected_files": sorted(changes),
                "lora_changes": lora_changes,
                "warnings": ["自由文本、手写 caption 和历史生成记录中的旧称请人工核对。"],
                "errors": [],
            }
            self.plans[plan_id] = {
                "public": public,
                "versions": {path: item[1] for path, item in scanned.items()},
                "changes": changes,
                "expected": expected,
                "identifier": identifier,
            }
            return public

    def guard_production(self) -> None:
        if self.store.production_pages:
            raise APIError(409, "项目有生产任务正在执行，请结束后重试", reason="production_running")

    def commit(self, identifier: str, plan_id: str, expected: str | None) -> dict:
        with self.store.lock, page_lock(self.store.path("project.json")):
            plan = self.plans.get(plan_id)
            if not plan or plan["identifier"] != identifier:
                raise APIError(404, "影响计划不存在或服务已重启", reason="plan_not_found")
            if plan["expected"] != expected:
                raise APIError(409, "请求版本与计划不匹配", reason="character_version_conflict")
            if "result" in plan:
                return plan["result"]
            self.guard_production()
            versions = {path: item[1] for path, item in self.scan().items()}
            if versions != plan["versions"]:
                raise APIError(409, "项目引用或文件已变化，请重新预览", reason="reference_version_conflict")
            result = self.transact(plan["changes"], plan["public"], plan["versions"])
            plan["result"] = result
            return result

    def commit_plan(self, plan_id: str, expected: str | None) -> dict:
        plan = self.plans.get(plan_id)
        if not plan:
            raise APIError(404, "影响计划不存在或服务已重启", reason="plan_not_found")
        return self.commit(plan["identifier"], plan_id, expected)

    def replace_bytes(self, relative: str, content: bytes | None) -> None:
        path = self.store.path(relative)
        if content is None:
            path.unlink(missing_ok=True)
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.store.path(relative + f".{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("wb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)

    def transact(
        self, changes: dict[str, bytes | None], metadata: dict, expected_versions: dict | None = None
    ) -> dict:
        operation_id = uuid.uuid4().hex
        entries = {}
        for relative, content in changes.items():
            path = self.store.path(relative)
            before, version = file_snapshot(path) if path.exists() else (None, None)
            if expected_versions is not None and (
                f'"{version}"' if version else None
            ) != expected_versions.get(relative):
                raise APIError(409, "事务准备期间文件发生变化", reason="transaction_conflict", path=relative)
            entries[relative] = {
                "before": encode(before),
                "after": encode(content),
            }
        journal = {
            "state": "prepared",
            "operation_id": operation_id,
            "created_at": time.time_ns(),
            "metadata": metadata,
            "files": entries,
        }
        manifest = self.directory() / operation_id / "manifest.json"
        self.write_journal(manifest, journal)
        try:
            for relative, entry in entries.items():
                path = self.store.path(relative)
                current = path.read_bytes() if path.exists() else None
                if current != decode(entry["before"]):
                    raise APIError(  # noqa: TRY301 -- rollback covers every file write
                        409, "事务期间文件被外部修改", reason="transaction_conflict", path=relative
                    )
                self.replace_bytes(relative, decode(entry["after"]))
            journal["state"] = "committed"
            journal["versions"] = {}
            for relative, entry in entries.items():
                path = self.store.path(relative)
                content, version = file_snapshot(path) if path.exists() else (None, None)
                if content != decode(entry["after"]):
                    raise APIError(  # noqa: TRY301 -- retain outside edits during rollback
                        409, "事务写入后文件被外部修改", reason="transaction_conflict", path=relative
                    )
                journal["versions"][relative] = f'"{version}"' if version else None
            self.write_journal(manifest, journal)
        except (OSError, APIError):
            self.rollback(journal, manifest)
            raise
        return {
            "operation_id": operation_id,
            "affected_files": sorted(entries),
            "action": metadata.get("action"),
            "character_id": metadata.get("character_id"),
            "target_id": metadata.get("target_id"),
            "versions": journal["versions"],
        }

    def write_journal(self, path: Path, journal: dict) -> None:
        temporary = path.with_suffix(".tmp")
        write_json(temporary, journal)
        with temporary.open("r+b") as stream:
            os.fsync(stream.fileno())
        temporary.replace(path)

    def rollback(self, journal: dict, manifest: Path) -> None:
        conflicts = []
        for relative, entry in reversed(list(journal["files"].items())):
            path = self.store.path(relative)
            current = path.read_bytes() if path.exists() else None
            before, after = decode(entry["before"]), decode(entry["after"])
            if current == after:
                self.replace_bytes(relative, before)
            elif current != before:
                conflicts.append(relative)
        journal["state"] = "recovery_conflict" if conflicts else "rolled_back"
        journal["conflicts"] = conflicts
        self.write_journal(manifest, journal)
        if conflicts:
            raise APIError(
                409, "事务恢复遇到外部修改，已保留备份", reason="recovery_conflict", conflicts=conflicts
            )

    def recover(self) -> None:
        with self.store.lock, page_lock(self.store.path("project.json")):
            for candidate in sorted(self.directory().glob("*/manifest.json")):
                manifest = self.store.path(candidate.relative_to(self.store.root).as_posix())
                journal, _ = snapshot(manifest)
                if journal["state"] == "prepared":
                    self.rollback(journal, manifest)
                elif journal["state"] == "recovery_conflict":
                    raise APIError(409, "上次角色事务有恢复冲突，请检查备份", reason="recovery_conflict")
                if journal["state"] == "committed" and journal["metadata"].get("action") == "undo":
                    parent = self.store.path(
                        f".soda/character-operations/{journal['metadata']['of']}/manifest.json"
                    )
                    original, _ = snapshot(parent)
                    if original["state"] == "committed":
                        original["state"] = "undone"
                        self.write_journal(parent, original)

    def undo(self, operation_id: str, expected: str | None) -> dict:  # noqa: C901 -- inverse preconditions
        from .common import identifier  # noqa: PLC0415 -- validate journal path

        with self.store.lock, page_lock(self.store.path("project.json")):
            manifest = self.store.path(f".soda/character-operations/{identifier(operation_id)}/manifest.json")
            if not manifest.exists():
                raise APIError(404, "角色操作记录不存在", reason="operation_not_found")
            journal, version = snapshot(manifest)
            if expected != version or journal["state"] != "committed":
                raise APIError(409, "角色操作记录已变化", reason="operation_version_conflict")
            self.guard_production()
            for relative, after_version in journal["versions"].items():
                path = self.store.path(relative)
                current = snapshot(path)[1] if path.exists() else None
                if current != after_version:
                    raise APIError(
                        409,
                        "受影响文件已被修改，整笔撤销已拒绝",
                        reason="undo_version_conflict",
                        path=relative,
                    )
            catalog, diagnostics = self.store.character_store.index()
            if any(item["code"] != "character_filename_mismatch" for item in diagnostics):
                raise APIError(409, "角色目录有冲突，不能撤销", reason="undo_catalog_conflict")
            for relative, entry in journal["files"].items():
                if relative.startswith("characters/") and entry["before"] is not None:
                    restored = json.loads(decode(entry["before"]))["id"]
                    if any(
                        key.casefold() == restored.casefold()
                        and item[0].relative_to(self.store.root).as_posix() not in journal["files"]
                        for key, item in catalog.items()
                    ):
                        raise APIError(409, "原角色 ID 已被占用，不能撤销", reason="undo_id_occupied")
            # Scan new references too: inverse operations may invalidate a newly added page.
            target = journal["metadata"].get("target_id")
            if journal["metadata"].get("action") == "rename_id" and target:
                references = self.references(target)["references"]
                if any(reference["path"] not in journal["files"] for reference in references):
                    raise APIError(409, "新页面引用了更改后的 ID，不能撤销", reason="undo_new_references")
            result = self.transact(
                {path: decode(entry["before"]) for path, entry in journal["files"].items()},
                {"action": "undo", "of": operation_id},
                journal["versions"],
            )
            journal["state"] = "undone"
            self.write_journal(manifest, journal)
            return result

    def history(self) -> dict:
        operations = []
        for candidate in self.directory().glob("*/manifest.json"):
            manifest = self.store.path(candidate.relative_to(self.store.root).as_posix())
            journal, version = snapshot(manifest)
            if journal["state"] == "committed" and journal["metadata"].get("action") != "undo":
                operations.append(
                    {
                        "operation_id": journal["operation_id"],
                        "version": version,
                        "created_at": journal.get("created_at", 0),
                        **journal["metadata"],
                    }
                )
        return {"operations": sorted(operations, key=lambda item: item["created_at"])}
