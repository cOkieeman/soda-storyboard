import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEditorStore } from "../lib/store";
import type { TextPresetId } from "../lib/elementPresets";
import type { FigurePose } from "../types";
import { readUiPreference, saveUiPreference } from "../lib/localUiPreferences";

const TEXT_PRESETS: { id: TextPresetId; label: string; description: string }[] = [
  { id: "narration_vertical", label: "竖排旁白框", description: "添加竖排方框旁白" },
  { id: "speech_vertical", label: "竖排气泡", description: "添加竖排对话气泡" },
  { id: "speech_horizontal", label: "横排气泡", description: "添加横排对话气泡" },
  { id: "thought", label: "思考气泡", description: "添加思考气泡" },
  { id: "shout", label: "爆炸气泡", description: "添加喊叫或强调的爆炸气泡" },
  { id: "transparent", label: "透明文字", description: "添加没有边框和底色的文字" },
  { id: "title", label: "标题框", description: "添加横排标题框" }
];

const POSE_OPTIONS: { value: FigurePose; label: string }[] = [
  { value: "stand", label: "站立" },
  { value: "sit", label: "坐下" },
  { value: "walk", label: "行走" },
  { value: "run", label: "奔跑" },
  { value: "wave", label: "挥手" },
  { value: "point", label: "指向" },
  { value: "arms_up", label: "举手" },
  { value: "crouch", label: "蹲下" },
  { value: "hands_clasped", label: "双手合十" },
  { value: "hand_on_chin", label: "托下巴" },
  { value: "lie", label: "侧视躺卧" },
  { value: "back_view", label: "背影" }
];

type ElementPaletteProps = { onAdded?: () => void };

export default function ElementPalette({ onAdded }: ElementPaletteProps) {
  const sodaPage = useEditorStore((state) => state.sodaPage);
  const selection = useEditorStore((state) => state.selection);
  const [pose, setPose] = useState<FigurePose>("stand");
  const [expanded, setExpanded] = useState(() => readUiPreference<boolean>("soda.workspace.v1.element-palette-expanded", false) === true);
  useEffect(() => { saveUiPreference("soda.workspace.v1.element-palette-expanded", expanded); }, [expanded]);
  useEffect(() => {
    const reset = () => setExpanded(false);
    window.addEventListener("soda:reset-workspace", reset);
    return () => window.removeEventListener("soda:reset-workspace", reset);
  }, []);
  const selectedPanelId = selection?.kind === "panel" ? selection.id
    : selection?.kind === "figure" ? selection.panelId
      : selection?.kind === "text" || selection?.kind === "bubble"
        ? sodaPage?.texts.find((text) => text.id === selection.id)?.panel_id
        : null;
  const panel = sodaPage?.panels.find((item) => item.id === selectedPanelId)
    || [...(sodaPage?.panels || [])].sort((a, b) => a.order - b.order)[0];
  const disabled = !panel;

  const addText = (preset: TextPresetId) => {
    if (!panel) return;
    useEditorStore.getState().addTextPreset(preset, panel.id);
    setExpanded(false);
    onAdded?.();
  };
  const addFigure = (pair?: "handshake" | "hug") => {
    if (!panel) return;
    useEditorStore.getState().addFigurePreset(pose, pair, panel.id);
    setExpanded(false);
    onAdded?.();
  };

  return <section className={`element-palette${expanded ? " is-expanded" : " is-compact"}`} aria-label="添加分镜元素" data-expanded={expanded}>
    <div className="palette-compact-toolbar flex min-w-0 flex-wrap items-center gap-2">
      <div className="palette-heading !m-0"><strong>添加元素</strong><span>{panel ? `第 ${panel.order} 格` : "先建立格子"}</span></div>
      {!expanded && <><button type="button" className="palette-button" disabled={disabled} onClick={() => addText("speech_vertical")}>+ 竖排气泡</button><button type="button" className="palette-button" disabled={disabled} onClick={() => addFigure()}>+ 火柴人</button></>}
      <button type="button" className="palette-button" aria-expanded={expanded} aria-controls="element-palette-all" onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{expanded ? "收起元素" : "更多元素"}</button>
    </div>
    {expanded && <div id="element-palette-all" className="mt-2 space-y-2"><div className="palette-group" role="group" aria-label="添加文字">
      <span className="palette-group-label">文字</span>
      {TEXT_PRESETS.map((preset) => <button key={preset.id} type="button" className="palette-button" disabled={disabled} onClick={() => addText(preset.id)} title={preset.description}>+ {preset.label}</button>)}
    </div>
    <div className="palette-group" role="group" aria-label="添加人物">
      <span className="palette-group-label">人物</span>
      <label className="palette-pose"><span className="sr-only">新人物姿势</span><select className="ui-input" aria-label="新人物姿势" value={pose} disabled={disabled} onChange={(event) => setPose(event.target.value as FigurePose)}>{POSE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <button type="button" className="palette-button" disabled={disabled} onClick={() => addFigure()}>+ 火柴人</button>
      <button type="button" className="palette-button" disabled={disabled} onClick={() => addFigure("handshake")}>+ 握手双人</button>
      <button type="button" className="palette-button" disabled={disabled} onClick={() => addFigure("hug")}>+ 拥抱双人</button>
    </div></div>}
  </section>;
}
