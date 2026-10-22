import { verticalColumns } from "./lettering";

type Point = [number, number];

// Keep these formulas in sync with soda_storyboard/bubble_geometry.py.
// Arc-length spacing and pixel-depth valleys keep portrait bubbles from growing long teeth.
export function shoutBubblePoints(width: number, height: number, borderWidth = 2, tailTip?: Point | null): Point[] {
  const cx = width / 2, cy = height / 2;
  const rx = Math.max(0.5, (width - borderWidth) / 2), ry = Math.max(0.5, (height - borderWidth) / 2);
  const depth = Math.min(Math.min(width, height) * 0.15, Math.max(4, Math.min(10, Math.min(width, height) * 0.075)));
  const samples: Array<{ length: number; angle: number }> = [{ length: 0, angle: -Math.PI / 2 }];
  let length = 0;
  for (let index = 1; index <= 360; index++) {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / 360;
    const previous = samples[index - 1].angle;
    length += Math.hypot(rx * (Math.cos(angle) - Math.cos(previous)), ry * (Math.sin(angle) - Math.sin(previous)));
    samples.push({ length, angle });
  }
  const count = Math.max(10, Math.min(28, Math.round(length / 76) * 2));
  let cursor = 1;
  const points: Point[] = [];
  for (let index = 0; index < count * 2; index++) {
    const target = index * length / (count * 2);
    while (cursor < 360 && samples[cursor].length < target) cursor++;
    const a = samples[cursor - 1], b = samples[cursor];
    const angle = a.angle + (b.angle - a.angle) * (target - a.length) / (b.length - a.length);
    let x = cx + rx * Math.cos(angle), y = cy + ry * Math.sin(angle);
    if (index % 2) {
      const nx = Math.cos(angle) / rx, ny = Math.sin(angle) / ry;
      const normal = Math.hypot(nx, ny);
      x -= nx / normal * depth;
      y -= ny / normal * depth;
    }
    points.push([x, y]);
  }
  if (tailTip && Math.pow((tailTip[0] - cx) / rx, 2) + Math.pow((tailTip[1] - cy) / ry, 2) > 1) {
    let nearest = 0, distance = Infinity;
    for (let index = 0; index < points.length; index += 2) {
      const candidate = Math.hypot(points[index][0] - tailTip[0], points[index][1] - tailTip[1]);
      if (candidate < distance) { nearest = index; distance = candidate; }
    }
    const [x, y] = points[nearest];
    const extension = Math.min(distance, 40, Math.min(width, height) * 0.25);
    points[nearest] = [x + (tailTip[0] - x) / distance * extension, y + (tailTip[1] - y) / distance * extension];
  }
  return points;
}

export function shoutTextArea(width: number, height: number) {
  const depth = Math.min(Math.min(width, height) * 0.15, Math.max(4, Math.min(10, Math.min(width, height) * 0.075)));
  // A centered rectangle inscribed in the valleys' ellipse, with room for the stroke.
  const usableWidth = Math.max(1, (width - depth * 2 - 4) * 0.68);
  const usableHeight = Math.max(1, (height - depth * 2 - 4) * 0.68);
  return { x: (width - usableWidth) / 2, y: (height - usableHeight) / 2, width: usableWidth, height: usableHeight };
}

export function layoutShoutText(width: number, height: number, text: string, direction: "vertical" | "horizontal", requestedSize: number) {
  const area = shoutTextArea(width, height);
  let fontSize = Math.max(1, Math.min(512, Math.floor(requestedSize || 20)));
  let columns: string[][] = [], lines: string[] = [];
  for (; fontSize >= 1; fontSize--) {
    if (direction === "vertical") {
      columns = verticalColumns(text, Math.max(1, Math.floor(area.height / (fontSize * 1.22))));
      if (columns.length * fontSize * 1.2 <= area.width) break;
    } else {
      const limit = Math.max(1, Math.floor(area.width / fontSize));
      lines = text.split("\n").flatMap((line) => {
        const chars = Array.from(line);
        if (!chars.length) return [""];
        return Array.from({ length: Math.ceil(chars.length / limit) }, (_, index) => chars.slice(index * limit, (index + 1) * limit).join(""));
      });
      if (lines.length * fontSize * 1.25 <= area.height) break;
    }
  }
  fontSize = Math.max(1, fontSize);
  const cellWidth = fontSize * 1.2, cellHeight = fontSize * (direction === "vertical" ? 1.22 : 1.25);
  const contentWidth = direction === "vertical" ? columns.length * cellWidth : area.width;
  const contentHeight = (direction === "vertical" ? Math.max(1, ...columns.map((column) => column.length)) : lines.length) * cellHeight;
  return { area, fontSize, columns, lines, cellWidth, cellHeight, contentX: (width - contentWidth) / 2, contentY: (height - contentHeight) / 2 };
}
