import React, { useMemo } from "react";
import { AlertCircle, AlertTriangle, ArrowUpRight, Check, ChevronDown, Columns2, List, Plus, Rows2, Star, Trash2 } from "lucide-react";
import { useEditorStore } from "../lib/store";
import { Figure, ShotType, AngleType, FigurePose, TextKind, BubbleStyle, Selection } from "../types";
import { getFigureId } from "../lib/figureRig";
import { applyFigurePoseInPanel, editableFigureEditor, resolvedFigures } from "../lib/figures";
import FigureInspector from "./FigureInspector";
import { resolveTextFontSize } from "../lib/lettering";
import NumberInput from "./ui/NumberInput";
import BatchInspector from "./BatchInspector";
import PanelCaptionPreview from "./PanelCaptionPreview";

const SHOT_OPTIONS: { value: ShotType; label: string }[] = [
  { value: "extreme_long", label: "大远景" },
  { value: "long", label: "远景" },
  { value: "full", label: "全景" },
  { value: "medium", label: "中景" },
  { value: "close_up", label: "特写" },
  { value: "extreme_close_up", label: "大特写" }
];
const ANGLE_OPTIONS: { value: AngleType; label: string }[] = [
  { value: "eye", label: "平视" },
  { value: "high", label: "俯视" },
  { value: "low", label: "仰视" },
  { value: "bird", label: "鸟瞰" },
  { value: "worm", label: "虫视" },
  { value: "dutch", label: "倾斜" }
];
const POSE_OPTIONS: { value: FigurePose; label: string }[] = [
  { value: "stand", label: "站立" },
  { value: "walk", label: "行走" },
  { value: "run", label: "奔跑" },
  { value: "sit", label: "坐下" },
  { value: "crouch", label: "蹲下" },
  { value: "wave", label: "挥手" },
  { value: "point", label: "指向" },
  { value: "arms_up", label: "举手" },
  { value: "hands_clasped", label: "双手合十" },
  { value: "hand_on_chin", label: "托下巴 / 推眼镜" },
  { value: "lie", label: "侧视躺卧" },
  { value: "back_view", label: "背影" },
  { value: "handshake", label: "握手" },
  { value: "hug", label: "拥抱" }
];
const FACING_OPTIONS = [
  { value: "front", label: "正面" },
  { value: "left", label: "向左" },
  { value: "right", label: "向右" },
  { value: "back", label: "背面" }
];
const FRAMING_OPTIONS = [
  { value: "", label: "默认" },
  { value: "full", label: "全身" },
  { value: "waist", label: "半身" },
  { value: "bust", label: "胸部" },
  { value: "face", label: "面部" }
];
const KIND_OPTIONS: { value: TextKind; label: string }[] = [
  { value: "dialogue", label: "台词" },
  { value: "narration", label: "旁白" },
  { value: "sfx", label: "拟声词" },
  { value: "title", label: "标题" },
  { value: "caption_tag", label: "说明标签" }
];
const DIRECTION_OPTIONS = [
  { value: "vertical", label: "竖排" },
  { value: "horizontal", label: "横排" }
];
const BUBBLE_OPTIONS: { value: BubbleStyle; label: string }[] = [
  { value: "speech", label: "对话气泡" },
  { value: "shout", label: "喊叫气泡" },
  { value: "thought", label: "思考气泡" },
  { value: "box", label: "方框" },
  { value: "none", label: "无气泡" }
];

type InspectorNotice = {
  id: string;
  severity: "error" | "warning";
  message: string;
  code: string;
  targetKind?: "panel" | "text" | "overlay";
  targetId?: string;
};

function mentionsIdentifier(message: string, identifier: string) {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Boolean(identifier) && new RegExp(`(^|[^\\p{L}\\p{N}_-])${escaped}(?=$|[^\\p{L}\\p{N}_-])`, "u").test(message);
}

function InspectorSection({ title, children, open = true }: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details className="inspector-section group" open={open}>
      <summary className="flex cursor-pointer select-none items-center justify-between gap-2 text-[13px] font-semibold">
        {title}
        <ChevronDown size={14} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="inspector-section-content space-y-3">{children}</div>
    </details>
  );
}

function InspectorSelect<T extends string>({ value, options, onChange, label }: {
  value: T;
  label: string;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <span className="relative block min-w-0">
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as T)} className="ui-input w-full appearance-none pr-7">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ink-light)]" aria-hidden="true" />
    </span>
  );
}

type InspectorPanelProps = {
  onSelectObject?: (selection: Selection) => void;
  onStartPage?: () => void;
};

export default function InspectorPanel({ onSelectObject, onStartPage }: InspectorPanelProps) {
  const sodaPage = useEditorStore((state) => state.sodaPage);
  const characters = useEditorStore((state) => state.characters);
  const characterDetails = useEditorStore((state) => state.characterDetails);
  const selection = useEditorStore((state) => state.selection);
  const selections = useEditorStore((state) => state.selections);
  const selectItem = useEditorStore((state) => state.selectItem);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const validationIssues = useEditorStore((state) => state.validationIssues);
  const updateSodaPanel = useEditorStore((state) => state.updateSodaPanel);
  const updateSodaText = useEditorStore((state) => state.updateSodaText);
  const updateSodaOverlay = useEditorStore((state) => state.updateSodaOverlay);
  const removeFigureFromPanel = useEditorStore((state) => state.removeFigureFromPanel);
  const updateFigureInPanel = useEditorStore((state) => state.updateFigureInPanel);
  const addTextToPanel = useEditorStore((state) => state.addTextToPanel);
  const setLegacyCaptionMode = useEditorStore((state) => state.setLegacyCaptionMode);
  const selectObject = (nextSelection: Selection) => {
    selectItem(nextSelection);
    onSelectObject?.(nextSelection);
  };

  // Server validation and the local checklist share one list. Prefer server
  // messages when both sources describe the same problem on the same object.
  const notices = useMemo(() => {
    if (!sodaPage) return [];
    const items: InspectorNotice[] = [];
    const seen = new Set<string>();
    validationIssues.forEach((issue, index) => {
      const key = `${issue.severity}:${issue.code}:${issue.panel_id || ""}:${issue.message}`;
      if (seen.has(key)) return;
      seen.add(key);
      const text = issue.field?.startsWith("texts") ? sodaPage.texts.find((item) => mentionsIdentifier(issue.message, item.id)) : undefined;
      const overlay = issue.field?.startsWith("overlays") ? sodaPage.overlays?.find((item) => mentionsIdentifier(issue.message, item.id)) : undefined;
      items.push({
        id: `validation-${index}`,
        severity: issue.severity,
        message: issue.message,
        code: issue.code,
        targetKind: issue.panel_id ? "panel" : text ? "text" : overlay ? "overlay" : undefined,
        targetId: issue.panel_id || text?.id || overlay?.id
      });
    });
    sodaPage.panels.forEach((panel) => {
      if (!panel.description?.trim()) {
        items.push({ id: `desc-${panel.id}`, severity: "warning", code: "empty_desc", message: `格子 ${panel.order} 未填写画面描述`, targetKind: "panel", targetId: panel.id });
      }
      if (!panel.character_ids?.length) {
        items.push({ id: `char-${panel.id}`, severity: "warning", code: "no_character", message: `格子 ${panel.order} 未指定登场角色`, targetKind: "panel", targetId: panel.id });
      }
      const loras = new Set((panel.character_ids || []).map((id) => characterDetails[id]?.lora?.path).filter(Boolean));
      const hasServerLoraWarning = items.some((item) => item.code === "multiple_lora_characters_panel" && item.targetId === panel.id);
      if (loras.size > 1 && !hasServerLoraWarning) {
        items.push({ id: `lora-${panel.id}`, severity: "warning", code: "multi_lora", message: `格子 ${panel.order} 使用 ${loras.size} 个不同 LoRA，可能互相影响`, targetKind: "panel", targetId: panel.id });
      }
    });
    sodaPage.texts.forEach((text) => {
      const hasServerTextWarning = items.some((item) => item.code === "dialogue_too_long" && (item.targetId === text.id || item.targetId === text.panel_id));
      if (text.text?.length > 20 && !hasServerTextWarning) {
        items.push({ id: `text-${text.id}`, severity: "warning", code: "long_text", message: `台词 ${text.id} 有 ${text.text.length} 字，建议拆分或精简`, targetKind: "text", targetId: text.id });
      }
    });
    return items.sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error"));
  }, [sodaPage, characterDetails, validationIssues]);

  if (!sodaPage) {
    return <aside className="inspector-panel flex items-center justify-center p-4 text-[13px] text-[var(--ink-light)]">请选择分镜页</aside>;
  }

  const selectedPanel = selection?.kind === "panel" ? sodaPage.panels.find((panel) => panel.id === selection.id) : undefined;
  const figurePanel = selection?.kind === "figure" ? sodaPage.panels.find((panel) => panel.id === selection.panelId) : undefined;
  const selectedFigure = selection?.kind === "figure" && figurePanel ? resolvedFigures(figurePanel, sodaPage.reading_direction).find((figure, index) => getFigureId(figure, index) === selection.id) : undefined;
  const selectedText = selection?.kind === "text" || selection?.kind === "bubble" ? sodaPage.texts.find((text) => text.id === selection.id) : undefined;
  const selectedOverlay = selection?.kind === "overlay" ? sodaPage.overlays?.find((overlay) => overlay.id === selection.id) : undefined;
  const hasSelection = Boolean(selectedPanel || selectedFigure || selectedText || selectedOverlay);
  const figureName = selectedFigure ? characters.find(character => character.id === selectedFigure.character_id)?.display_name || characterDetails[selectedFigure.character_id]?.display_name || "未指定角色" : "";
  const title = selections.length > 1 ? "批量属性" : selectedFigure ? `${figureName} · 第 ${figurePanel!.order} 格` : selectedPanel ? `格子 ${selectedPanel.order}` : selectedText ? "台词" : selectedOverlay ? "跨格人物" : "页面";
  const objectId = selectedFigure ? "人物与姿势" : selectedPanel?.id || selectedText?.id || selectedOverlay?.id || sodaPage.id;
  const deleteLabel = `删除${selectedFigure ? "人物" : selectedPanel ? "格子" : selectedText ? "台词" : "跨格人物"}`;
  const errorCount = notices.filter((notice) => notice.severity === "error").length;
  const warningCount = notices.length - errorCount;
  const firstPanel = [...sodaPage.panels].sort((a, b) => a.order - b.order)[0];
  const panelTexts = selectedPanel ? sodaPage.texts.filter((text) => text.panel_id === selectedPanel.id) : [];
  const textPanel = selectedText ? sodaPage.panels.find((panel) => panel.id === selectedText.panel_id) : undefined;

  return (
    <aside className="inspector-panel flex h-full min-h-0 flex-col" aria-label="属性检查器">
      <div className="inspector-heading flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold leading-tight">{title}</h2>
          <p className="mt-0.5 truncate numeric text-[12px] leading-tight text-[var(--ink-light)]" title={objectId}>{objectId}</p>
        </div>
        {hasSelection && <button type="button" className="ui-icon-btn text-[var(--error)]" onClick={deleteSelection} title={deleteLabel} aria-label={deleteLabel}><Trash2 size={16} aria-hidden="true" /></button>}
      </div>

      <div className="inspector-content min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-wrap gap-2 border-b border-[var(--line)] px-5 py-3"><button className="ui-btn ui-btn-sm" onClick={() => window.dispatchEvent(new Event("soda:open-dialogue-editor"))}><List size={14} />整页台词</button><button className="ui-btn ui-btn-sm" onClick={() => window.dispatchEvent(new Event("soda:open-favorites"))}><Star size={14} />收藏样式</button></div>
        {notices.length > 0 ? (
          <details className="validation-summary group" data-severity={errorCount ? "error" : "warning"} open={errorCount > 0}>
            <summary className="flex cursor-pointer select-none items-center gap-2 text-[12px] font-medium">
              {errorCount ? <AlertCircle size={15} className="shrink-0" aria-hidden="true" /> : <AlertTriangle size={15} className="shrink-0" aria-hidden="true" />}
              <span className="flex-1">{errorCount ? `校验失败 · ${errorCount} 处错误${warningCount ? ` · ${warningCount} 条提醒` : ""}` : `${warningCount} 条提醒`}</span>
              <ChevronDown size={14} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="validation-list mt-2" role="list">
              {notices.map((notice) => <div key={notice.id} role="listitem"><button type="button" className="validation-item flex w-full items-start gap-2 text-left text-[12px] leading-relaxed" data-severity={notice.severity} disabled={!notice.targetKind || !notice.targetId} onClick={() => { if (notice.targetKind && notice.targetId) selectObject({ kind: notice.targetKind, id: notice.targetId }); }} title={notice.targetId ? `定位 ${notice.targetId}` : "页面提醒"}><span className="min-w-0 flex-1 break-words">{notice.message}</span>{notice.targetId && <ArrowUpRight size={13} className="mt-0.5 shrink-0" aria-hidden="true" />}</button></div>)}
            </div>
          </details>
        ) : <div className="validation-summary flex items-center gap-2 text-[12px] text-[var(--ink-light)]" data-severity="success"><Check size={14} aria-hidden="true" />本页检查通过</div>}

        {selections.length > 1 ? <BatchInspector /> : selectedFigure && figurePanel && selection?.kind === "figure" ? (
          <FigureInspector figure={selectedFigure} figureId={selection.id} panel={figurePanel} onSelectObject={selectObject} />
        ) : selectedPanel ? (
          <div key={selectedPanel.id}>
            <InspectorSection title="画面描述"><label className="block"><span className="ui-label">这一格发生了什么？</span><textarea rows={3} value={selectedPanel.description || ""} onChange={(event) => updateSodaPanel(selectedPanel.id, { description: event.target.value })} placeholder="例如：姐姐推眼镜，向前一步" className="ui-textarea" /></label><div className="panel-split-actions"><span>需要更多格子？</span><div><button className="ui-btn ui-btn-sm" onClick={() => useEditorStore.getState().splitPanelHorizontal(selectedPanel.id)}><Rows2 />上下分格</button><button className="ui-btn ui-btn-sm" onClick={() => useEditorStore.getState().splitPanelVertical(selectedPanel.id)}><Columns2 />左右分格</button></div></div></InspectorSection>
            <InspectorSection title="登场角色">
              <div className="flex flex-wrap gap-2">{characters.map((character) => {
                const checked = resolvedFigures(selectedPanel, sodaPage.reading_direction).some(figure => figure.character_id === character.id);
                return <button key={character.id} type="button" aria-pressed={checked} onClick={() => useEditorStore.getState().togglePanelCharacter(selectedPanel.id, character.id)} className={`ui-btn ui-btn-sm ${checked ? "ui-btn-acid" : ""}`}>{checked && <Check size={12} aria-hidden="true" />}{character.display_name}</button>;
              })}</div>
            </InspectorSection>
            <InspectorSection title="人物站位与姿态" open={false}>
              <button type="button" onClick={() => {
                useEditorStore.getState().addFigurePreset("stand", undefined, selectedPanel.id);
                const addedSelection = useEditorStore.getState().selection;
                if (addedSelection?.kind === "figure") selectObject(addedSelection);
              }} className="ui-btn ui-btn-sm"><Plus size={14} aria-hidden="true" />添加人物</button>
              {resolvedFigures(selectedPanel, sodaPage.reading_direction).map((figure, index) => (
                <div key={getFigureId(figure, index)} className="space-y-3 border-t border-[var(--line)] pt-3">
                  <div className="flex items-center justify-between"><span className="text-[12px] font-medium">人物 <span className="font-mono">{index + 1}</span></span><button type="button" onClick={() => removeFigureFromPanel(selectedPanel.id, index)} className="text-[12px] text-[var(--error)] hover:underline">移除</button></div>
                  <button type="button" className="ui-btn ui-btn-sm" onClick={() => selectObject({ kind: "figure", id: getFigureId(figure, index), panelId: selectedPanel.id })}>编辑这个人物<ArrowUpRight size={13} aria-hidden="true" /></button>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="min-w-0"><span className="ui-label">角色</span><InspectorSelect label="角色" value={figure.character_id} options={characters.map((character) => ({ value: character.id, label: character.display_name }))} onChange={(value) => updateFigureInPanel(selectedPanel.id, index, { character_id: value })} /></label>
                    <label className="min-w-0"><span className="ui-label">姿势</span><InspectorSelect label="姿势" value={figure.pose} options={POSE_OPTIONS} onChange={(value) => {
                      const state = useEditorStore.getState();
                      const panel = state.project.pages[0]?.panels.find(item => item.id === selectedPanel.id);
                      const sketch = state.sketchGeometry?.panels.find(item => item.panel_id === selectedPanel.id)?.figures[index];
                      updateFigureInPanel(selectedPanel.id, index, { pose: value, ...(panel ? { editor: applyFigurePoseInPanel(editableFigureEditor(figure, panel, sketch), value, panel) } : {}) });
                    }} /></label>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="min-w-0"><span className="ui-label">水平比例</span><NumberInput aria-label="人物水平比例" value={typeof figure.position === "number" ? figure.position : ({ left: 0.23, center: 0.5, right: 0.77 })[figure.position]} min={0} max={1} step={0.01} onCommit={relative => {
                      const width = selectedPanel.shape.type === "rect" ? selectedPanel.shape.w : Math.max(...selectedPanel.shape.points.map(([x]) => x)) - Math.min(...selectedPanel.shape.points.map(([x]) => x));
                      updateFigureInPanel(selectedPanel.id, index, { position: relative, ...(figure.editor ? { editor: { ...figure.editor, x: width * relative } } : {}) });
                    }} /></label>
                    <label className="min-w-0"><span className="ui-label">朝向</span><InspectorSelect label="朝向" value={figure.facing} options={FACING_OPTIONS} onChange={(value) => updateFigureInPanel(selectedPanel.id, index, { facing: value as Figure["facing"], ...(figure.editor ? { editor: { ...figure.editor, flip: value === "left" ? true : value === "right" ? false : figure.editor.flip } } : {}) })} /></label>
                    <label className="min-w-0"><span className="ui-label">景框</span><InspectorSelect label="景框" value={figure.framing || ""} options={FRAMING_OPTIONS} onChange={(value) => updateFigureInPanel(selectedPanel.id, index, { framing: value ? value as Figure["framing"] : null })} /></label>
                  </div>
                </div>
              ))}
            </InspectorSection>
            <InspectorSection title="本格台词">
              <div className="inspector-dialogue-list">
                {panelTexts.length ? panelTexts.map((text, index) => {
                  const speaker = characters.find((character) => character.id === text.speaker_id)?.display_name;
                  return <button key={text.id} type="button" className="inspector-text-row" onClick={() => selectObject({ kind: "text", id: text.id })}>
                    <span className="inspector-text-meta">{speaker || KIND_OPTIONS.find((option) => option.value === text.kind)?.label || "台词"} <span className="numeric">{index + 1}</span></span>
                    <span className="inspector-text-content">{text.text?.trim() || "未填写内容"}</span>
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </button>;
                }) : <p className="text-[12px] leading-relaxed text-[var(--ink-light)]">本格还没有台词，可以添加对话、旁白或拟声词。</p>}
              </div>
              <button type="button" className="ui-btn ui-btn-sm" onClick={() => {
                addTextToPanel(selectedPanel.id);
                const addedSelection = useEditorStore.getState().selection;
                if (addedSelection?.kind === "text") selectObject(addedSelection);
              }}><Plus size={14} aria-hidden="true" />添加台词</button>
            </InspectorSection>
            <InspectorSection title="镜头与阅读顺序" open={false}>
              <label className="block"><span className="ui-label">阅读顺序</span><NumberInput aria-label="阅读顺序" min={1} integer value={selectedPanel.order} onCommit={value => updateSodaPanel(selectedPanel.id, { order: value })} /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="min-w-0"><span className="ui-label">景别</span><InspectorSelect label="景别" value={selectedPanel.shot} options={SHOT_OPTIONS} onChange={(value) => updateSodaPanel(selectedPanel.id, { shot: value })} /></label>
                <label className="min-w-0"><span className="ui-label">视角</span><InspectorSelect label="视角" value={selectedPanel.angle} options={ANGLE_OPTIONS} onChange={(value) => updateSodaPanel(selectedPanel.id, { angle: value })} /></label>
              </div>
            </InspectorSection>
            <InspectorSection title="最终提示词预览"><PanelCaptionPreview page={sodaPage} panel={selectedPanel} /></InspectorSection>
            <InspectorSection title="自定义提示词" open={false}>
              <label className="figure-option flex cursor-pointer items-center gap-2 text-[13px]"><input type="checkbox" checked={Boolean(selectedPanel.use_custom_caption)} onChange={(event) => updateSodaPanel(selectedPanel.id, { use_custom_caption: event.target.checked })} />使用自定义提示词</label>
              <textarea aria-label="自定义提示词" rows={4} value={selectedPanel.caption_en || ""} onChange={(event) => updateSodaPanel(selectedPanel.id, { caption_en: event.target.value })} placeholder="填写完整的生成提示词，可使用中文或英文" className="ui-textarea" />
              <p className="text-[12px] leading-relaxed text-[var(--ink-light)]">开启后，覆盖本格场景提示词；人物位置与姿势仍按编辑器编译，手写内容应与人物保持一致。留空时继续自动编译。</p>
              {sodaPage.legacy_caption_en && <p className="caption-override-badge">本页已启用旧版兼容：非空自定义提示词都会生效。</p>}
            </InspectorSection>
            <InspectorSection title="几何信息" open={false}>
              {selectedPanel.shape.type === "rect" ? <dl className="space-y-2 text-[12px]"><div className="flex justify-between gap-2"><dt className="text-[var(--ink-light)]">位置</dt><dd className="font-mono">{selectedPanel.shape.x}, {selectedPanel.shape.y}</dd></div><div className="flex justify-between gap-2"><dt className="text-[var(--ink-light)]">尺寸</dt><dd className="font-mono">{selectedPanel.shape.w} × {selectedPanel.shape.h}</dd></div></dl> : <p className="text-[12px] text-[var(--ink-light)]">四边形 · <span className="font-mono">{selectedPanel.shape.points?.length || 4}</span> 个顶点</p>}
            </InspectorSection>
          </div>
        ) : selectedText ? (
          <div key={selectedText.id}>
            {textPanel && <div className="inspection-start inspector-return"><button type="button" className="ui-btn ui-btn-sm" onClick={() => selectObject({ kind: "panel", id: textPanel.id })}>返回格子 {textPanel.order}</button></div>}
            <InspectorSection title="文字内容">
              <label className="block"><span className="ui-label">类型</span><InspectorSelect label="类型" value={selectedText.kind} options={KIND_OPTIONS} onChange={(value) => updateSodaText(selectedText.id, { kind: value })} /></label>
              <label className="block"><span className="ui-label">原文台词</span><textarea aria-label="原文台词" rows={4} value={selectedText.text || ""} onChange={(event) => updateSodaText(selectedText.id, { text: event.target.value })} placeholder="输入台词，可换行" className="ui-textarea" /></label>
              <label className="block"><span className="ui-label">说话人</span><InspectorSelect label="说话人" value={selectedText.speaker_id || ""} options={[{ value: "", label: "无（旁白 / 拟声）" }, ...characters.map((character) => ({ value: character.id, label: character.display_name }))]} onChange={(value) => updateSodaText(selectedText.id, { speaker_id: value || null })} /></label>
            </InspectorSection>
            <InspectorSection title="排版与气泡">
              <label className="block"><span className="ui-label">字号（像素）</span><NumberInput aria-label="字号（像素）" key={selectedText.id} min={8} max={128} value={resolveTextFontSize(selectedText.font_size, sodaPage.text_font_size, sodaPage.canvas_width)} onCommit={value => updateSodaText(selectedText.id, { font_size: value })} /></label>
              <p className="text-[12px] leading-relaxed text-[var(--ink-light)]">放不下时，文字会在框内自动缩小。放大文字框可保留设定的字号。</p>
              <div className="grid grid-cols-2 gap-3">
                <label className="min-w-0"><span className="ui-label">排列方向</span><InspectorSelect label="排列方向" value={selectedText.direction || "vertical"} options={DIRECTION_OPTIONS} onChange={(value) => {
                  const direction = value as "horizontal" | "vertical";
                  const box = selectedText.bbox;
                  let width = box?.w || 100;
                  let height = box?.h || 200;
                  if (direction === "horizontal" && height > width * 1.2) { width = Math.max(130, Math.min(260, Math.round(height * 0.7))); height = Math.max(65, Math.min(130, Math.round((box?.w || 100) * 0.9))); }
                  else if (direction === "vertical" && width > height * 1.2) { width = Math.max(65, Math.min(130, Math.round(height * 0.9))); height = Math.max(140, Math.min(320, Math.round((box?.w || 100) * 0.7))); }
                  updateSodaText(selectedText.id, { direction, bbox: box ? { ...box, w: width, h: height } : undefined });
                }} /></label>
                <label className="min-w-0"><span className="ui-label">气泡样式</span><InspectorSelect label="气泡样式" value={selectedText.bubble || "speech"} options={BUBBLE_OPTIONS} onChange={(value) => updateSodaText(selectedText.id, { bubble: value })} /></label>
              </div>
              {selectedText.bubble !== "box" && selectedText.bubble !== "none" && <div><span className="ui-label">气泡引线</span><button type="button" aria-pressed={Boolean(selectedText.tail_tip)} onClick={() => updateSodaText(selectedText.id, { tail_tip: selectedText.tail_tip ? null : [Math.round((selectedText.bbox?.w || 100) / 2), Math.round((selectedText.bbox?.h || 200) + 28)] })} className="ui-btn ui-btn-sm w-full justify-start">{selectedText.tail_tip ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}{selectedText.tail_tip ? "已开启引线 · 拖拽画布红点" : "开启气泡引线"}</button></div>}
            </InspectorSection>
            {selectedText.bbox && <InspectorSection title="几何信息"><dl className="space-y-2 text-[12px]"><div className="flex justify-between gap-2"><dt className="text-[var(--ink-light)]">位置</dt><dd className="font-mono">{selectedText.bbox.x}, {selectedText.bbox.y}</dd></div><div className="flex justify-between gap-2"><dt className="text-[var(--ink-light)]">尺寸</dt><dd className="font-mono">{selectedText.bbox.w} × {selectedText.bbox.h}</dd></div></dl></InspectorSection>}
          </div>
        ) : selectedOverlay ? (
          <div key={selectedOverlay.id}>
            <InspectorSection title="人物角色"><label className="block"><span className="ui-label">角色</span><InspectorSelect label="角色" value={selectedOverlay.character_id} options={characters.map((character) => ({ value: character.id, label: character.display_name }))} onChange={(value) => updateSodaOverlay(selectedOverlay.id, { character_id: value })} /></label></InspectorSection>
            <InspectorSection title="出格动作描述"><textarea aria-label="出格动作描述" rows={3} value={selectedOverlay.description} onChange={(event) => updateSodaOverlay(selectedOverlay.id, { description: event.target.value })} className="ui-textarea" /></InspectorSection>
          </div>
        ) : (
          <div key="page">
            <section className="inspection-start">
              <h3 className="text-[14px] font-semibold">{firstPanel ? "从这一格开始" : "开始你的分镜页"}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-[var(--ink-light)]">{firstPanel ? "选中一个格子，填写画面描述，安排人物，再添加台词。也可以直接点击画布上的格子。" : "先建立第一个格子，再安排版式和画面内容。"}</p>
              {firstPanel ? <button type="button" className="ui-btn mt-3" onClick={() => selectObject({ kind: "panel", id: firstPanel.id })}>编辑第 {firstPanel.order} 格<ArrowUpRight size={14} aria-hidden="true" /></button> : onStartPage && <button type="button" className="ui-btn mt-3" onClick={onStartPage}><Plus size={14} aria-hidden="true" />建立第一个格子</button>}
            </section>
            <InspectorSection title="页面信息" open={false}>
              <dl className="space-y-3 text-[13px]">
                <div className="flex justify-between gap-2"><dt className="text-[var(--ink-light)]">画布尺寸</dt><dd className="font-mono">{sodaPage.canvas_width} × {sodaPage.canvas_height}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-[var(--ink-light)]">阅读方向</dt><dd>{sodaPage.reading_direction === "rtl" ? "从右往左" : "从左往右"}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-[var(--ink-light)]">分镜格数</dt><dd><span className="font-mono">{sodaPage.panels.length}</span> 格</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-[var(--ink-light)]">台词框数</dt><dd><span className="font-mono">{sodaPage.texts.length}</span> 项</dd></div>
              </dl>
            </InspectorSection>
            <InspectorSection title="提示词兼容">
              <label className="figure-option flex cursor-pointer items-center gap-2 text-[13px]"><input type="checkbox" checked={Boolean(sodaPage.legacy_caption_en)} onChange={(event) => setLegacyCaptionMode(event.target.checked)} />保持旧版英文提示词覆盖行为</label>
              <p className="text-[12px] leading-relaxed text-[var(--ink-light)]">默认使用中文画面描述。旧项目如需保持原有出图提示词，可开启本页兼容模式：所有非空的自定义提示词自动覆盖。</p>
            </InspectorSection>
            {sodaPage.style_prompt && <InspectorSection title="画面风格提示词" open={false}><p className="max-h-52 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--ink-light)]">{sodaPage.style_prompt}</p></InspectorSection>}
          </div>
        )}
      </div>
    </aside>
  );
}
