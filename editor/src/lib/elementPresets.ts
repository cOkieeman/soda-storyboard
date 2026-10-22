import type { SodaText } from "../types";

export type TextPresetId = "narration_vertical" | "speech_vertical" | "speech_horizontal" | "thought" | "shout" | "transparent" | "title";

type TextPreset = {
  label: string;
  text: string;
  width: number;
  height: number;
  kind: SodaText["kind"];
  direction: "vertical" | "horizontal";
  bubble: SodaText["bubble"];
  fontSize: number;
};

export const TEXT_PRESETS: Record<TextPresetId, TextPreset> = {
  narration_vertical: { label: "竖排旁白框", text: "故事从这里开始。", width: 86, height: 220, kind: "narration", direction: "vertical", bubble: "box", fontSize: 20 },
  speech_vertical: { label: "竖排气泡", text: "在这里写台词", width: 110, height: 200, kind: "dialogue", direction: "vertical", bubble: "speech", fontSize: 20 },
  speech_horizontal: { label: "横排气泡", text: "在这里写台词", width: 230, height: 110, kind: "dialogue", direction: "horizontal", bubble: "speech", fontSize: 20 },
  thought: { label: "思考气泡", text: "我在想……", width: 180, height: 150, kind: "dialogue", direction: "horizontal", bubble: "thought", fontSize: 20 },
  shout: { label: "爆炸气泡", text: "什么？！", width: 200, height: 150, kind: "dialogue", direction: "horizontal", bubble: "shout", fontSize: 24 },
  transparent: { label: "透明文字", text: "在这里写文字", width: 230, height: 80, kind: "narration", direction: "horizontal", bubble: "none", fontSize: 20 },
  title: { label: "标题框", text: "故事标题", width: 300, height: 90, kind: "title", direction: "horizontal", bubble: "box", fontSize: 32 }
};
