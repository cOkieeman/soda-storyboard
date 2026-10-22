import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, X } from "lucide-react";
import { ApiError } from "../../lib/api";
import { resolvedFigures } from "../../lib/figures";
import { collectImportedCharacterIds, mapImportedCharacters, parseImportedPage, type ImportedPageDraft } from "../../lib/importPage";
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
  const dialogRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    sourceRef.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        if (!busyRef.current) close();
      } else if (event.key === "Tab") {
        const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') || [])].filter(element => element.getClientRects().length);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", keyboard, true);
    return () => { fileSequence.current += 1; document.removeEventListener("keydown", keyboard, true); previous?.focus(); };
  }, [close]);

  const invalidatePreview = () => { setDraft(null); setRoleMapping({}); setDimensionsConfirmed(false); setError(null); };
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
  const parse = () => {
    setError(null);
    try {
      if (new TextEncoder().encode(source).length > MAX_SOURCE_BYTES) throw new Error("内容超过 2 MB。请拆分为单页 JSON 后导入。");
      setDraft(parseImportedPage(source, { canvasWidth: Number(width), canvasHeight: Number(height) }));
      setRoleMapping({}); setDimensionsConfirmed(false);
      if (window.innerWidth < 768) requestAnimationFrame(() => resultRef.current?.scrollIntoView({ block: "start" }));
    } catch (failure) { setDraft(null); setError((failure as Error).message); }
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
      const details = Array.isArray(issues) ? issues.map(issue => issue.message).filter(Boolean).join("；") : "";
      setError(details || (failure as Error).message || "导入失败，请检查 JSON 内容后重试。");
    } finally { busyRef.current = false; setBusy(false); }
  };
  const figureCount = previewPage?.panels.reduce((count, panel) => count + resolvedFigures(panel, previewPage.reading_direction).length, 0) || 0;

  return <div className="import-modal-scrim" onPointerDown={event => { if (event.target === event.currentTarget && !busyRef.current) close(); }}>
    <div className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title" aria-describedby="import-description" ref={dialogRef}>
      <header className="import-dialog-header">
        <div><h2 id="import-title">导入 JSON</h2><p id="import-description">选择文件或粘贴内容，预览后导入为新页。</p></div>
        <button className="icon-button" type="button" aria-label="关闭导入" disabled={busy} onClick={close}><X /></button>
      </header>
      <div className="import-dialog-body">
        <section className="import-source" aria-label="JSON 来源">
          <div className="import-source-heading"><label className="ui-btn import-file-button"><FileUp size={16} />选择 JSON 文件<input type="file" accept=".json,application/json" aria-label="选择 JSON 文件" disabled={busy || reading} onChange={event => { void readFile(event.target.files?.[0]); event.target.value = ""; }} /></label><span>{reading ? "读取中…" : filename || "支持分镜单 / MOSS 布局"}</span></div>
          <label className="ui-label" htmlFor="import-json-source">或粘贴 JSON 内容</label>
          <textarea id="import-json-source" ref={sourceRef} value={source} disabled={busy || reading} spellCheck={false} placeholder={'{\n  "panels": [...],\n  "texts": [...]\n}'} onChange={event => { fileSequence.current += 1; setSource(event.target.value); setFilename(""); invalidatePreview(); }} />
          <div className="import-canvas-size"><label>原画布宽度<input type="number" min="1" max="8192" value={width} disabled={busy} onChange={event => { setWidth(event.target.value); invalidatePreview(); }} /></label><span>×</span><label>原画布高度<input type="number" min="1" max="8192" value={height} disabled={busy} onChange={event => { setHeight(event.target.value); invalidatePreview(); }} /></label></div>
          <p className="import-help">MOSS 缺少画布尺寸时使用上方数值；分镜单使用文件自带尺寸。每次导入一页，最大 2 MB。</p>
          <button className="ui-btn" type="button" onClick={parse} disabled={busy || reading || !source.trim()}>解析并预览</button>
        </section>
        <section className="import-result" aria-label="导入预览" ref={resultRef}>
          {draft ? <>
            <div className="import-preview-heading"><strong>{draft.format === "soda" ? "分镜单 JSON" : "MOSS 布局 JSON"}</strong><span>{draft.page.canvas_width} × {draft.page.canvas_height}</span></div>
            {previewPage && <LayoutPreview page={previewPage} />}
            <p className="import-counts" aria-live="polite">{previewPage?.panels.length} 格 · {previewPage?.texts.length} 个文字框 · {figureCount} 个人物{previewPage?.overlays?.length ? ` · ${previewPage.overlays.length} 个人物图层` : ""}</p>
            {draft.needsCanvasSize && <label className="import-size-confirm"><input type="checkbox" checked={dimensionsConfirmed} disabled={busy} onChange={event => setDimensionsConfirmed(event.target.checked)} /><span>文件未记录尺寸，我确认原画布为 {draft.page.canvas_width} × {draft.page.canvas_height}。</span></label>}
            {missingRoles.length > 0 && <div className="import-roles"><h3>关联本项目角色</h3><p className="import-help">文件中的以下角色不在当前项目内，请选择对应关系。</p>{missingRoles.map(id => <label className="import-role" key={id}><span title={id}>{id}</span><select aria-label={`关联角色 ${id}`} value={roleChoice(roleMapping, id)} disabled={busy} onChange={event => setRoleMapping(current => ({ ...current, [id]: event.target.value }))}><option value="">请选择…</option>{characters.map(character => <option key={character.id} value={`id:${character.id}`}>{character.display_name}</option>)}<option value="skip">只保留画面和台词</option></select></label>)}<p className="import-help">“只保留画面和台词”会跳过该角色的火柴人和人物图层，并清除说话人关联。原始数据保留在导入记录中。</p></div>}
            {draft.warnings.length > 0 && <details className="import-warnings" open><summary>{draft.warnings.length} 条导入提醒</summary><ul>{draft.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
          </> : <div className="import-preview-empty"><FileUp size={32} /><h3>先看版式，再导入</h3><p>读取后会显示格子、文字和人物图层范围。原有页面会保留。</p><p>支持 Soda 分镜单和 MOSS 的 summary / items 布局。ComfyUI 工作流等其他 JSON 需要先转换。</p></div>}
        </section>
      </div>
      {error && <p className="import-error" role="alert">{error}</p>}
      <footer className="import-dialog-footer"><span>导入时会先保存当前页。</span><div><button className="ui-btn" type="button" disabled={busy} onClick={close}>取消</button><button className="ui-btn ui-btn-primary" type="button" disabled={busy || reading || !draft || missingRoles.some(id => !roleChoice(roleMapping, id)) || (Boolean(draft?.needsCanvasSize) && !dimensionsConfirmed)} onClick={() => void importPage()}>{busy ? "正在导入…" : "导入为新页"}</button></div></footer>
    </div>
  </div>;
}

export default function ImportModal() {
  return useEditorStore(state => state.importModalOpen) ? <ImportDialog /> : null;
}
