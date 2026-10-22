import { Columns2, MessageCircle, Pencil, Rows2, Trash2, UserPlus } from "lucide-react";
import { Bubble, Panel } from "../../types";
import { useEditorStore } from "../../lib/store";

export function CanvasSelectionToolbar({ panel, canvasWidth, zoom }: { panel: Panel; canvasWidth: number; zoom: number }) {
  const characters = useEditorStore((state) => state.characters);
  const addFigureToPanel = useEditorStore((state) => state.addFigureToPanel);
  const addTextToPanel = useEditorStore((state) => state.addTextToPanel);
  const splitPanelHorizontal = useEditorStore((state) => state.splitPanelHorizontal);
  const splitPanelVertical = useEditorStore((state) => state.splitPanelVertical);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const setNotice = useEditorStore((state) => state.setNotice);

  return (
    <div className="canvas-selection-toolbar absolute z-30 flex items-center gap-1 border border-[var(--line)] bg-[var(--paper-surface)] p-1 text-[var(--ink)] shadow-lg" style={{ left: Math.max(8, Math.min(canvasWidth * zoom - 196, panel.x * zoom)), top: Math.max(8, panel.y * zoom - 42) }} aria-label="分镜格快捷操作">
      <button type="button" className="canvas-control-button flex h-7 w-7 items-center justify-center" onClick={() => {
        const characterId = characters[0]?.id;
        if (!characterId) { setNotice("请先在角色面板添加角色"); return; }
        addFigureToPanel(panel.id, { character_id: characterId, position: "center", facing: "front", pose: "stand" });
      }} title="在当前格添加人物" aria-label="在当前格添加人物"><UserPlus size={15} /></button>
      <button type="button" className="canvas-control-button flex h-7 w-7 items-center justify-center" onClick={() => addTextToPanel(panel.id)} title="在当前格添加台词" aria-label="在当前格添加台词"><MessageCircle size={15} /></button>
      <span className="mx-1 h-4 border-l border-[var(--line)]" />
      <button type="button" className="canvas-control-button flex h-7 w-7 items-center justify-center" onClick={() => splitPanelHorizontal(panel.id)} title="水平切分为上下两格" aria-label="水平切分"><Rows2 size={15} /></button>
      <button type="button" className="canvas-control-button flex h-7 w-7 items-center justify-center" onClick={() => splitPanelVertical(panel.id)} title="垂直切分为左右两格" aria-label="垂直切分"><Columns2 size={15} /></button>
      <button type="button" className="canvas-control-button flex h-7 w-7 items-center justify-center text-[var(--error)]" onClick={deleteSelection} title="删除此分镜格" aria-label="删除此分镜格"><Trash2 size={15} /></button>
    </div>
  );
}

export function CanvasTextSelectionToolbar({ bubble, canvasWidth, zoom, onEdit }: { bubble: Bubble; canvasWidth: number; zoom: number; onEdit: () => void }) {
  return <div className="canvas-selection-toolbar absolute z-30 border border-[var(--line)] bg-[var(--paper-surface)] p-1 text-[var(--ink)] shadow-lg" style={{ left: Math.max(8, Math.min(canvasWidth * zoom - 112, bubble.x * zoom)), top: Math.max(8, bubble.y * zoom - 44) }} aria-label="台词快捷操作">
    <button type="button" className="canvas-control-button flex min-h-8 items-center gap-2 px-2 text-sm" onClick={onEdit} title="在画布上修改文字，也可双击气泡"><Pencil size={15} />编辑台词</button>
  </div>;
}
