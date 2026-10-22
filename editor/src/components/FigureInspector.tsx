import { ArrowLeft, ChevronDown, RotateCcw, Trash2 } from "lucide-react";
import { useEditorStore } from "../lib/store";
import { ensureFigureEditor, FIGURE_POSE_PRESETS, getFigureId } from "../lib/figureRig";
import { applyFigurePoseInPanel, editableFigureEditor, resolvedFigures } from "../lib/figures";
import { characterSketchColor } from "../lib/characterColors";
import type { Figure, FigureEditor, FigurePose, Selection, SodaPanel } from "../types";
import NumberInput from "./ui/NumberInput";

const POSE_OPTIONS: { value: FigurePose; label: string }[] = [
  { value: "stand", label: "站立" }, { value: "walk", label: "行走" },
  { value: "run", label: "奔跑" }, { value: "sit", label: "坐下" },
  { value: "crouch", label: "蹲下" }, { value: "wave", label: "挥手" },
  { value: "point", label: "指向" }, { value: "arms_up", label: "举手" },
  { value: "hands_clasped", label: "双手合十" }, { value: "hand_on_chin", label: "托下巴 / 推眼镜" },
  { value: "lie", label: "侧视躺卧" }, { value: "back_view", label: "背影" },
  { value: "handshake", label: "握手" }, { value: "hug", label: "拥抱" }
];

function FigureSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="inspector-section"><h3 className="text-[13px] font-semibold">{title}</h3><div className="inspector-section-content space-y-3">{children}</div></section>;
}

function FigureSelect({ value, label, options, onChange }: { value: string; label: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <label className="block min-w-0"><span className="ui-label">{label}</span><span className="relative block"><select aria-label={label} className="ui-input w-full appearance-none pr-7" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ink-light)]" aria-hidden="true" /></span></label>;
}

type FigureInspectorProps = {
  figure: Figure;
  figureId: string;
  panel: SodaPanel;
  onSelectObject: (selection: Selection) => void;
};

export default function FigureInspector({ figure, figureId, panel, onSelectObject }: FigureInspectorProps) {
  const characters = useEditorStore((state) => state.characters);
  const sketchGeometry = useEditorStore((state) => state.sketchGeometry);
  const readingDirection = useEditorStore((state) => state.sodaPage?.reading_direction);
  const projectPanel = useEditorStore((state) => state.project.pages.find((page) => page.id === state.project.activePageId)?.panels.find((item) => item.id === panel.id));
  const width = projectPanel?.width || (panel.shape.type === "rect" ? panel.shape.w : Math.max(...panel.shape.points.map(([x]) => x)) - Math.min(...panel.shape.points.map(([x]) => x)));
  const height = projectPanel?.height || (panel.shape.type === "rect" ? panel.shape.h : Math.max(...panel.shape.points.map(([, y]) => y)) - Math.min(...panel.shape.points.map(([, y]) => y)));
  const figureIndex = resolvedFigures(panel, readingDirection).findIndex((item, index) => getFigureId(item, index) === figureId);
  const sketch = sketchGeometry?.panels.find(item => item.panel_id === panel.id)?.figures[figureIndex];
  const editor = projectPanel ? editableFigureEditor(figure, projectPanel, sketch) : ensureFigureEditor(figure, { width, height, shot: panel.shot });
  const update = (patch: Partial<Figure>) => useEditorStore.getState().updateFigureById(panel.id, figureId, patch);
  const updateEditor = (patch: Partial<FigureEditor>) => update({ editor: { ...editor, ...patch } });
  const applyPose = (pose: string) => update({ pose, editor: applyFigurePoseInPanel(editor, pose, { width, height }) });
  const knownPose = Object.prototype.hasOwnProperty.call(FIGURE_POSE_PRESETS, figure.pose);
  const poseOptions = knownPose ? POSE_OPTIONS : [{ value: figure.pose, label: `自定义 · ${figure.pose}` }, ...POSE_OPTIONS];
  const characterOptions = characters.map((character) => ({ value: character.id, label: character.display_name }));
  if (!characterOptions.some((option) => option.value === figure.character_id)) characterOptions.unshift({ value: figure.character_id, label: !figure.character_id || figure.character_id === "char" ? "未指定角色" : figure.character_id });
  const maxSize = Math.max(100, Math.round(Math.max(width, height) * 2));
  const changeNumber = (field: "x" | "y" | "size", raw: string) => {
    if (raw === "") return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    updateEditor({ [field]: field === "size" ? Math.max(20, value) : value });
  };

  return <div key={`${panel.id}:${figureId}`} className="figure-inspector">
    <div className="inspection-start inspector-return"><button type="button" className="ui-btn ui-btn-sm" onClick={() => onSelectObject({ kind: "panel", id: panel.id })}><ArrowLeft size={13} aria-hidden="true" />返回格子 {panel.order}</button></div>
    <FigureSection title="人物与姿势">
      <FigureSelect label="角色" value={figure.character_id} options={characterOptions} onChange={(value) => update({ character_id: value })} />
      <p className="flex items-center gap-2 text-[13px] text-[var(--ink-light)]"><span className="h-3 w-3 shrink-0 rounded-full" style={{ background: characterSketchColor(characters.find(character => character.id === figure.character_id)) }} />人物色 {characterSketchColor(characters.find(character => character.id === figure.character_id)).toUpperCase()} · 在左侧“角色”中更改</p>
      <FigureSelect label="姿势预设" value={figure.pose} options={poseOptions} onChange={applyPose} />
      {figure.pose === "lie" && editor.view !== "side" && <div className="ui-notice-box space-y-2"><p>这个人物保留了旧躺姿，可重新应用侧视躺卧。</p><button type="button" className="ui-btn ui-btn-sm" onClick={() => applyPose("lie")}>应用侧视躺卧</button></div>}
      <p className="text-[12px] leading-relaxed text-[var(--ink-light)]">拖动人物移动站位；拖动红色关节点调整动作。</p>
      <button type="button" className="ui-btn ui-btn-sm" onClick={() => applyPose(knownPose ? figure.pose : "stand")}><RotateCcw size={13} aria-hidden="true" />重置关节为预设姿势</button>
    </FigureSection>
    <FigureSection title="位置与大小">
      <label className="block"><span className="ui-label">人物高度（像素）</span><div className="flex items-center gap-2"><input className="min-w-0 flex-1" aria-label="人物高度滑块" type="range" min={20} max={maxSize} step={1} value={editor.size} onChange={(event) => changeNumber("size", event.target.value)} /><NumberInput key={`${figureId}-size`} className="ui-input w-20 numeric" aria-label="人物高度" min={20} step={1} value={Math.round(editor.size * 10) / 10} onCommit={value => updateEditor({ size: value })} /></div></label>
      <div className="grid grid-cols-2 gap-3"><label className="min-w-0"><span className="ui-label">水平位置 X</span><NumberInput aria-label="水平位置 X" key={`${figureId}-x`} step={1} value={Math.round(editor.x * 10) / 10} onCommit={value => updateEditor({ x: value })} /></label><label className="min-w-0"><span className="ui-label">垂直位置 Y</span><NumberInput aria-label="垂直位置 Y" key={`${figureId}-y`} step={1} value={Math.round(editor.y * 10) / 10} onCommit={value => updateEditor({ y: value })} /></label></div>
      <p className="text-[12px] leading-relaxed text-[var(--ink-light)]">坐标以本格左上角为起点，定位到人物脚底。</p>
      <label className="figure-option flex cursor-pointer items-center gap-2 text-[13px]"><input type="checkbox" checked={editor.flip} onChange={(event) => updateEditor({ flip: event.target.checked })} />水平翻转</label>
      <label className="figure-option flex cursor-pointer items-center gap-2 text-[13px]"><input type="checkbox" checked={editor.break_frame} onChange={(event) => updateEditor({ break_frame: event.target.checked })} />允许人物出框</label>
    </FigureSection>
    <FigureSection title="草稿外观">
      <FigureSelect label="身体视角" value={editor.view || "front"} options={[{ value: "front", label: "正面" }, { value: "side", label: "侧面" }]} onChange={(value) => updateEditor({ view: value as FigureEditor["view"] })} />
      <FigureSelect label="人物样式" value={editor.style} options={[{ value: "stick", label: "火柴人" }, { value: "box", label: "方块人体" }, { value: "rough", label: "人体粗稿" }]} onChange={(value) => updateEditor({ style: value as FigureEditor["style"] })} />
      <div className="grid grid-cols-2 gap-3"><FigureSelect label="朝向" value={figure.facing} options={[{ value: "front", label: "正面" }, { value: "left", label: "向左" }, { value: "right", label: "向右" }, { value: "back", label: "背面" }]} onChange={(value) => update({ facing: value as Figure["facing"], editor: { ...editor, flip: value === "left" ? true : value === "right" ? false : editor.flip } })} /><FigureSelect label="生成景框" value={figure.framing || ""} options={[{ value: "", label: "默认" }, { value: "full", label: "全身" }, { value: "waist", label: "半身" }, { value: "bust", label: "胸部" }, { value: "face", label: "面部" }]} onChange={(value) => update({ framing: value ? value as Figure["framing"] : null })} /></div>
    </FigureSection>
    <div className="inspector-section"><button type="button" className="ui-btn ui-btn-sm text-[var(--error)]" onClick={() => useEditorStore.getState().removeFigureById(panel.id, figureId)}><Trash2 size={13} aria-hidden="true" />删除这个人物</button></div>
  </div>;
}
