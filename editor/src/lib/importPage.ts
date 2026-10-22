import type { Figure, PanelShapeSpec, RectShape, SodaOverlay, SodaPage, SodaPanel, SodaText } from "../types";
import { parseJsonWithStringSeeds } from "./api";
import { verticalColumns } from "./lettering";

export type ImportPageOptions = { canvasWidth: number; canvasHeight: number };
export type ImportedPageDraft = { page: SodaPage; format: "soda" | "moss"; warnings: string[]; needsCanvasSize: boolean };
type JsonObject = Record<string, any>;
type Size = { width: number; height: number };
const own = (value: JsonObject, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (message: string): never => { throw new Error(message); };
const clone = <T>(value: T): T => structuredClone(value);

function object(value: unknown, label: string): JsonObject {
  return isObject(value) ? value : fail(`${label}必须是 JSON 对象。`);
}
function array(value: unknown, label: string, fallback?: any[]): any[] {
  if (value === undefined && fallback) return fallback;
  return Array.isArray(value) ? value : fail(`${label}必须是数组。`);
}
function text(value: unknown, label: string, fallback = ""): string {
  return value === undefined || value === null ? fallback : typeof value === "string" ? value : fail(`${label}必须是文字。`);
}
function number(value: unknown, label: string): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fail(`${label}必须是有限数字。`);
}
function dimension(value: unknown, label: string): number {
  const result = number(value, label);
  return Number.isInteger(result) && result > 0 && result <= 8192 ? result : fail(`${label}必须是 1～8192 的整数，请检查画布尺寸。`);
}
function identifier(value: unknown, label: string): string {
  const result = text(value, label);
  return result.trim() ? result : fail(`${label}不能为空。`);
}
function uniqueId(value: unknown, label: string, used: Set<string>): string {
  const id = identifier(value, label);
  if (used.has(id)) fail(`${label}“${id}”重复，请为每个对象使用不同的 id。`);
  used.add(id);
  return id;
}
function importedId(value: unknown, label: string, used: Set<string>, reserved: Set<string>, warnings: string[]): string {
  const original = identifier(value, label);
  let id = original, suffix = 2;
  if (used.has(id)) {
    do { id = `${original}-import-${suffix++}`; } while (used.has(id) || reserved.has(id));
    warnings.push(`${label}“${original}”重复，已自动改名为“${id}”。`);
  }
  used.add(id);
  return id;
}

export function normalizeImportedPageIds<T extends JsonObject>(source: T): { page: T; warnings: string[] } {
  const page = clone(source), warnings: string[] = [];
  const renamed = new Map<string, string[]>();
  const normalize = (values: JsonObject[], label: string, kind: string) => {
    const sourceId = (item: JsonObject) => kind === "panel" ? item.id ?? item.panel_id : item.id;
    const reserved = new Set(values.map(sourceId).filter((id): id is string => typeof id === "string"));
    const used = new Set<string>();
    for (const item of values) {
      const original = sourceId(item);
      if (typeof original !== "string" || !original.trim()) continue;
      item.id = importedId(original, `${label} id`, used, reserved, warnings);
      const key = `${kind}:${original}`;
      renamed.set(key, [...(renamed.get(key) || []), item.id]);
      if (kind === "panel" && item.id !== original) warnings.push(`原 panel_id“${original}”引用继续指向首个同名格子，请核对文字和图层归属。`);
    }
  };
  const objects = (value: unknown): JsonObject[] => Array.isArray(value) ? value.filter(isObject) : [];
  const panels = objects(page.panels);
  normalize(panels, "格子", "panel");
  normalize(objects(page.texts), "文字", "text");
  normalize(panels.flatMap(panel => objects(panel.figures)), "人物", "figure");
  normalize(objects(page.overlays), "跨格人物", "overlay");
  normalize(objects(page.objects), "图层", "object");
  // Imported MOSS source entries follow the entity order, so keep their identity
  // links in sync while leaving their original item data available for round trips.
  const occurrences = new Map<string, number>();
  for (const entry of objects(page.moss_import?.entries)) {
    const key = `${entry.kind}:${entry.id}`, index = occurrences.get(key) || 0;
    occurrences.set(key, index + 1);
    if (renamed.get(key)?.[index]) entry.id = renamed.get(key)![index];
  }
  return { page, warnings };
}
function strings(value: unknown, label: string): string[] {
  return array(value, label, []).map((item, index) => identifier(item, `${label}[${index + 1}]`));
}
function inside(x: number, y: number, width: number, height: number, size: Size, label: string) {
  const tolerance = 0.000001;
  if (!(width > 0 && height > 0)) fail(`${label}的宽高必须大于 0。`);
  if (x < -tolerance || y < -tolerance || x + width > size.width + tolerance || y + height > size.height + tolerance) {
    fail(`${label}超出 ${size.width} × ${size.height} 画布。请核对画布尺寸、坐标系和 bbox 格式。`);
  }
}
function rect(value: unknown, label: string, size: Size): RectShape {
  const raw = object(value, label);
  if (raw.type !== undefined && raw.type !== "rect") fail(`${label}必须是 rect 矩形。`);
  const result = { ...raw, type: "rect" as const, x: number(raw.x, `${label}.x`), y: number(raw.y, `${label}.y`), w: number(raw.w ?? raw.width, `${label}.w`), h: number(raw.h ?? raw.height, `${label}.h`) };
  inside(result.x, result.y, result.w, result.h, size, label);
  return result;
}
function shape(value: unknown, label: string, size: Size): PanelShapeSpec {
  const raw = object(value, label);
  if (raw.type === "rect" || (raw.type === undefined && own(raw, "x") && own(raw, "y"))) return rect(raw, label, size);
  if (raw.type !== "quad") return fail(`${label}.type 仅支持 rect 或 quad。`);
  const points = array(raw.points ?? raw.corners, `${label}.points`);
  if (points.length !== 4) fail(`${label}必须有 4 个 [x, y] 顶点。`);
  const normalized = points.map((point, index): [number, number] => {
    if (!Array.isArray(point) || point.length !== 2) fail(`${label}的第 ${index + 1} 个顶点必须有两个数字。`);
    return [number(point[0], `${label}.points[${index}].x`), number(point[1], `${label}.points[${index}].y`)];
  });
  const xs = normalized.map(([x]) => x), ys = normalized.map(([, y]) => y);
  inside(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), size, label);
  return { ...raw, type: "quad", points: normalized as [[number, number], [number, number], [number, number], [number, number]] };
}
function sourceSize(raw: JsonObject): { width: unknown; height: unknown } {
  const canvas = isObject(raw.canvas) ? raw.canvas : isObject(raw.canvas_size) ? raw.canvas_size : {};
  return { width: raw.canvas_width ?? raw.width ?? canvas.width, height: raw.canvas_height ?? raw.height ?? canvas.height };
}
function nullableId(value: unknown, label: string): string | null {
  return value === undefined || value === null || value === "" ? null : identifier(value, label);
}
function validateReferences(page: SodaPage) {
  const ids = new Set(page.panels.map(panel => panel.id));
  for (const item of [...page.texts, ...(page.overlays || [])]) {
    if (item.panel_id && !ids.has(item.panel_id)) fail(`对象“${item.id}”引用了不存在的格子“${item.panel_id}”，请修正 panel_id。`);
  }
}

function placeMissingTextBoxes(page: SodaPage, warnings: string[]) {
  const counts = new Map<string | null, number>();
  const occupied = page.texts.filter(item => item.bbox).map(item => ({ parent: item.panel_id, bbox: item.bbox! }));
  const warnedQuads = new Set<string>();
  let placed = 0;
  for (const item of page.texts) {
    const index = counts.get(item.panel_id) || 0;
    counts.set(item.panel_id, index + 1);
    if (item.bbox) continue;
    const panel = page.panels.find(panel => panel.id === item.panel_id);
    let bounds: RectShape = { type: "rect", x: 0, y: 0, w: page.canvas_width, h: page.canvas_height };
    if (panel?.shape.type === "rect") bounds = panel.shape;
    else if (panel?.shape.type === "quad") {
      const xs = panel.shape.points.map(([x]) => x), ys = panel.shape.points.map(([, y]) => y);
      bounds = { type: "rect", x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      if (!warnedQuads.has(panel.id)) warnings.push(`格子 ${panel.id} 是四边形，自动文字按外接范围暂排，原斜边已保留，请检查文字是否压线。`);
      warnedQuads.add(panel.id);
    }
    const margin = Math.min(12, bounds.w * 0.04, bounds.h * 0.04);
    const font = typeof item.font_size === "number" && Number.isFinite(item.font_size) && item.font_size > 0 ? item.font_size
      : typeof page.text_font_size === "number" && Number.isFinite(page.text_font_size) && page.text_font_size > 0 ? page.text_font_size * page.canvas_width / 1024 : 42 * page.canvas_width / 1024;
    const limit = typeof page.text_max_chars === "number" && Number.isFinite(page.text_max_chars) ? Math.max(1, Math.min(1000, Math.floor(page.text_max_chars))) : 10;
    const vertical = (item.direction || page.text_direction) === "vertical";
    const lines = vertical ? verticalColumns(item.text, limit) : item.text.split("\n").flatMap(line => {
      const cells = Array.from(line), result = [];
      for (let start = 0; start < Math.max(1, cells.length); start += limit) result.push(cells.slice(start, start + limit));
      return result;
    });
    const cross = Math.max(1, lines.length) * font * 1.3, along = Math.max(1, ...lines.map(line => line.length)) * font * 1.15;
    const desiredWidth = (vertical ? cross : along) + 16, desiredHeight = (vertical ? along : cross) + 20;
    const scale = Math.min(1, (bounds.w - margin * 2) / desiredWidth, (bounds.h - margin * 2) / desiredHeight);
    const width = Math.min(bounds.w - margin * 2, Math.max(1, desiredWidth * scale));
    const height = Math.min(bounds.h - margin * 2, Math.max(1, desiredHeight * scale));
    const at = (slot: number): RectShape => {
      const right = ["right", "upper_right", "top_right"].includes(item.position) ||
        (!["left", "upper_left", "top_left"].includes(item.position) && (slot % 2 === 0) === (page.reading_direction === "rtl"));
      return { type: "rect", x: right ? bounds.x + bounds.w - margin - width : bounds.x + margin,
        y: bounds.y + margin + Math.min(Math.floor(slot / 2) * (height + margin), Math.max(0, bounds.h - height - margin * 2)), w: width, h: height };
    };
    let selected = at(index);
    for (let attempt = 0; attempt < 64; attempt++) {
      const candidate = at(index + attempt);
      if (!occupied.some(entry => entry.parent === item.panel_id && candidate.x < entry.bbox.x + entry.bbox.w && candidate.x + candidate.w > entry.bbox.x && candidate.y < entry.bbox.y + entry.bbox.h && candidate.y + candidate.h > entry.bbox.y)) {
        selected = candidate; break;
      }
    }
    item.bbox = selected;
    if (scale < 1) item.font_size = font * scale;
    occupied.push({ parent: item.panel_id, bbox: selected });
    placed++;
  }
  if (placed) warnings.push(`已为 ${placed} 条没有位置信息的文字自动排版，导入后可直接编辑；字号、位置和气泡请再微调。`);
  return placed;
}

function nativePage(raw: JsonObject): ImportedPageDraft {
  if (raw.format !== undefined && raw.format !== "soda-storyboard-page-v1") fail("这不是 Soda 分镜页文件。请选择 pages 目录中的页面 JSON，而不是项目、角色或工作流文件。");
  const normalized = normalizeImportedPageIds(raw);
  raw = normalized.page;
  const canvas = sourceSize(raw);
  const size = { width: dimension(canvas.width, "canvas_width"), height: dimension(canvas.height, "canvas_height") };
  const warnings = normalized.warnings;
  const panelIds = new Set<string>(), textIds = new Set<string>(), overlayIds = new Set<string>();
  const panels: SodaPanel[] = array(raw.panels, "panels").map((value, index) => {
    const item = object(value, `第 ${index + 1} 格`);
    const id = uniqueId(item.id ?? item.panel_id, `第 ${index + 1} 格 id`, panelIds);
    array(item.dialogue, `格子 ${id} 的 dialogue`, []);
    array(item.sfx, `格子 ${id} 的 sfx`, []);
    const figureIds = new Set<string>();
    const figures: Figure[] = array(item.figures, `格子 ${id} 的 figures`, []).map((value, figureIndex) => {
      const figure = object(value, `格子 ${id} 的第 ${figureIndex + 1} 个人物`);
      if (figure.id !== undefined) uniqueId(figure.id, `格子 ${id} 的人物 id`, figureIds);
      const position = figure.position ?? "center";
      if (typeof position !== "string") number(position, `格子 ${id} 的人物 position`);
      return { ...figure, character_id: text(figure.character_id, "人物 character_id"), pose: text(figure.pose, "人物 pose", "stand"), position, facing: text(figure.facing, "人物 facing", "front") } as Figure;
    });
    return { ...item, id, order: item.order === undefined ? index + 1 : number(item.order, `格子 ${id} 的 order`),
      shape: shape(item.shape ?? item, `格子 ${id} 的 shape`, size), shot: text(item.shot ?? item.shot_size, "shot", "medium"), angle: text(item.angle, "angle", "eye"),
      character_ids: strings(item.character_ids ?? item.characters, `格子 ${id} 的角色`), figures,
      description: text(item.description, "画面描述"), caption_en: text(item.caption_en, "caption_en") };
  });
  const texts: SodaText[] = array(raw.texts, "texts", []).map((value, index) => {
    const item = object(value, `第 ${index + 1} 条文字`);
    const id = uniqueId(item.id, `第 ${index + 1} 条文字 id`, textIds);
    return { ...item, id, text: text(item.text, `文字 ${id} 的 text`), kind: item.kind ?? "dialogue", bubble: item.bubble ?? "speech",
      panel_id: nullableId(item.panel_id, `文字 ${id} 的 panel_id`), speaker_id: nullableId(item.speaker_id, `文字 ${id} 的 speaker_id`), direction: item.direction ?? null,
      bbox: item.bbox == null ? null : rect(item.bbox, `文字 ${id} 的 bbox`, size) };
  });
  const overlays: SodaOverlay[] = array(raw.overlays, "overlays", []).map((value, index) => {
    const item = object(value, `第 ${index + 1} 个跨格人物`);
    const id = uniqueId(item.id, `第 ${index + 1} 个跨格人物 id`, overlayIds);
    return { ...item, id, character_id: identifier(item.character_id, `跨格人物 ${id} 的 character_id`), panel_id: nullableId(item.panel_id, `跨格人物 ${id} 的 panel_id`),
      rect: rect(item.rect, `跨格人物 ${id} 的 rect`, size), description: text(item.description, "跨格动作描述") };
  });
  let migrated = 0;
  const legacyId = (base: string) => { let id = base, suffix = 2; while (textIds.has(id)) id = `${base}-import-${suffix++}`; textIds.add(id); return id; };
  for (const panel of panels) {
    for (const [index, value] of (panel.dialogue || []).entries()) {
      const dialogue = typeof value === "string" ? { text: value } : object(value, `格子 ${panel.id} 的第 ${index + 1} 条台词`);
      const bubble = dialogue.bubble ?? dialogue.type ?? "speech";
      texts.push({ ...dialogue, id: legacyId(`${panel.id}-dialogue-${index + 1}`), text: text(dialogue.text ?? dialogue.content, "旧版台词内容"),
        kind: bubble === "narration" ? "narration" : "dialogue", bubble: bubble === "narration" ? "box" : bubble, direction: dialogue.direction ?? null,
        speaker_id: nullableId(dialogue.speaker_id ?? dialogue.speaker, "旧版台词说话人"), panel_id: panel.id, bbox: null });
      migrated++;
    }
    for (const [index, value] of (panel.sfx || []).entries()) {
      texts.push({ id: legacyId(`${panel.id}-sfx-${index + 1}`), text: text(value, "旧版拟声词"), kind: "sfx", bubble: "none", direction: "horizontal", panel_id: panel.id, speaker_id: null, bbox: null });
      migrated++;
    }
    if (panel.dialogue?.length) panel.dialogue = [];
    if (panel.sfx?.length) panel.sfx = [];
  }
  const page = { ...raw, format: "soda-storyboard-page-v1", id: identifier(raw.id ?? raw.page_id ?? "imported-page", "页面 id"),
    canvas_width: size.width, canvas_height: size.height, reading_direction: raw.reading_direction ?? raw.direction ?? "rtl", panel_gap: raw.panel_gap ?? raw.gutter ?? 24,
    dialogue_mode: raw.dialogue_mode ?? raw.lettering_mode ?? "moss_text", text_direction: raw.text_direction ?? "vertical", color_mode: raw.color_mode ?? "monochrome",
    description: text(raw.description ?? raw.caption, "页面描述"), panels, texts, overlays } as SodaPage;
  validateReferences(page);
  const placed = placeMissingTextBoxes(page, warnings);
  if (migrated) warnings.push(`已将 ${migrated} 条旧版台词和音效转为可编辑文字，内容已完整保留。`);
  const customCaptions = panels.filter(panel => panel.caption_en?.trim()).length;
  if (customCaptions) warnings.push(`已保留 ${customCaptions} 格原有英文提示词。默认按中文画面描述生成；只有开启“使用自定义提示词”或本页旧版兼容开关时才覆盖。`);
  if (migrated || placed) {
    if (!own(page, "import_source")) page.import_source = { format: "soda", data: clone(raw) };
    else if (!own(page, "import_original_page")) page.import_original_page = clone(raw);
  }
  return { page, format: "soda", warnings, needsCanvasSize: false };
}

function mossRect(bbox: unknown, size: Size, coordSpace: string, format: string, label: string): RectShape {
  const values = array(bbox, `${label}.bbox`);
  if (values.length !== 4) fail(`${label}.bbox 必须包含 4 个数字。`);
  const [a, b, c, d] = values.map((value, index) => number(value, `${label}.bbox[${index}]`));
  let x: number, y: number, w: number, h: number;
  if (format === "yxyx") { x = b; y = a; w = d - b; h = c - a; }
  else if (format === "xyxy") { x = a; y = b; w = c - a; h = d - b; }
  else { x = a; y = b; w = c; h = d; }
  if (coordSpace === "abs_centralized") { x += size.width / 2; y += size.height / 2; }
  inside(x, y, w, h, size, label);
  return { type: "rect", x, y, w, h };
}
function quotedText(caption: string): string | null {
  const quotes = [...caption.matchAll(/"([^"\n]*)"|“([^”]*)”|「([^」]*)」|『([^』]*)』/g)];
  return quotes.length === 1 ? quotes[0].slice(1).find(value => value !== undefined) ?? null : null;
}
function textPresentation(caption: string): Pick<SodaText, "kind" | "bubble" | "direction"> {
  const direction = /horizontal|横排/i.test(caption) ? "horizontal" : "vertical";
  if (/sound effect|\bsfx\b|拟声|音效/i.test(caption)) return { kind: "sfx", bubble: "none", direction };
  if (/narration|旁白/i.test(caption)) return { kind: "narration", bubble: "box", direction };
  if (/\btitle\b|标题/i.test(caption)) return { kind: "title", bubble: "box", direction };
  return { kind: "dialogue", bubble: /shout|jagged|burst|呐喊|喊叫|爆炸/i.test(caption) ? "shout" : /thought|思考/i.test(caption) ? "thought" : "speech", direction };
}
function mossPage(raw: JsonObject, options: ImportPageOptions): ImportedPageDraft {
  const warnings: string[] = [];
  const summary = object(raw.summary, "MOSS summary");
  const items = array(raw.items, "MOSS items").map((value, index) => object(value, `MOSS 第 ${index + 1} 个 item`));
  const canvas = sourceSize(raw);
  const needsCanvasSize = canvas.width === undefined || canvas.height === undefined;
  const size = { width: dimension(canvas.width ?? options.canvasWidth, "画布宽度"), height: dimension(canvas.height ?? options.canvasHeight, "画布高度") };
  if (needsCanvasSize) warnings.push("MOSS 未记录完整画布尺寸，坐标按你指定的宽高转换，请核对原图尺寸。");
  let coordSpace = raw.bbox_coord_space;
  let format = raw.bbox_format;
  if (coordSpace === undefined) { coordSpace = "abs_centralized"; warnings.push("缺少 bbox_coord_space，按标准 MOSS 的中心原点 abs_centralized 转换。"); }
  if (coordSpace === "centered") coordSpace = "abs_centralized";
  if (coordSpace !== "abs_centralized" && coordSpace !== "top_left_pixels") fail(`不支持 bbox_coord_space“${String(coordSpace)}”。请转换为 abs_centralized（中心原点像素）或 top_left_pixels（左上角像素），再导入。`);
  if (format === undefined) {
    if (coordSpace !== "abs_centralized") fail("top_left_pixels 必须明确填写 bbox_format：xyxy、xywh 或 yxyx，避免导错位置。");
    format = "yxyx"; warnings.push("缺少 bbox_format，按标准 MOSS 的 [y1, x1, y2, x2] 转换。");
  }
  if (!["yxyx", "xyxy", "xywh"].includes(format)) fail(`不支持 bbox_format“${String(format)}”。请使用 yxyx、xyxy 或 xywh。`);
  warnings.push("MOSS 只记录画面区域和文字，不能恢复原始人物姿势、角色身份或斜边；普通 object 按矩形格子保守导入，请检查版式并映射角色。");
  const panels: SodaPanel[] = [], texts: SodaText[] = [], overlays: SodaOverlay[] = [];
  const panelIds = new Set<string>(), textIds = new Set<string>(), overlayIds = new Set<string>();
  const characterIds = new Set(items.flatMap(item => [item.character_id, item.speaker_id]).filter(value => typeof value === "string"));
  let syntheticCharacterIndex = 1;
  const syntheticCharacter = () => {
    while (characterIds.has(`import_character_${syntheticCharacterIndex}`)) syntheticCharacterIndex++;
    const id = `import_character_${syntheticCharacterIndex++}`;
    characterIds.add(id); return id;
  };
  const declaredPanelIds = new Set(items.filter(item => item.label === "object" && !item.overlay_id).map(item => item.panel_id ?? item.id).filter(value => typeof value === "string"));
  const createId = (item: JsonObject, field: string, used: Set<string>, prefix: string, index: number) => {
    const reserved = new Set(items.filter(candidate => field === "panel_id" ? candidate.label === "object" && !candidate.overlay_id : field === "text_id" ? candidate.label === "text" : candidate.label === "character" || candidate.overlay_id)
      .map(candidate => candidate[field] ?? candidate.id).filter(value => typeof value === "string"));
    if (item[field] !== undefined && item[field] !== null) return importedId(item[field], `第 ${index + 1} 个 item 的 ${field}`, used, reserved, warnings);
    if (item.id !== undefined) return importedId(item.id, `第 ${index + 1} 个 item 的 id`, used, reserved, warnings);
    let id = `${prefix}-${index + 1}`, suffix = 2;
    while (used.has(id) || (prefix === "moss-panel" && declaredPanelIds.has(id))) id = `${prefix}-${index + 1}-${suffix++}`;
    used.add(id); return id;
  };
  const converted = items.map((item, index) => ({ item, index, rect: mossRect(item.bbox, size, coordSpace, format, `MOSS 第 ${index + 1} 个 item`) }));
  for (const { item, index, rect: bbox } of converted) {
    const label = text(item.label, `第 ${index + 1} 个 item 的 label`);
    const caption = text(item.caption, `第 ${index + 1} 个 item 的 caption`);
    if (label === "object" && !item.overlay_id) {
      panels.push({ id: createId(item, "panel_id", panelIds, "moss-panel", index), order: panels.length + 1, shape: bbox, shot: "medium", angle: "eye",
        character_ids: strings(item.character_ids ?? (item.character_id ? [item.character_id] : undefined), `第 ${index + 1} 个 item 的角色`), figures: [], description: caption, caption_en: "" });
    } else if (label === "character" || (label === "object" && item.overlay_id)) {
      const characterId = nullableId(item.character_id, `第 ${index + 1} 个 item 的 character_id`) || syntheticCharacter();
      if (!item.character_id) warnings.push(`第 ${index + 1} 个 MOSS 人物区域缺少角色 id，暂记为 ${characterId}，请映射到项目角色或明确跳过这个人物。`);
      overlays.push({ id: createId(item, "overlay_id", overlayIds, "moss-overlay", index), character_id: characterId,
        panel_id: nullableId(item.panel_id, "跨格人物 panel_id"), rect: bbox, description: caption, mode: "moss", status: "planned", z_index: overlays.length + 1 });
    } else if (label !== "text") fail(`第 ${index + 1} 个 item 的 label“${label}”不支持。仅支持 object、text、character，请先确认这是分镜 MOSS JSON。`);
  }
  for (const { item, index, rect: bbox } of converted.filter(({ item }) => item.label === "text")) {
    const id = createId(item, "text_id", textIds, "moss-text", index);
    const caption = text(item.caption, `文字 ${id} 的 caption`);
    const actualText = own(item, "text") ? text(item.text, `文字 ${id} 的 text`) : quotedText(caption);
    if (actualText === null) warnings.push(`文字 ${id} 的 caption 没有可唯一识别的引号原文，已保留空文字，请在导入后填写；原说明保存在 style_hint。`);
    else if (!own(item, "text")) warnings.push(`文字 ${id} 从 caption 的引号中提取了原文，请核对文字内容。`);
    let parent = nullableId(item.panel_id, `文字 ${id} 的 panel_id`);
    if (!parent) {
      const containing = panels.filter(panel => { const box = panel.shape as RectShape; return bbox.x >= box.x && bbox.y >= box.y && bbox.x + bbox.w <= box.x + box.w && bbox.y + bbox.h <= box.y + box.h; })
        .sort((a, b) => (a.shape as RectShape).w * (a.shape as RectShape).h - (b.shape as RectShape).w * (b.shape as RectShape).h);
      parent = containing[0]?.id ?? null;
      if (!parent) warnings.push(`文字 ${id} 不完全位于一个格子内，暂作为页上文字保留，请核对归属。`);
    }
    const presentation = textPresentation(caption);
    texts.push({ id, text: actualText ?? "", ...presentation, panel_id: parent, speaker_id: nullableId(item.speaker_id, `文字 ${id} 的 speaker_id`), bbox, style_hint: caption });
  }
  const page: SodaPage = { format: "soda-storyboard-page-v1", id: identifier(raw.page_id ?? raw.id ?? "imported-moss", "页面 id"), canvas_width: size.width, canvas_height: size.height,
    reading_direction: "rtl", panel_gap: 0, dialogue_mode: "moss_text", text_direction: "vertical", color_mode: Array.isArray(summary.meta) && summary.meta.includes("digital_painting") ? "color" : "monochrome",
    description: text(summary.caption, "MOSS summary.caption"), panels, texts, overlays, import_source: { format: "moss", data: clone(raw) } };
  validateReferences(page);
  return { page, format: "moss", warnings, needsCanvasSize };
}

export function parseImportedPage(source: string, options: ImportPageOptions): ImportedPageDraft {
  let json = source.replace(/^\uFEFF/, "").trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(json);
  if (fenced) json = fenced[1].trim();
  if (!json) fail("请先粘贴 JSON，或选择一个分镜 JSON 文件。");
  let parsed: unknown;
  try { parsed = parseJsonWithStringSeeds(json); }
  catch { return fail("JSON 格式不正确，请检查引号、逗号和括号。支持直接 JSON 或单个 ```json 代码块。"); }
  let raw = object(parsed, "导入内容");
  if (isObject(raw.page)) raw = raw.page;
  if (Array.isArray(raw.panels)) return nativePage(raw);
  if (own(raw, "summary") && own(raw, "items")) return mossPage(raw, options);
  return fail("未识别为 Soda 分镜页或 MOSS 布局。请选择包含 panels 的页面 JSON，或包含 summary 和 items 的 MOSS JSON；项目、角色和 ComfyUI 工作流不能作为页面导入。");
}

export function collectImportedCharacterIds(page: SodaPage): string[] {
  const ids = new Set<string>();
  const add = (value: unknown) => { if (typeof value === "string" && value.trim()) ids.add(value); };
  for (const panel of page.panels) {
    panel.character_ids?.forEach(add);
    panel.figures?.forEach(figure => add(figure.character_id));
    panel.dialogue?.forEach(dialogue => { if (isObject(dialogue)) add(dialogue.speaker_id ?? dialogue.speaker); });
  }
  page.texts?.forEach(item => add(item.speaker_id));
  page.overlays?.forEach(item => add(item.character_id));
  return [...ids];
}

export function mapImportedCharacters(page: SodaPage, mapping: Record<string, string | null>): SodaPage {
  const mapped = clone(page);
  const resolve = (id: string | null | undefined) => id && own(mapping, id) ? mapping[id] : id;
  for (const panel of mapped.panels) {
    panel.character_ids = [...new Set((panel.character_ids || []).map(resolve).filter((id): id is string => Boolean(id)))];
    panel.figures = (panel.figures || []).flatMap(figure => { const id = resolve(figure.character_id); return id === null ? [] : [{ ...figure, character_id: id ?? figure.character_id }]; });
    if (Array.isArray(panel.dialogue)) panel.dialogue = panel.dialogue.map(dialogue => {
      if (!isObject(dialogue)) return dialogue;
      const speaker = resolve(dialogue.speaker_id ?? dialogue.speaker) ?? null;
      return { ...dialogue, speaker_id: speaker, ...(own(dialogue, "speaker") ? { speaker } : {}) };
    });
  }
  mapped.texts = (mapped.texts || []).map(item => ({ ...item, speaker_id: resolve(item.speaker_id) ?? null }));
  if (mapped.overlays) mapped.overlays = mapped.overlays.flatMap(item => { const id = resolve(item.character_id); return id ? [{ ...item, character_id: id }] : []; });
  if (!own(mapped, "import_source") && !own(mapped, "import_original_page")) mapped.import_original_page = clone(page);
  mapped.import_character_mapping = { ...(isObject(mapped.import_character_mapping) ? mapped.import_character_mapping : {}), ...mapping };
  return mapped;
}
