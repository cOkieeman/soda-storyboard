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
