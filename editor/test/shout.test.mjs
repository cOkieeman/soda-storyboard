import assert from "node:assert/strict";
import test from "node:test";
import { shoutBubblePoints, layoutShoutText } from "../src/lib/bubbleGeometry.ts";

function contains(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

test("shout geometry uses short, evenly spaced spikes in portrait and landscape bubbles", () => {
  for (const [width, height] of [[110, 200], [200, 150], [300, 70], [70, 300]]) {
    const points = shoutBubblePoints(width, height);
    const peaks = points.filter((_, index) => index % 2 === 0);
    const gaps = peaks.map((point, index) => Math.hypot(point[0] - peaks[(index + 1) % peaks.length][0], point[1] - peaks[(index + 1) % peaks.length][1]));
    assert.ok(Math.max(...gaps) / Math.min(...gaps) < 1.45, "a tall bubble must not stretch the side spikes");
    assert.ok(points.every(([x, y]) => x >= 0 && x <= width && y >= 0 && y <= height));
    assert.ok(contains([width / 2, height / 2], points));
    const { area } = layoutShoutText(width, height, "新台词", "vertical", 20);
    for (const x of [area.x, area.x + area.width]) for (const y of [area.y, area.y + area.height]) assert.ok(contains([x, y], points), "safe text area stays inside every spike valley");
  }
});

test("shout only extends an explicit tail, and clamps its length", () => {
  const ordinary = shoutBubblePoints(110, 200);
  const distant = shoutBubblePoints(110, 200, 2, [55, 5000]);
  assert.ok(Math.max(...ordinary.map((point) => point[1])) <= 200);
  assert.ok(Math.max(...distant.map((point) => point[1])) <= 229);
  assert.notDeepEqual(distant, ordinary);
  assert.deepEqual(shoutBubblePoints(110, 200, 2, [55, 100]), ordinary);
});

test("portrait shout text is centered and remains readable rather than hugging the teeth", () => {
  const result = layoutShoutText(110, 200, "新台词", "vertical", 20);
  assert.equal(result.fontSize, 20);
  assert.deepEqual(result.columns, [["新", "台", "词"]]);
  assert.equal(result.contentX + result.cellWidth / 2, 55);
  assert.equal(result.contentY + result.cellHeight * 3 / 2, 100);
  const long = layoutShoutText(110, 200, "这一句很长的喊话也应该留在气泡里面！", "vertical", 28);
  assert.ok(long.columns.length * long.cellWidth <= long.area.width);
  assert.ok(Math.max(...long.columns.map((column) => column.length)) * long.cellHeight <= long.area.height);
  assert.equal(long.columns.flat().join(""), "这一句很长的喊话也应该留在气泡里面︕");
});

test("horizontal shout reflows explicit newlines inside its centered safe area", () => {
  const result = layoutShoutText(200, 150, "什么？！\n快看这边", "horizontal", 24);
  assert.deepEqual(result.lines, ["什么？！", "快看这边"]);
  assert.equal(result.fontSize, 24);
  assert.equal(result.contentY + result.lines.length * result.cellHeight / 2, 75);
});
