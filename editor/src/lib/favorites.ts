import type { BubbleStyle, FigureEditor } from "../types";

export const FAVORITES_KEY = "soda.editor.favorites.v1";
export type PoseFavorite = { pose: string; facing?: string; framing?: string | null; editor?: Partial<Pick<FigureEditor, "style" | "view" | "flip" | "break_frame" | "joints">> };
export type BubbleFavorite = { bubble: BubbleStyle; direction: "horizontal" | "vertical" | null; font_size?: number | null; hasTail: boolean };
export type Favorite = { id: string; name: string; createdAt: string } & ({ kind: "pose"; data: PoseFavorite } | { kind: "bubble"; data: BubbleFavorite });
type StorageLike = Pick<Storage, "getItem" | "setItem">;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

export function validateFavorite(value: unknown): value is Favorite {
  if (!object(value) || typeof value.id !== "string" || !value.id || typeof value.name !== "string" || !value.name.trim() || value.name.length > 80 || typeof value.createdAt !== "string" || !object(value.data)) return false;
  const data = value.data;
  if (value.kind === "bubble") return Object.keys(data).every(key => ["bubble", "direction", "font_size", "hasTail"].includes(key)) && ["speech", "shout", "thought", "box", "none"].includes(String(data.bubble)) && ["vertical", "horizontal", null].includes(data.direction as string | null) && typeof data.hasTail === "boolean" && (data.font_size == null || typeof data.font_size === "number" && Number.isFinite(data.font_size) && data.font_size >= 8 && data.font_size <= 128);
  if (value.kind !== "pose" || typeof data.pose !== "string" || !data.pose) return false;
  if (!Object.keys(data).every(key => ["pose", "facing", "framing", "editor"].includes(key))) return false;
  if (data.facing !== undefined && !["front", "back", "left", "right"].includes(String(data.facing))) return false;
  if (data.framing != null && !["full", "waist", "bust", "face"].includes(String(data.framing))) return false;
  if (data.editor !== undefined) {
    if (!object(data.editor)) return false;
    const editor = data.editor;
    if (!Object.keys(editor).every(key => ["style", "view", "flip", "break_frame", "joints"].includes(key))) return false;
    if (editor.style !== undefined && !["stick", "box", "rough"].includes(String(editor.style))) return false;
    if (editor.view !== undefined && !["front", "side"].includes(String(editor.view))) return false;
    if (editor.flip !== undefined && typeof editor.flip !== "boolean" || editor.break_frame !== undefined && typeof editor.break_frame !== "boolean") return false;
    if (editor.joints !== undefined && (!object(editor.joints) || !Object.values(editor.joints).every(point => Array.isArray(point) && point.length === 2 && point.every(value => typeof value === "number" && Number.isFinite(value))))) return false;
  }
  return true;
}

export function readFavorites(storage: StorageLike = localStorage): Favorite[] {
  const raw = storage.getItem(FAVORITES_KEY);
  if (!raw) return [];
  try { const value: unknown = JSON.parse(raw); return Array.isArray(value) ? value.filter(validateFavorite).slice(0, 50) : []; } catch { return []; }
}
export function saveFavorite(favorite: Favorite, storage: StorageLike = localStorage): Favorite[] {
  if (!validateFavorite(favorite)) throw new Error("收藏内容无效，请检查名称和样式。");
  const next = [favorite, ...readFavorites(storage).filter(item => item.id !== favorite.id)].slice(0, 50);
  storage.setItem(FAVORITES_KEY, JSON.stringify(next)); return next;
}
export function removeFavorite(id: string, storage: StorageLike = localStorage): Favorite[] {
  const next = readFavorites(storage).filter(item => item.id !== id); storage.setItem(FAVORITES_KEY, JSON.stringify(next)); return next;
}
