import { ReactNode, useEffect, useRef } from "react";
import { AlignVerticalJustifyCenter, ArrowRightLeft, Command, Eye, LayoutTemplate, MessageCircle, Pencil, Route, Scissors, Square, Trash2, UserPlus, Zap } from "lucide-react";
import { Bubble } from "../../types";
import { getActivePage, useEditorStore } from "../../lib/store";

export type CanvasContextMenuData = {
  x: number;
  y: number;
  target: { kind: "panel"; id: string } | { kind: "bubble"; id: string } | { kind: "canvas" };
};

export function toggleBubbleTail(bubble: Pick<Bubble, "id" | "width" | "height" | "tailTip">) {
  const tailTip: [number, number] | null = bubble.tailTip ? null : [Math.round(bubble.width / 2), Math.round(bubble.height + 28)];
  const state = useEditorStore.getState();
  state.updateBubble(bubble.id, { tailTip });
  state.updateSodaText(bubble.id, { tail_tip: tailTip });
}

function MenuAction({ icon, children, hint, onClick, danger = false }: {
  icon: ReactNode;
  children: ReactNode;
  hint?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return <button type="button" onClick={onClick} className={`canvas-menu-action flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-[13px] ${danger ? "text-[var(--error)]" : ""}`}><span className="shrink-0">{icon}</span><span className="flex-1 whitespace-nowrap">{children}</span>{hint && <span className="ml-3 text-xs text-[var(--ink-light)]">{hint}</span>}</button>;
}

export function CanvasContextMenu({ menu, onClose, onEditBubble, showLiveArea, showReadingFlow, onToggleLiveArea, onToggleReadingFlow }: {
  menu: CanvasContextMenuData;
  onClose: () => void;
  onEditBubble: (bubble: Bubble) => void;
  showLiveArea: boolean;
  showReadingFlow: boolean;
  onToggleLiveArea: () => void;
  onToggleReadingFlow: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const activePage = useEditorStore((state) => getActivePage(state.project));
  const characters = useEditorStore((state) => state.characters);
  const setNotice = useEditorStore((state) => state.setNotice);
  const addFigureToPanel = useEditorStore((state) => state.addFigureToPanel);
  const addTextToPanel = useEditorStore((state) => state.addTextToPanel);
  const splitPanelHorizontal = useEditorStore((state) => state.splitPanelHorizontal);
  const splitPanelVertical = useEditorStore((state) => state.splitPanelVertical);
  const selectItem = useEditorStore((state) => state.selectItem);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const updateSodaText = useEditorStore((state) => state.updateSodaText);
  const updateBubble = useEditorStore((state) => state.updateBubble);
  const openLayoutModal = useEditorStore((state) => state.openLayoutModal);
  const openPreviewModal = useEditorStore((state) => state.openPreviewModal);
  const openCommandPalette = useEditorStore((state) => state.openCommandPalette);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const run = (action: () => void) => () => { action(); onClose(); };
  const separator = <div className="my-1 border-t border-[var(--line)]" />;
  const target = menu.target;
  const panel = target.kind === "panel" ? activePage.panels.find((item) => item.id === target.id) : null;
  const bubble = target.kind === "bubble" ? activePage.bubbles.find((item) => item.id === target.id) : null;

  const deleteTarget = () => {
    if (target.kind === "canvas") return;
    selectItem({ kind: target.kind === "panel" ? "panel" : "text", id: target.id });
    deleteSelection();
  };
  const changeBubbleType = (type: "speech" | "shout" | "thought" | "box") => {
    if (!bubble) return;
    updateSodaText(bubble.id, { bubble: type });
    updateBubble(bubble.id, { sodaData: { ...(bubble.sodaData as any), bubble: type } });
  };
  const toggleDirection = () => {
    if (!bubble) return;
    const direction = bubble.direction === "vertical" ? "horizontal" : "vertical";
    let width = bubble.width;
    let height = bubble.height;
    if (direction === "horizontal" && bubble.height > bubble.width * 1.2) {
      width = Math.max(130, Math.min(260, Math.round(bubble.height * 0.7)));
      height = Math.max(65, Math.min(130, Math.round(bubble.width * 0.9)));
    } else if (direction === "vertical" && bubble.width > bubble.height * 1.2) {
      width = Math.max(65, Math.min(130, Math.round(bubble.height * 0.9)));
      height = Math.max(140, Math.min(320, Math.round(bubble.width * 0.7)));
    }
    updateSodaText(bubble.id, { direction, bbox: { type: "rect", x: bubble.x, y: bubble.y, w: width, h: height } });
    updateBubble(bubble.id, { direction, width, height });
  };

  return (
    <div ref={rootRef} className="canvas-context-menu fixed z-50 max-h-[calc(100vh-24px)] min-w-[220px] overflow-y-auto border border-[var(--line)] bg-[var(--paper-surface)] p-1.5 text-[var(--ink)] shadow-lg" style={{ left: Math.min(window.innerWidth - 260, Math.max(12, menu.x)), top: Math.min(window.innerHeight - 420, Math.max(12, menu.y)) }} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} role="menu" aria-label="画布快捷操作">
      <div className="mb-1 border-b border-[var(--line)] px-2.5 py-2 text-xs font-semibold text-[var(--ink-light)]">{target.kind === "panel" ? `分镜格 #${panel?.order || ""}` : target.kind === "bubble" ? "台词气泡" : "画布快捷操作"}</div>
      {target.kind === "panel" && <>
        <MenuAction icon={<UserPlus size={15} />} onClick={run(() => {
          const characterId = characters[0]?.id;
          if (!characterId) { setNotice("请先在角色面板添加角色"); return; }
          addFigureToPanel(target.id, { character_id: characterId, position: "center", facing: "front", pose: "stand" });
        })}>添加人物</MenuAction>
        <MenuAction icon={<MessageCircle size={15} />} onClick={run(() => addTextToPanel(target.id))}>添加台词</MenuAction>
        {separator}
        <MenuAction icon={<Scissors size={15} />} onClick={run(() => splitPanelHorizontal(target.id))}>水平切分</MenuAction>
        <MenuAction icon={<Scissors size={15} />} onClick={run(() => splitPanelVertical(target.id))}>垂直切分</MenuAction>
        {separator}
        <MenuAction icon={<Trash2 size={15} />} onClick={run(deleteTarget)} hint="Del" danger>删除此分镜格</MenuAction>
      </>}
      {target.kind === "bubble" && <>
        <MenuAction icon={<Pencil size={15} />} onClick={run(() => { if (bubble) onEditBubble(bubble); })} hint="双击">编辑台词文本</MenuAction>
        <MenuAction icon={<ArrowRightLeft size={15} />} onClick={run(toggleDirection)} hint={bubble?.direction === "vertical" ? "竖排" : "横排"}>切换文字方向</MenuAction>
        {bubble && <MenuAction icon={<MessageCircle size={15} />} onClick={run(() => {
          toggleBubbleTail(bubble);
        })}>{bubble.tailTip ? "移除引线" : "添加引线"}</MenuAction>}
        {separator}
        <MenuAction icon={<MessageCircle size={15} />} onClick={run(() => changeBubbleType("speech"))}>对话气泡</MenuAction>
        <MenuAction icon={<Zap size={15} />} onClick={run(() => changeBubbleType("shout"))}>呐喊气泡</MenuAction>
        <MenuAction icon={<MessageCircle size={15} />} onClick={run(() => changeBubbleType("thought"))}>思考气泡</MenuAction>
        <MenuAction icon={<Square size={15} />} onClick={run(() => changeBubbleType("box"))}>方框旁白</MenuAction>
        {separator}
        <MenuAction icon={<Trash2 size={15} />} onClick={run(deleteTarget)} hint="Del" danger>删除台词框</MenuAction>
      </>}
      {target.kind === "canvas" && <>
        <MenuAction icon={<LayoutTemplate size={15} />} onClick={run(openLayoutModal)}>分镜版式候选</MenuAction>
        <MenuAction icon={<Eye size={15} />} onClick={run(openPreviewModal)}>草稿大图预览</MenuAction>
        {separator}
        <MenuAction icon={<AlignVerticalJustifyCenter size={15} />} onClick={run(onToggleLiveArea)} hint={showLiveArea ? "关闭" : "开启"}>版心安全线</MenuAction>
        <MenuAction icon={<Route size={15} />} onClick={run(onToggleReadingFlow)} hint={showReadingFlow ? "关闭" : "开启"}>阅读视线流</MenuAction>
        {separator}
        <MenuAction icon={<Command size={15} />} onClick={run(openCommandPalette)} hint="Ctrl+K">命令面板</MenuAction>
      </>}
    </div>
  );
}
