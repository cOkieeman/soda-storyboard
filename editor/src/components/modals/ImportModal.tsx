import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import ModalShell from "./ModalShell";
import NumberInput from "../ui/NumberInput";
import { ApiError, importExternalStoryboard } from "../../lib/api";
import { resolvedFigures } from "../../lib/figures";
import { collectImportedCharacterIds, mapImportedCharacters, normalizeImportedPageIds, parseImportedPage, type ImportedPageDraft } from "../../lib/importPage";
import { useEditorStore } from "../../lib/store";
import type { SodaPage } from "../../types";

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const roleChoice = (mapping: Record<string, string>, id: string): string => Object.prototype.hasOwnProperty.call(mapping, id) ? mapping[id] : "";

function LayoutPreview({ page }: { page: SodaPage }) {
  const stroke = Math.max(page.canvas_width, page.canvas_height) / 350;
  return <svg className="import-layout-preview" viewBox={`0 0 ${page.canvas_width} ${page.canvas_height}`} role="img" aria-label="待导入分镜的版式预览">
    <rect width={page.canvas_width} height={page.canvas_height} fill="#fff" />
    {page.panels.map(panel => <g key={panel.id} fill="none" stroke="#45483e" strokeWidth={stroke}>
      {panel.shape.type === "quad" ? <polygon points={panel.shape.points.map(point => point.join(",")).join(" ")} /> : <rect x={panel.shape.x} y={panel.shape.y} width={panel.shape.w} height={panel.shape.h} />}
    </g>)}
    {page.overlays?.map(overlay => <rect key={overlay.id} x={overlay.rect.x} y={overlay.rect.y} width={overlay.rect.w} height={overlay.rect.h} fill="#d0a654" fillOpacity={0.12} stroke="#a17c32" strokeWidth={stroke} strokeDasharray={`${stroke * 3} ${stroke * 2}`} />)}
    {page.objects?.map(object => <rect key={object.id} x={object.rect.x} y={object.rect.y} width={object.rect.w} height={object.rect.h} fill={object.label === "character" ? "#d0a654" : "#777067"} fillOpacity={0.1} stroke={object.label === "character" ? "#a17c32" : "#777067"} strokeWidth={stroke} />)}
    {page.texts.map(text => text.bbox && <g key={text.id}>
      <rect x={text.bbox.x} y={text.bbox.y} width={text.bbox.w} height={text.bbox.h} rx={text.bubble === "speech" ? stroke * 4 : 0} fill="#e7f1f3" stroke="#3288a2" strokeWidth={stroke} />
    </g>)}
  </svg>;
}

function ImportDialog() {
  const project = useEditorStore(state => state.sodaProject);
  const characters = useEditorStore(state => state.characters);
  const close = useEditorStore(state => state.closeImportModal);
  const [source, setSource] = useState("");
  const [filename, setFilename] = useState("");
  const [width, setWidth] = useState(String(project?.default_canvas_width || 1024));
  const [height, setHeight] = useState(String(project?.default_canvas_height || 1536));
  const [draft, setDraft] = useState<ImportedPageDraft | null>(null);
  const [roleMapping, setRoleMapping] = useState<Record<string, string>>({});
  const [dimensionsConfirmed, setDimensionsConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [widthValid, setWidthValid] = useState(true);
  const [heightValid, setHeightValid] = useState(true);
  const [errorOffset, setErrorOffset] = useState<number | null>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const busyRef = useRef(false);
  const fileSequence = useRef(0);
  const missingRoles = useMemo(() => draft ? collectImportedCharacterIds(draft.page).filter(id => !characters.some(character => character.id === id)) : [], [draft, characters]);
  const previewPage = useMemo(() => {
    if (!draft) return null;
    const mapping = Object.fromEntries(missingRoles.filter(id => roleChoice(roleMapping, id)).map(id => [id, roleChoice(roleMapping, id) === "skip" ? null : roleChoice(roleMapping, id).slice(3)]));
    return mapImportedCharacters(draft.page, mapping);
  }, [draft, missingRoles, roleMapping]);

  useEffect(() => () => { fileSequence.current += 1; }, []);

  const invalidatePreview = () => { setDraft(null); setRoleMapping({}); setDimensionsConfirmed(false); setError(null); setErrorOffset(null); };
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    const request = ++fileSequence.current;
    invalidatePreview(); setReading(false); setSource(""); setFilename(file.name);
    if (file.size > MAX_SOURCE_BYTES) { setError("文件超过 2 MB。请拆分为单页 JSON 后导入。"); return; }
    setReading(true);
    try {
      const text = await file.text();
      if (request !== fileSequence.current) return;
      setSource(text); setFilename(file.name);
    } catch { if (request === fileSequence.current) setError("无法读取文件，请重新选择，或粘贴 JSON 内容。"); }
    finally { if (request === fileSequence.current) setReading(false); }
  };
  const parse = async () => {
    setError(null); setErrorOffset(null);
    try {
      if (new TextEncoder().encode(source).length > MAX_SOURCE_BYTES) throw new Error("内容超过 2 MB。请拆分为单页 JSON 后导入。");
      if (!widthValid || !heightValid) throw new Error("请先修正画布宽度和高度。");
      const trimmed = source.trim();
      const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
      const json = fenced ? fenced[1].trim() : trimmed;
      let parsed: any;
      try { parsed = JSON.parse(json); } catch (syntax) {
        if (/^\s*(?:\||\d+[.)、]|[-*+]\s)/m.test(json)) parsed = null;
        else {
        const message = (syntax as Error).message;
        const match = /position (\d+)/i.exec(message);
        const offset = source.indexOf(json) + (match ? Number(match[1]) : json.length);
        const prefix = source.slice(0, offset); const line = prefix.split("\n").length; const column = prefix.length - prefix.lastIndexOf("\n");
        setErrorOffset(offset);
        throw new Error(`JSON 语法错误：第 ${line} 行，第 ${column} 列。${message}`);
        }
      }
      if (parsed && !parsed.items && Array.isArray((parsed.page || parsed).panels) && (parsed.page || parsed).canvas_width) {
        setDraft(parseImportedPage(source, { canvasWidth: Number(width), canvasHeight: Number(height) }));
      } else {
        setReading(true);
        const result = await importExternalStoryboard(source);
        const normalized = normalizeImportedPageIds(result.page);
        setDraft({ page: normalized.page, format: parsed?.items ? "moss" : "soda", warnings: [...result.report.guesses, ...result.report.warnings, ...result.report.unrecognized_items.map(item => `条目 ${item.index + 1}：${item.reason}，原样保留。`), ...normalized.warnings], needsCanvasSize: false });
      }
      setRoleMapping({}); setDimensionsConfirmed(false);
      if (window.innerWidth < 768) requestAnimationFrame(() => resultRef.current?.scrollIntoView({ block: "start" }));
    } catch (failure) { setDraft(null); setError((failure as Error).message); }
    finally { setReading(false); }
  };
  const importPage = async () => {
    if (!draft || busyRef.current || missingRoles.some(id => !roleChoice(roleMapping, id)) || (draft.needsCanvasSize && !dimensionsConfirmed)) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const mapping = Object.fromEntries(missingRoles.map(id => [id, roleChoice(roleMapping, id) === "skip" ? null : roleChoice(roleMapping, id).slice(3)]));
      const page = mapImportedCharacters(draft.page, mapping);
      if (new TextEncoder().encode(JSON.stringify(page)).length > 3.8 * 1024 * 1024) throw new Error("导入记录超过服务的 4 MB 限制。请减少附带数据或拆分为单页。");
      await useEditorStore.getState().importPageAsNew(page);
      close();
    } catch (failure) {
      const issues = failure instanceof ApiError ? failure.data?.errors || failure.data?.issues : [];
      const details = Array.isArray(issues) ? issues.map(issue => `${issue.field || issue.code || "页面"}：${issue.message}`).filter(Boolean).join("；") : "";
      setError(details || (failure as Error).message || "导入失败，请检查 JSON 内容后重试。");
    } finally { busyRef.current = false; setBusy(false); }
  };
  const figureCount = previewPage?.panels.reduce((count, panel) => count + resolvedFigures(panel, previewPage.reading_direction).length, 0) || 0;

  const unmapped = missingRoles.filter(id => !roleChoice(roleMapping, id)).length;
  const blocker = reading ? "正在读取文件…" : !widthValid || !heightValid ? "请修正画布尺寸" : !draft ? "请先解析并预览 JSON" : unmapped ? `还需关联 ${unmapped} 个角色` : draft.needsCanvasSize && !dimensionsConfirmed ? "请确认原画布尺寸" : "检查预览后，导入为新页。原有页面会保留。";
  return <ModalShell title="导入 JSON" description="选择文件或粘贴内容，预览后导入为新页。" onClose={close} busy={busy} initialFocusRef={sourceRef} className="max-w-[1040px]" footer={<><span role="status" className="mr-auto text-xs text-[var(--muted)]">{blocker}</span><button className="ui-btn" disabled={busy} onClick={close}>取消</button><button className="ui-btn ui-btn-primary" disabled={busy || reading || !draft || Boolean(unmapped) || !widthValid || !heightValid || Boolean(draft?.needsCanvasSize && !dimensionsConfirmed)} onClick={() => void importPage()}>{busy ? "正在导入…" : error && draft ? "重试导入" : "导入为新页"}</button></>}>
      <div className="import-dialog-body">
        <section className="import-source" aria-label="JSON 来源">
          <div className="import-source-heading"><label className="ui-btn import-file-button"><FileUp size={16} />选择 JSON 文件<input type="file" accept=".json,application/json" aria-label="选择 JSON 文件" disabled={busy || reading} onChange={event => { void readFile(event.target.files?.[0]); event.target.value = ""; }} /></label><span>{reading ? "读取中…" : filename || "支持分镜单 / MOSS 布局"}</span></div>
          <label className="ui-label" htmlFor="import-json-source">或粘贴 JSON 内容</label>
          <textarea id="import-json-source" ref={sourceRef} value={source} disabled={busy || reading} spellCheck={false} placeholder={'{\n  "panels": [...],\n  "texts": [...]\n}'} onChange={event => { fileSequence.current += 1; setSource(event.target.value); setFilename(""); invalidatePreview(); }} />
          <div className="import-canvas-size"><label>原画布宽度<NumberInput aria-label="原画布宽度" min={1} max={8192} integer value={Number(width)} disabled={busy} onValidityChange={setWidthValid} onCommit={value => { setWidth(String(value)); invalidatePreview(); }} /></label><span>×</span><label>原画布高度<NumberInput aria-label="原画布高度" min={1} max={8192} integer value={Number(height)} disabled={busy} onValidityChange={setHeightValid} onCommit={value => { setHeight(String(value)); invalidatePreview(); }} /></label></div>
          <p className="import-help">支持 MOSS、分镜 JSON 和 Markdown 表格或列表。MOSS 缺少尺寸时按坐标推断，猜测会列在理解提醒中。每次导入一页，最大 2 MB。</p>
          <button className="ui-btn" type="button" onClick={parse} disabled={busy || reading || !source.trim()}>解析并预览</button>
        </section>
        <section className="import-result" aria-label="导入预览" ref={resultRef}>
          {draft ? <>
            <div className="import-preview-heading"><strong>{draft.format === "soda" ? "分镜单 JSON" : "MOSS 布局 JSON"}</strong><span>{draft.page.canvas_width} × {draft.page.canvas_height}</span></div>
            {previewPage && <LayoutPreview page={previewPage} />}
            <p className="import-counts" aria-live="polite">{previewPage?.canvas_mode === "single" ? "单画布" : `${previewPage?.panels.length} 格`} · {previewPage?.texts.length} 个文字框 · {figureCount} 个人物 · {previewPage?.objects?.length || 0} 个物件/人物框{previewPage?.overlays?.length ? ` · ${previewPage.overlays.length} 个人物图层` : ""}</p>
            {draft.needsCanvasSize && <label className="import-size-confirm"><input type="checkbox" checked={dimensionsConfirmed} disabled={busy} onChange={event => setDimensionsConfirmed(event.target.checked)} /><span>文件未记录尺寸，我确认原画布为 {draft.page.canvas_width} × {draft.page.canvas_height}。</span></label>}
            {missingRoles.length > 0 && <div className="import-roles"><h3>关联本项目角色</h3><p className="import-help">文件中的以下角色不在当前项目内，请选择对应关系。</p>{missingRoles.map(id => <label className="import-role" key={id}><span title={id}>{id}</span><select aria-label={`关联角色 ${id}`} value={roleChoice(roleMapping, id)} disabled={busy} onChange={event => setRoleMapping(current => ({ ...current, [id]: event.target.value }))}><option value="">请选择…</option>{characters.map(character => <option key={character.id} value={`id:${character.id}`}>{character.display_name}</option>)}<option value="skip">只保留画面和台词</option></select></label>)}<p className="import-help">“只保留画面和台词”会跳过该角色的火柴人和人物图层，并清除说话人关联。原始数据保留在导入记录中。</p></div>}
            {draft.warnings.length > 0 && <details className="import-warnings" open><summary>{draft.warnings.length} 条导入提醒</summary><ul>{draft.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
          </> : <div className="import-preview-empty"><FileUp size={32} /><h3>先看版式，再导入</h3><p>读取后会显示格子、文字和人物图层范围。原有页面会保留。</p><p>支持 Soda 分镜单和 MOSS 的 summary / items 布局。ComfyUI 工作流等其他 JSON 需要先转换。</p></div>}
        </section>
      </div>
      {error && <div className="import-error" role="alert"><p>{error}</p>{errorOffset !== null && <button className="ui-btn ui-btn-sm mt-2" onClick={() => { sourceRef.current?.focus(); sourceRef.current?.setSelectionRange(errorOffset, errorOffset + 1); }}>定位错误位置</button>}</div>}
    </ModalShell>;

}

export default function ImportModal() {
  return useEditorStore(state => state.importModalOpen) ? <ImportDialog /> : null;
}
