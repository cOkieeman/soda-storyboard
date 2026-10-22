import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Eye, EyeOff, FileUp, LoaderCircle, Lock, Plus, Search, Trash2, Unlock, Users } from "lucide-react";
import { useEditorStore } from "../lib/store";
import { getFigureId } from "../lib/figureRig";
import { resolvedFigures } from "../lib/figures";
import { CHARACTER_COLOR_PRESETS, characterSketchColor } from "../lib/characterColors";
import { readUiPreference, saveUiPreference } from "../lib/localUiPreferences";
import { selectionKey } from "../lib/batchEditing";
import type { Selection, SodaOverlay, SodaText } from "../types";

const shotLabels: Record<string, string> = {
  extreme_long: "大远景", long: "远景", full: "全景", medium: "中景", close_up: "近景", extreme_close_up: "特写"
};

const textKindLabels: Record<string, string> = {
  dialogue: "台词", narration: "旁白", sfx: "音效", title: "标题", caption_tag: "说明"
};

function shortText(text: string, length = 46) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > length ? normalized.slice(0, length) + "…" : normalized;
}

function ObjectControls({ selection, label }: { selection: Selection; label: string }) {
  const flags = useEditorStore(state => state.objectFlags);
  const current = useEditorStore.getState().getObjectFlags(selection);
  void flags;
  return <span className="object-tree-controls absolute right-1 top-1 flex items-center gap-0.5">
    <button type="button" className="ui-icon-btn !min-h-7 !min-w-7" aria-label={`${current.locked ? "解锁" : "锁定"}${label}`} aria-pressed={current.locked} title={current.locked ? "解锁后可在画布移动" : "锁定，防止误移动"} onClick={() => useEditorStore.getState().toggleObjectLock(selection)}>{current.locked ? <Lock size={13} /> : <Unlock size={13} />}</button>
    <button type="button" className="ui-icon-btn !min-h-7 !min-w-7" aria-label={`${current.hidden ? "显示" : "临时隐藏"}${label}`} aria-pressed={current.hidden} title={current.hidden ? "在画布显示" : "临时隐藏，不删除内容"} onClick={() => useEditorStore.getState().toggleObjectVisibility(selection)}>{current.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
  </span>;
}

type PageSidebarProps = {
  onSelectObject?: (selection: Selection, additive?: boolean) => void;
  onStartPage?: () => void;
};

function CharacterColorControls({ id, name, color }: { id: string; name: string; color: string }) {
  const [draft, setDraft] = useState(color);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  useEffect(() => { setDraft(color); }, [color]);
  const save = async (value: string) => {
    if (status === "saving") return;
    setDraft(value);
    setStatus("saving");
    const saved = await useEditorStore.getState().updateCharacterColor(id, value);
    setStatus(saved ? "saved" : "failed");
    if (!saved) setDraft(color);
  };
  const preset = CHARACTER_COLOR_PRESETS.find(item => item.value === draft.toUpperCase());
  return <div className="space-y-2 border-b border-[var(--line)] px-4 pb-3 pt-2" data-testid={`character-color-${id}`}
    onPointerDown={event => event.stopPropagation()} onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}>
    <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]"><span>人物色 · {preset?.name || "自定义"}</span><span className="numeric text-[var(--ink-light)]">{draft.toUpperCase()}</span></div>
    <div className="flex flex-wrap items-center gap-2">{CHARACTER_COLOR_PRESETS.map(item => <button key={item.value} type="button"
      className="h-7 w-7 shrink-0 rounded border-2 disabled:opacity-50" style={{ backgroundColor: item.value, borderColor: draft.toUpperCase() === item.value ? "var(--ink)" : "transparent", boxShadow: draft.toUpperCase() === item.value ? "inset 0 0 0 2px var(--paper)" : undefined }}
      aria-label={`${name}使用${item.name} ${item.value}`} aria-pressed={draft.toUpperCase() === item.value} title={`${item.name} ${item.value}`} disabled={status === "saving"} onClick={() => void save(item.value)} />)}</div>
    <div className="flex flex-wrap items-center justify-between gap-2"><label className="flex cursor-pointer items-center gap-2 text-[13px]"><span>自定义</span><input type="color" className="h-8 w-12 cursor-pointer rounded border border-[var(--line)] bg-transparent p-0.5" aria-label={`${name}自定义人物颜色`} value={draft} disabled={status === "saving"} onChange={event => { setDraft(event.target.value); setStatus("idle"); }} /></label><button type="button" className="ui-btn ui-btn-sm" aria-label={`保存${name}的自定义颜色`} disabled={status === "saving" || draft.toUpperCase() === color.toUpperCase()} onClick={() => void save(draft)}>保存颜色</button></div>
    {status === "idle" && draft.toUpperCase() !== color.toUpperCase() && <p className="text-[13px] text-[var(--ink-light)]">点击“保存颜色”应用到所有分镜</p>}
    {status !== "idle" && <p className="text-[13px] text-[var(--ink-light)]" role="status">{status === "saving" ? "正在保存人物色…" : status === "saved" ? "已保存，同角色的所有分镜同步更新" : "保存失败，请查看提示后重试"}</p>}
  </div>;
}

export default function PageSidebar({ onSelectObject, onStartPage }: PageSidebarProps) {
  const pages = useEditorStore(s => s.pages);
  const characters = useEditorStore(s => s.characters);
  const details = useEditorStore(s => s.characterDetails);
  const activeId = useEditorStore(s => s.activePageId);
  const sodaPage = useEditorStore(s => s.sodaPage);
  const selection = useEditorStore(s => s.selection);
  const selections = useEditorStore(s => s.selections);
  const projectIdentity = useEditorStore(s => s.projectIdentity);
  const [savedPreferences] = useState(() => readUiPreference<{ tab?: string; expandedPanels?: Record<string, boolean>; pageSearch?: string }>("soda.workspace.v1.sidebar-state", {}));
  const [tab, setTab] = useState<"pages" | "characters">(savedPreferences.tab === "characters" ? "characters" : "pages");
  const [expandedPanels, setExpandedPanels] = useState<Record<string, boolean>>(savedPreferences.expandedPanels && typeof savedPreferences.expandedPanels === "object" ? savedPreferences.expandedPanels : {});
  const [pageSearch, setPageSearch] = useState(typeof savedPreferences.pageSearch === "string" ? savedPreferences.pageSearch : "");
  const [objectSearch, setObjectSearch] = useState("");
  const [copyingPage, setCopyingPage] = useState<string | null>(null);
  const panels = [...(sodaPage?.panels || [])].sort((a, b) => a.order - b.order);
  const singleCanvas = sodaPage?.canvas_mode === "single";
  const objects = sodaPage?.objects || [];
  const texts = sodaPage?.texts || [];
  const overlays = sodaPage?.overlays || [];
  const query = objectSearch.trim().toLocaleLowerCase();
  const matches = (value: string) => !query || value.toLocaleLowerCase().includes(query);
  const figureMatches = (figure: { character_id: string; pose: string }) => matches(`${figure.character_id} ${characters.find(character => character.id === figure.character_id)?.display_name || ""} ${figure.pose} 人物`);
  const textMatches = (text: SodaText) => matches(`${text.id} ${text.text} ${textKindLabels[text.kind] || text.kind} ${text.speaker_id || ""}`);
  const overlayMatches = (overlay: SodaOverlay) => matches(`${overlay.id} ${overlay.character_id} ${characters.find(character => character.id === overlay.character_id)?.display_name || ""} ${overlay.description || ""} 跨格人物`);
  const visiblePanels = panels.map((panel, index) => ({ panel, index })).filter(({ panel }) => matches(`${panel.id} 第${panel.order}格 ${panel.description || ""}`) || resolvedFigures(panel, sodaPage?.reading_direction).some(figureMatches) || texts.some(text => text.panel_id === panel.id && textMatches(text)) || overlays.some(overlay => overlay.panel_id === panel.id && overlayMatches(overlay)));
  const visiblePages = pages.map((page, index) => ({ page, index })).filter(({ page, index }) => `${page.id} 第${index + 1}页 ${page.description || ""}`.toLocaleLowerCase().includes(pageSearch.trim().toLocaleLowerCase()));
  const isSelected = (item: Selection) => selections.some(current => selectionKey(current) === selectionKey(item)) || Boolean(selection && selectionKey(selection) === selectionKey(item));
  useEffect(() => { saveUiPreference("soda.workspace.v1.sidebar-state", { tab, expandedPanels, pageSearch }); }, [tab, expandedPanels, pageSearch]);
  useEffect(() => {
    const reset = () => { setTab("pages"); setExpandedPanels({}); setPageSearch(""); setObjectSearch(""); };
    window.addEventListener("soda:reset-workspace", reset);
    return () => window.removeEventListener("soda:reset-workspace", reset);
  }, []);
  const selectedObjectPanelId = selection?.kind === "figure" ? selection.panelId
    : selection?.kind === "text" || selection?.kind === "bubble"
      ? texts.find(text => text.id === selection.id)?.panel_id
      : selection?.kind === "overlay" ? overlays.find(overlay => overlay.id === selection.id)?.panel_id : null;

  useEffect(() => {
    if (!selectedObjectPanelId) return;
    const key = projectIdentity + ":" + activeId + ":" + selectedObjectPanelId;
    setExpandedPanels(current => current[key] ? current : { ...current, [key]: true });
  }, [activeId, selectedObjectPanelId, projectIdentity]);

  const selectObject = (next: Selection, additive = false) => {
    if (onSelectObject) onSelectObject(next, additive);
    else useEditorStore.getState().selectItem(next, additive);
  };

  const renderText = (text: SodaText) => {
    const selected = isSelected({ kind: "text", id: text.id });
    const speaker = text.speaker_id && characters.find(character => character.id === text.speaker_id)?.display_name;
    return <div key={text.id} className="object-tree-row relative"><button className={"outline-text-button" + (selected ? " is-selected" : "")} style={{ paddingRight: 64 }} aria-pressed={selected} onClick={event => selectObject({ kind: "text", id: text.id }, event.shiftKey || event.ctrlKey || event.metaKey)}>
      <span className="outline-panel-meta">{textKindLabels[text.kind] || "文字"}{speaker ? " · " + speaker : ""}</span>
      <span>{shortText(text.text, 36) || "未填写内容，点击编辑"}</span>
    </button><ObjectControls selection={{ kind: "text", id: text.id }} label={`${textKindLabels[text.kind] || "文字"} ${shortText(text.text, 12)}`} /></div>;
  };

  const renderOverlay = (overlay: SodaOverlay) => {
    const selected = isSelected({ kind: "overlay", id: overlay.id });
    const characterName = characters.find(character => character.id === overlay.character_id)?.display_name || overlay.character_id || "未指定角色";
    return <div key={overlay.id} className="object-tree-row relative" data-overlay-id={overlay.id}><button type="button" className={"outline-text-button outline-figure-button" + (selected ? " is-selected" : "")} style={{ paddingRight: 64 }} aria-pressed={selected} onClick={event => selectObject({ kind: "overlay", id: overlay.id }, event.shiftKey || event.ctrlKey || event.metaKey)}>
      <span className="outline-panel-meta">跨格人物 · {characterName}</span><span>{shortText(overlay.description || "", 36) || "未填写动作描述"}</span>
    </button><ObjectControls selection={{ kind: "overlay", id: overlay.id }} label={`跨格人物 ${characterName}`} /></div>;
  };

  const unassignedTexts = texts.filter(text => !text.panel_id || !panels.some(panel => panel.id === text.panel_id));
  const unassignedOverlays = overlays.filter(overlay => !overlay.panel_id || !panels.some(panel => panel.id === overlay.panel_id));
  const visibleUnassignedTexts = unassignedTexts.filter(textMatches);
  const visibleUnassignedOverlays = unassignedOverlays.filter(overlayMatches);
  return (
    <aside className="page-sidebar" aria-label="页面与角色">
      <div className="sidebar-tabs" role="tablist" aria-label="资源类型">
        <button role="tab" aria-selected={tab === "pages"} aria-controls="page-resources" id="pages-tab" onClick={() => setTab("pages")}>页面 <span>{pages.length}</span></button>
        <button role="tab" aria-selected={tab === "characters"} aria-controls="character-resources" id="characters-tab" onClick={() => setTab("characters")}>角色 <span>{characters.length}</span></button>
      </div>
      {tab === "pages" ? <div className="sidebar-tab-content" role="tabpanel" id="page-resources" aria-labelledby="pages-tab">
        <div className="sidebar-subheading"><span>分镜页面</span><div className="sidebar-page-actions"><button className="sidebar-new-page" onClick={() => useEditorStore.getState().openImportModal()} title="从文件或粘贴内容导入分镜 JSON" aria-label="导入 JSON"><FileUp size={14} /><span>导入</span></button><button className="sidebar-new-page" onClick={() => void useEditorStore.getState().createPage()} title="新建分镜页：从一个格子开始，可切分为更多格子" aria-label="新建分镜页"><Plus size={14} /><span>新建页</span></button></div></div>
        <label className="mx-3 mb-2 flex items-center gap-2"><Search size={14} className="shrink-0 text-[var(--muted)]" /><input className="ui-input" aria-label="搜索页面" placeholder="搜索页面或故事描述" value={pageSearch} onChange={event => setPageSearch(event.target.value)} /></label>
        <div className="page-list">
          {visiblePages.map(({ page, index }) => <div className={page.id === activeId ? "page-row is-active" : "page-row"} key={page.id} data-page-id={page.id}>
            <button className="page-row-select" style={{ paddingRight: 38 }} onClick={() => void useEditorStore.getState().selectPage(page.id)} aria-current={page.id === activeId ? "page" : undefined}>
              <div className="page-thumbnail"><img src={"/api/pages/" + encodeURIComponent(page.id) + "/preview.png?style=sketch&scale=0.2&v=" + encodeURIComponent(page.version)} alt={"第 " + (index + 1) + " 页分镜缩略图"} loading="lazy" /></div>
              <div className="page-row-info"><span className="page-row-title">第 {index + 1} 页</span><span className="page-row-description">{page.description || "空白分镜页"}</span><span className="page-row-meta"><span className="numeric">{String(index + 1).padStart(2, "0")}</span><span>{page.panel_count} 格</span>{page.id === activeId && <Check aria-label="当前页" />}</span></div>
            </button>
            <button type="button" className="icon-button absolute right-1 top-2" title="复制此页及全部内容" aria-label={`复制第 ${index + 1} 页`} disabled={copyingPage !== null} onClick={async () => { setCopyingPage(page.id); try { await useEditorStore.getState().duplicatePage(page.id); setPageSearch(""); } catch (error) { useEditorStore.getState().setNotice(error instanceof Error ? error.message : "复制页面失败"); } finally { setCopyingPage(null); } }}>{copyingPage === page.id ? <LoaderCircle className="is-spinning" /> : <Copy />}</button>
            {pages.length > 1 && <button className="page-delete icon-button" title="删除分镜页" aria-label={"删除第 " + (index + 1) + " 页"} onClick={() => { if (confirm("将第 " + (index + 1) + " 页移入回收站？")) void useEditorStore.getState().deletePage(page.id); }}><Trash2 /></button>}
          </div>)}
          {visiblePages.length === 0 && <p className="px-4 py-3 text-sm text-[var(--muted)]">没有匹配的页面</p>}
        </div>
        <section className="page-outline" aria-labelledby="page-outline-heading">
          <div className="outline-heading"><h2 id="page-outline-heading">本页分镜</h2><span>{singleCanvas ? "单画布" : `${panels.length} 格`}</span></div>
          {(panels.length > 0 || singleCanvas) && <label className="mx-3 mb-2 flex items-center gap-2"><Search size={14} className="shrink-0 text-[var(--muted)]" /><input className="ui-input" aria-label="搜索本页对象" placeholder="查找分镜、角色或台词" value={objectSearch} onChange={event => setObjectSearch(event.target.value)} /></label>}
          {!activeId ? <div className="outline-empty">
            <p>{pages.length ? "先选择一页，开始安排分镜。" : "从一页空白分镜开始你的故事。"}</p>
            <button className="outline-panel-button" onClick={() => {
              if (pages.length) void useEditorStore.getState().selectPage(pages[0].id);
              else void useEditorStore.getState().createPage();
            }}>{pages.length ? "打开第 1 页" : "新建分镜页"}</button>
          </div> : !sodaPage || sodaPage.id !== activeId ? <p className="outline-empty" role="status">正在载入本页分镜…</p> : singleCanvas ? <p className="sidebar-footnote">选择文字、人物框或物件框直接编辑。</p> : !panels.length ? <div className="outline-empty">
            <p>这一页还没有格子。</p>
            <p>建立第一格，写下故事的第一个画面。</p>
            <button className="outline-panel-button" onClick={() => {
              if (onStartPage) onStartPage();
              else useEditorStore.getState().startFirstPanel();
            }}>建立第一个格子</button>
          </div> : <>
            <p className="sidebar-footnote">点格子写画面，展开后编辑人物和文字。</p>
            <ol className="outline-panel-list">
              {visiblePanels.map(({ panel, index }) => {
                const matchWholePanel = matches(`${panel.id} 第${panel.order}格 ${panel.description || ""}`);
                const panelTexts = texts.filter(text => text.panel_id === panel.id && (matchWholePanel || textMatches(text)));
                const figures = resolvedFigures(panel, sodaPage.reading_direction).map((figure, figureIndex) => ({ figure, figureIndex })).filter(({ figure }) => matchWholePanel || figureMatches(figure));
                const panelOverlays = overlays.filter(overlay => overlay.panel_id === panel.id && (matchWholePanel || overlayMatches(overlay)));
                const objectCount = figures.length + panelTexts.length + panelOverlays.length;
                const objectSummary = [figures.length ? `${figures.length} 个人物` : "", panelTexts.length ? `${panelTexts.length} 条文字` : "", panelOverlays.length ? `${panelOverlays.length} 个跨格人物` : ""].filter(Boolean).join(" · ");
                const expansionKey = projectIdentity + ":" + activeId + ":" + panel.id;
                const expanded = Boolean(query) || (expandedPanels[expansionKey] ?? index === 0);
                const selected = isSelected({ kind: "panel", id: panel.id });
                return <li className={"outline-panel relative" + (selected ? " is-selected" : "")} key={panel.id}>
                  <button className={"outline-panel-button" + (selected ? " is-selected" : "")} style={{ paddingRight: 68 }} aria-pressed={selected} onClick={event => {
                    selectObject({ kind: "panel", id: panel.id }, event.shiftKey || event.ctrlKey || event.metaKey);
                    if (objectCount) setExpandedPanels(current => ({ ...current, [expansionKey]: true }));
                  }}>
                    <span className="outline-panel-title">第 {index + 1} 格 <span className="outline-panel-meta">{shotLabels[panel.shot] || "画面"}</span></span>
                    <span className="outline-description">{shortText(panel.description || "") || "点击描述这一格发生了什么"}</span>
                  </button>
                  <ObjectControls selection={{ kind: "panel", id: panel.id }} label={`第 ${index + 1} 格`} />
                  {objectCount > 0 ? <>
                    <button className="outline-toggle" aria-expanded={expanded} aria-label={(expanded ? "收起" : "展开") + "第 " + (index + 1) + " 格的 " + objectSummary} onClick={() => setExpandedPanels(current => ({ ...current, [expansionKey]: !expanded }))}>
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span>{objectSummary}</span><span>{expanded ? "收起" : "展开"}</span>
                    </button>
                    {expanded && <div className="outline-text-list">{figures.map(({ figure, figureIndex }) => {
                      const figureId = getFigureId(figure, figureIndex);
                      const selectedFigure = isSelected({ kind: "figure", panelId: panel.id, id: figureId });
                      const characterName = characters.find((character) => character.id === figure.character_id)?.display_name;
                      return <div key={figureId} className="object-tree-row relative"><button type="button" className={"outline-text-button outline-figure-button" + (selectedFigure ? " is-selected" : "")} style={{ paddingRight: 64 }} aria-pressed={selectedFigure} onClick={event => selectObject({ kind: "figure", id: figureId, panelId: panel.id }, event.shiftKey || event.ctrlKey || event.metaKey)}><span className="outline-panel-meta">人物 {figureIndex + 1}{figure.editor?.break_frame ? " · 出框" : ""}</span><span>{characterName || "未指定角色"}</span></button><ObjectControls selection={{ kind: "figure", id: figureId, panelId: panel.id }} label={`人物 ${characterName || figureIndex + 1}`} /></div>;
                    })}{panelTexts.map(renderText)}{panelOverlays.map(renderOverlay)}</div>}
                  </> : <span className="outline-panel-meta">尚未添加人物或文字</span>}
                </li>;
              })}
            </ol>
            {visiblePanels.length === 0 && visibleUnassignedTexts.length === 0 && visibleUnassignedOverlays.length === 0 && <p className="px-4 py-3 text-sm text-[var(--muted)]">没有匹配的对象，试试角色名或台词内容。</p>}
          </>}
          {objects.length > 0 && <div className="outline-page-texts"><h3 className="outline-heading">物件与人物框</h3><div className="outline-text-list">{objects.filter(object => matches(`${object.id} ${object.caption}`)).map(object => <div key={object.id} className="object-tree-row relative"><button type="button" className={"outline-text-button" + (isSelected({ kind: "object", id: object.id }) ? " is-selected" : "")} style={{ paddingRight: 64 }} aria-pressed={isSelected({ kind: "object", id: object.id })} onClick={event => selectObject({ kind: "object", id: object.id }, event.shiftKey || event.ctrlKey || event.metaKey)}><span className="outline-panel-meta">{object.label === "character" ? "人物框" : "物件框"}</span><span>{shortText(object.caption) || "未填写描述"}</span></button><ObjectControls selection={{ kind: "object", id: object.id }} label={`物件框 ${object.id}`} /></div>)}</div></div>}
          {visibleUnassignedTexts.length > 0 && <div className="outline-page-texts"><h3 className="outline-heading">页上文字</h3><div className="outline-text-list">{visibleUnassignedTexts.map(renderText)}</div></div>}
          {visibleUnassignedOverlays.length > 0 && <div className="outline-page-texts"><h3 className="outline-heading">跨格对象</h3><div className="outline-text-list">{visibleUnassignedOverlays.map(renderOverlay)}</div></div>}
          <p className="px-4 py-2 text-xs text-[var(--muted)]">锁定防止误移动；眼睛控制本次编辑中的显示。</p>
        </section>
      </div> : <div className="sidebar-tab-content" role="tabpanel" id="character-resources" aria-labelledby="characters-tab">
        <div className="sidebar-subheading"><span>项目角色</span><Users size={16} /></div>
        <div className="character-list">{characters.map((character, index) => <div key={character.id}><div className="character-row" draggable title="拖入分镜格添加人物" onDragStart={e => { e.dataTransfer.setData("application/soda-character-id", character.id); e.dataTransfer.effectAllowed = "copy"; }}>
          <span className={"character-avatar avatar-" + (index % 2)}>{character.display_name.slice(0, 1)}</span>
          <span className="character-name">{character.display_name}<span className="character-id">{character.id}</span></span>
          <span className="character-strength">{character.has_lora ? "×" + (details[character.id]?.lora?.strength ?? 1) : "—"}</span>
        </div><CharacterColorControls id={character.id} name={character.display_name} color={characterSketchColor(character)} /></div>)}</div>
        <p className="sidebar-footnote">将角色拖入格子，安排人物站位。</p>
      </div>}
    </aside>
  );
}
