import type { CharacterSummary, SodaCharacter } from "../types";

export const DEFAULT_CHARACTER_COLOR = "#3288a2";
export const CHARACTER_COLOR_PRESETS = [
  { name: "湖蓝", value: "#3288A2" }, { name: "朱红", value: "#B44A3A" },
  { name: "墨绿", value: "#498167" }, { name: "藤紫", value: "#8663A5" },
  { name: "赭黄", value: "#A97924" }, { name: "玫红", value: "#AD5781" }
] as const;

export function normalizeCharacterColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/^#[\da-f]{3}$/i.test(value)) return "#" + [...value.slice(1)].map(digit => digit + digit).join("").toUpperCase();
  return /^#[\da-f]{6}$/i.test(value) ? value.toUpperCase() : null;
}

export function characterSketchColor(character?: Pick<CharacterSummary | SodaCharacter, "sketch_color">, fallback = DEFAULT_CHARACTER_COLOR): string {
  return normalizeCharacterColor(character?.sketch_color) || fallback;
}
