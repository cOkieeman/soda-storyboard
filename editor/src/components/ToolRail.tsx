import { Hand, MessageSquare, MousePointer2, PanelTop, UserRound } from "lucide-react";
import type { CanvasTool } from "./CanvasEditor";

export const EDITOR_TOOLS = [
  { id: "select", label: "选择", shortcut: "V", icon: MousePointer2, hint: "选择与移动对象" },
  { id: "panel", label: "格子", shortcut: "P", icon: PanelTop, hint: "选择格子" },
  { id: "text", label: "台词", shortcut: "T", icon: MessageSquare, hint: "点击格子添加台词" },
  { id: "figure", label: "人物", shortcut: "C", icon: UserRound, hint: "点击格子添加人物" },
  { id: "pan", label: "平移", shortcut: "H", icon: Hand, hint: "拖动画布，空格键临时平移" }
] as const;

export default function ToolRail({ tool, onChange }: { tool: CanvasTool; onChange: (tool: CanvasTool) => void }) {
  return <nav className="tool-rail" aria-label="画布工具">{EDITOR_TOOLS.map(({ id, label, shortcut, icon: Icon, hint }) => <button key={id} className={tool === id ? "tool-button is-active" : "tool-button"} title={hint + " · " + shortcut} aria-label={label} aria-pressed={tool === id} onClick={() => onChange(id)}><Icon /><span className="tool-label">{label}</span></button>)}<span className="rail-rule" /><span className="rail-caption">工具</span></nav>;
}
