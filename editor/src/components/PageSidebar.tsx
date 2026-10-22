import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, FileUp, Plus, Trash2, Users } from "lucide-react";
import { useEditorStore } from "../lib/store";
import { getFigureId } from "../lib/figureRig";
import { resolvedFigures } from "../lib/figures";
import { CHARACTER_COLOR_PRESETS, characterSketchColor } from "../lib/characterColors";
import type { Selection, SodaText } from "../types";

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

type PageSidebarProps = {
  onSelectObject?: (selection: Selection) => void;
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
  const [tab, setTab] = useState<"pages" | "characters">("pages");
  const [expandedPanels, setExpandedPanels] = useState<Record<string, boolean>>({});
  const panels = [...(sodaPage?.panels || [])].sort((a, b) => a.order - b.order);
  const texts = sodaPage?.texts || [];
  const selectedObjectPanelId = selection?.kind === "figure" ? selection.panelId
    : selection?.kind === "text" || selection?.kind === "bubble"
      ? texts.find(text => text.id === selection.id)?.panel_id : null;

  useEffect(() => {
    if (!selectedObjectPanelId) return;
    const key = activeId + ":" + selectedObjectPanelId;
    setExpandedPanels(current => current[key] ? current : { ...current, [key]: true });
  }, [activeId, selectedObjectPanelId]);

  const selectObject = (next: Selection) => {
    if (onSelectObject) onSelectObject(next);
    else useEditorStore.getState().selectItem(next);
  };

  const renderText = (text: SodaText) => {
    const selected = (selection?.kind === "text" || selection?.kind === "bubble") && selection.id === text.id;
    const speaker = text.speaker_id && characters.find(character => character.id === text.speaker_id)?.display_name;
    return <button key={text.id} className={"outline-text-button" + (selected ? " is-selected" : "")} aria-pressed={selected} onClick={() => selectObject({ kind: "text", id: text.id })}>
      <span className="outline-panel-meta">{textKindLabels[text.kind] || "文字"}{speaker ? " · " + speaker : ""}</span>
      <span>{shortText(text.text, 36) || "未填写内容，点击编辑"}</span>
    </button>;
  };

  const unassignedTexts = texts.filter(text => !text.panel_id || !panels.some(panel => panel.id === text.panel_id));
  return (
    <aside className="page-sidebar" aria-label="页面与角色">
      <div className="sidebar-tabs" role="tablist" aria-label="资源类型">
        <button role="tab" aria-selected={tab === "pages"} aria-controls="page-resources" id="pages-tab" onClick={() => setTab("pages")}>页面 <span>{pages.length}</span></button>
        <button role="tab" aria-selected={tab === "characters"} aria-controls="character-resources" id="characters-tab" onClick={() => setTab("characters")}>角色 <span>{characters.length}</span></button>
      </div>
      {tab === "pages" ? <div className="sidebar-tab-content" role="tabpanel" id="page-resources" aria-labelledby="pages-tab">
        <div className="sidebar-subheading"><span>分镜页面</span><div className="sidebar-page-actions"><button className="sidebar-new-page" onClick={() => useEditorStore.getState().openImportModal()} title="从文件或粘贴内容导入分镜 JSON" aria-label="导入 JSON"><FileUp size={14} /><span>导入</span></button><button className="sidebar-new-page" onClick={() => void useEditorStore.getState().createPage()} title="新建分镜页：从一个格子开始，可切分为更多格子" aria-label="新建分镜页"><Plus size={14} /><span>新建页</span></button></div></div>
        <div className="page-list">
          {pages.map((page, index) => <div className={page.id === activeId ? "page-row is-active" : "page-row"} key={page.id} data-page-id={page.id}>
            <button className="page-row-select" onClick={() => void useEditorStore.getState().selectPage(page.id)} aria-current={page.id === activeId ? "page" : undefined}>
              <div className="page-thumbnail"><img src={"/api/pages/" + encodeURIComponent(page.id) + "/preview.png?style=sketch&scale=0.2&v=" + encodeURIComponent(page.version)} alt={"第 " + (index + 1) + " 页分镜缩略图"} loading="lazy" /></div>
              <div className="page-row-info"><span className="page-row-title">第 {index + 1} 页</span><span className="page-row-description">{page.description || "空白分镜页"}</span><span className="page-row-meta"><span className="numeric">{String(index + 1).padStart(2, "0")}</span><span>{page.panel_count} 格</span>{page.id === activeId && <Check aria-label="当前页" />}</span></div>
            </button>
            {pages.length > 1 && <button className="page-delete icon-button" title="删除分镜页" aria-label={"删除第 " + (index + 1) + " 页"} onClick={() => { if (confirm("将第 " + (index + 1) + " 页移入回收站？")) void useEditorStore.getState().deletePage(page.id); }}><Trash2 /></button>}
          </div>)}
        </div>
        <section className="page-outline" aria-labelledby="page-outline-heading">
          <div className="outline-heading"><h2 id="page-outline-heading">本页分镜</h2><span>{panels.length} 格</span></div>
          {!activeId ? <div className="outline-empty">
            <p>{pages.length ? "先选择一页，开始安排分镜。" : "从一页空白分镜开始你的故事。"}</p>
            <button className="outline-panel-button" onClick={() => {
              if (pages.length) void useEditorStore.getState().selectPage(pages[0].id);
              else void useEditorStore.getState().createPage();
            }}>{pages.length ? "打开第 1 页" : "新建分镜页"}</button>
          </div> : !sodaPage || sodaPage.id !== activeId ? <p className="outline-empty" role="status">正在载入本页分镜…</p> : !panels.length ? <div className="outline-empty">
            <p>这一页还没有格子。</p>
            <p>建立第一格，写下故事的第一个画面。</p>
            <button className="outline-panel-button" onClick={() => {
              if (onStartPage) onStartPage();
              else useEditorStore.getState().startFirstPanel();
            }}>建立第一个格子</button>
          </div> : <>
            <p className="sidebar-footnote">点格子写画面，展开后编辑人物和文字。</p>
            <ol className="outline-panel-list">
              {panels.map((panel, index) => {
                const panelTexts = texts.filter(text => text.panel_id === panel.id);
                const figures = resolvedFigures(panel, sodaPage.reading_direction);
                const objectCount = figures.length + panelTexts.length;
                const objectSummary = [figures.length ? `${figures.length} 个人物` : "", panelTexts.length ? `${panelTexts.length} 条文字` : ""].filter(Boolean).join(" · ");
                const expansionKey = activeId + ":" + panel.id;
                const expanded = expandedPanels[expansionKey] ?? index === 0;
                const selected = selection?.kind === "panel" && selection.id === panel.id;
                return <li className={"outline-panel" + (selected ? " is-selected" : "")} key={panel.id}>
                  <button className={"outline-panel-button" + (selected ? " is-selected" : "")} aria-pressed={selected} onClick={() => {
                    selectObject({ kind: "panel", id: panel.id });
                    if (objectCount) setExpandedPanels(current => ({ ...current, [expansionKey]: true }));
                  }}>
                    <span className="outline-panel-title">第 {index + 1} 格 <span className="outline-panel-meta">{shotLabels[panel.shot] || "画面"}</span></span>
                    <span className="outline-description">{shortText(panel.description || "") || "点击描述这一格发生了什么"}</span>
                  </button>
                  {objectCount > 0 ? <>
                    <button className="outline-toggle" aria-expanded={expanded} aria-label={(expanded ? "收起" : "展开") + "第 " + (index + 1) + " 格的 " + objectSummary} onClick={() => setExpandedPanels(current => ({ ...current, [expansionKey]: !expanded }))}>
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span>{objectSummary}</span><span>{expanded ? "收起" : "展开"}</span>
                    </button>
                    {expanded && <div className="outline-text-list">{figures.map((figure, figureIndex) => {
                      const figureId = getFigureId(figure, figureIndex);
                      const selectedFigure = selection?.kind === "figure" && selection.panelId === panel.id && selection.id === figureId;
                      const characterName = characters.find((character) => character.id === figure.character_id)?.display_name;
                      return <button key={figureId} type="button" className={"outline-text-button outline-figure-button" + (selectedFigure ? " is-selected" : "")} aria-pressed={selectedFigure} onClick={() => selectObject({ kind: "figure", id: figureId, panelId: panel.id })}><span className="outline-panel-meta">人物 {figureIndex + 1}{figure.editor?.break_frame ? " · 出框" : ""}</span><span>{characterName || "未指定角色"}</span></button>;
                    })}{panelTexts.map(renderText)}</div>}
                  </> : <span className="outline-panel-meta">尚未添加人物或文字</span>}
                </li>;
              })}
            </ol>
          </>}
          {unassignedTexts.length > 0 && <div className="outline-page-texts"><h3 className="outline-heading">页上文字</h3><div className="outline-text-list">{unassignedTexts.map(renderText)}</div></div>}
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
