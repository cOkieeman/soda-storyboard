/**
 * Vertical text column splitting, balancing, and punctuation replacement
 * Matching Python core implementation in src/soda_storyboard/lettering.py
 */

// Unicode vertical presentation forms keep punctuation upright
// "…—，。！？「」『』（）：；" -> "︙︱︐︒︕︖﹁﹂﹃﹄︵︶︓︔"
export const VERTICAL_FORMS_MAP: Record<string, string> = {
  "…": "︙",
  "—": "︱",
  "，": "︐",
  "。": "︒",
  "！": "︕",
  "？": "︖",
  "「": "﹁",
  "」": "﹂",
  "『": "﹃",
  "』": "﹄",
  "（": "︵",
  "）": "︶",
  "：": "︓",
  "；": "︔",
  ",": "︐",
  ".": "︒",
  "!": "︕",
  "?": "︖",
  ":": "︓",
  ";": "︔"
};

export const BREAK_AFTER = new Set(["︐", "︒", "︕", "︖", "﹂", "﹄", "︶", "︓", "︔"]);

export function resolveTextFontSize(explicit: unknown, pageSize: unknown, canvasWidth = 1024): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) return Math.max(1, Math.min(512, explicit));
  const inherited = typeof pageSize === "number" && Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 42;
  return Math.max(1, Math.min(512, inherited * canvasWidth / 1024));
}

export function layoutVerticalText(width: number, height: number, text: string, requestedSize: number) {
  const availableWidth = Math.max(1, width - 20), availableHeight = Math.max(1, height - 24);
  let fontSize = Math.max(1, Math.min(512, Math.floor(requestedSize || 20)));
  let columns: string[][] = [];
  for (; fontSize > 1; fontSize--) {
    columns = verticalColumns(text, Math.max(1, Math.floor(availableHeight / (fontSize * 1.22))));
    if (columns.length * fontSize * 1.2 <= availableWidth) break;
  }
  if (fontSize === 1) columns = verticalColumns(text, Math.max(1, Math.floor(availableHeight / 1.22)));
  const columnWidth = fontSize * 1.2, cellHeight = fontSize * 1.22;
  return { fontSize, columns, columnWidth, cellHeight, startX: width - 12 - columnWidth, startY: 12 };
}

export function fitHorizontalFontSize(width: number, height: number, text: string, requestedSize: number): number {
  let size = Math.max(1, Math.min(512, Math.floor(requestedSize || 20)));
  for (; size > 1; size--) {
    const capacity = Math.max(0.1, width / size);
    const rows = text.split("\n").reduce((count, line) => {
      const units = Array.from(line).reduce((sum, glyph) => sum + (/^[\x20-\x7e]$/.test(glyph) ? 0.65 : 1), 0);
      return count + Math.max(1, Math.ceil(units / capacity));
    }, 0);
    if (size <= width && rows * size * 1.25 <= height) break;
  }
  return size;
}

export function translateVerticalForms(text: string): string {
  let result = "";
  for (const char of text) {
    result += VERTICAL_FORMS_MAP[char] || char;
  }
  return result;
}

/**
 * Tokenize a line into character/word cells (matching re.findall(r"[A-Za-z0-9]+|[^A-Za-z0-9]", line))
 */
export function tokenizeLine(line: string): string[] {
  const matches = line.match(/[A-Za-z0-9]+|[^A-Za-z0-9]/g);
  return matches || [];
}

/**
 * Balance each explicit line into vertical columns; ASCII runs occupy one horizontal cell.
 * Returns columns of tokens. In manga RTL, columns are read right-to-left.
 */
export function verticalColumns(text: string, limit = 10): string[][] {
  const safeLimit = Math.max(1, limit);
  const result: string[][] = [];

  const translated = translateVerticalForms(text);
  const lines = translated.split("\n");

  for (const line of lines) {
    const cells = tokenizeLine(line);
    if (cells.length === 0) {
      result.push([]);
      continue;
    }

    const count = Math.max(1, Math.ceil(cells.length / safeLimit));
    const target = cells.length / count;

    // Dynamic programming balances columns while preferring punctuation breaks
    // states: map of startIndex -> { score, parts: string[][] }
    let states: Map<number, { score: number; parts: string[][] }> = new Map();
    states.set(0, { score: 0, parts: [] });

    for (let column = 0; column < count; column++) {
      const following: Map<number, { score: number; parts: string[][] }> = new Map();

      for (const [start, { score: cost, parts }] of states.entries()) {
        const maxEnd = Math.min(cells.length, start + safeLimit);
        for (let end = start + 1; end <= maxEnd; end++) {
          const remaining = cells.length - end;
          if (
            !(
              count - column - 1 <= remaining &&
              remaining <= (count - column - 1) * safeLimit
            )
          ) {
            continue;
          }

          let penalty = Math.pow(end - start - target, 2);
          if (end < cells.length) {
            penalty += BREAK_AFTER.has(cells[end - 1]) ? 0 : 2;
            penalty += BREAK_AFTER.has(cells[end]) ? 4 : 0;
          }

          const score = cost + penalty;
          const currentBest = following.get(end);
          if (!currentBest || score < currentBest.score) {
            following.set(end, {
              score,
              parts: [...parts, cells.slice(start, end)]
            });
          }
        }
      }
      states = following;
    }

    const finalState = states.get(cells.length);
    if (finalState && finalState.parts.length > 0) {
      result.push(...finalState.parts);
    } else {
      // Fallback simple chunking if DP state search missed
      for (let i = 0; i < cells.length; i += safeLimit) {
        result.push(cells.slice(i, i + safeLimit));
      }
    }
  }

  return result;
}
