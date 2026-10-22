import { useState } from "react";
import { Star, Trash2 } from "lucide-react";
import { readFavorites, removeFavorite, saveFavorite, type Favorite } from "../../lib/favorites";
import { getFigureId } from "../../lib/figureRig";
import { resolvedFigures } from "../../lib/figures";
import { useEditorStore } from "../../lib/store";
import type { Figure } from "../../types";
import ModalShell from "./ModalShell";

export default function FavoritesDialog({ onClose }: { onClose: () => void }) {
  const selection = useEditorStore(state => state.selection);
  const page = useEditorStore(state => state.sodaPage);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<Favorite[]>(() => { try { return readFavorites(); } catch { return []; } });
  const panel = selection?.kind === "figure" ? page?.panels.find(item => item.id === selection.panelId) : undefined;
  const figure = panel && selection?.kind === "figure" ? resolvedFigures(panel, page?.reading_direction).find((item, index) => getFigureId(item, index) === selection.id) : undefined;
  const text = selection?.kind === "text" || selection?.kind === "bubble" ? page?.texts.find(item => item.id === selection.id) : undefined;
  const save = () => {
    if (!name.trim()) { setError("请先给收藏起一个名字。"); return; }
    const base = { id: `favorite-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: name.trim(), createdAt: new Date().toISOString() };
    const favorite: Favorite | null = figure ? { ...base, kind: "pose", data: { pose: figure.pose, facing: figure.facing, framing: figure.framing, ...(figure.editor ? { editor: { style: figure.editor.style, view: figure.editor.view, flip: figure.editor.flip, break_frame: figure.editor.break_frame, joints: figure.editor.joints } } : {}) } } : text ? { ...base, kind: "bubble", data: { bubble: text.bubble, direction: text.direction, font_size: text.font_size, hasTail: Boolean(text.tail_tip) } } : null;
    if (!favorite) return;
    try { setItems(saveFavorite(favorite)); setName(""); setError(""); setMessage("已保存。收藏仅存于这台设备，可在其他分镜页复用。"); } catch { setError("无法保存到浏览器存储，请检查浏览器的存储权限或空间。"); }
  };
  const apply = (favorite: Favorite) => {
    const state = useEditorStore.getState();
    if (favorite.kind === "pose" && figure) state.applySelectionStyle({ figure: favorite.data as Partial<Figure> });
    else if (favorite.kind === "bubble" && text) state.updateTextsBatch((state.sodaPage?.texts || []).filter(item => state.selections.some(selection => ["text", "bubble"].includes(selection.kind) && selection.id === item.id)).map(item => ({ id: item.id, patch: { bubble: favorite.data.bubble, direction: favorite.data.direction, font_size: favorite.data.font_size, tail_tip: favorite.data.hasTail ? [Math.round((item.bbox?.w || 100) / 2), (item.bbox?.h || 200) + 28] as [number, number] : null } })));
    else return;
    setMessage(`已应用“${favorite.name}”，可撤销。`);
  };
  return <ModalShell title="收藏样式" description="保存人物姿势或气泡样式，在其他对象上复用。位置和人物身份会保留。" onClose={onClose} footer={<button className="ui-btn" onClick={onClose}>关闭</button>}>
    <div className="space-y-4 p-5">{figure || text ? <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1"><span className="ui-label">收藏名称</span><input className="ui-input" value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder={figure ? "例如：托腮思考" : "例如：横排旁白框"} /></label><button className="ui-btn" onClick={save}><Star size={14} />保存当前{figure ? "姿势" : "气泡"}</button></div> : <p className="text-sm text-[var(--muted)]">选中人物或台词后，可以保存当前样式或应用收藏。</p>}{error && <p role="alert" className="text-[var(--error)]">{error}</p>}{message && <p role="status" className="text-sm text-[var(--success)]">{message}</p>}{items.length ? <ul className="divide-y divide-[var(--line)]">{items.map(item => <li key={item.id} className="flex items-center gap-3 py-3"><div className="min-w-0 flex-1"><strong className="block break-words text-sm">{item.name}</strong><span className="text-xs text-[var(--muted)]">{item.kind === "pose" ? "人物姿势" : "气泡样式"}</span></div><button className="ui-btn ui-btn-sm" disabled={item.kind === "pose" ? !figure : !text} onClick={() => apply(item)}>应用</button><button className="icon-button" aria-label={`删除收藏 ${item.name}`} onClick={() => { try { setItems(removeFavorite(item.id)); } catch { setError("无法删除收藏，请检查存储权限。"); } }}><Trash2 size={14} /></button></li>)}</ul> : <p className="py-6 text-sm text-[var(--muted)]">还没有收藏。选中满意的人物姿势或气泡，给它命名后保存。</p>}</div>
  </ModalShell>;
}
