import assert from "node:assert/strict";
import test from "node:test";
import { fitHorizontalFontSize, layoutVerticalText, resolveTextFontSize } from "../src/lib/lettering.ts";
import { sodaPageToProjectPage } from "../src/lib/project.ts";

test("Legacy text inherits the same page font size used by preview while explicit pixel sizes stay fixed", () => {
  assert.equal(resolveTextFontSize(undefined, 42, 1024), 42);
  assert.equal(resolveTextFontSize(undefined, 42, 2048), 84);
  assert.equal(resolveTextFontSize(20, 42, 2048), 20);
  const page = sodaPageToProjectPage({ id: "p", canvas_width: 1024, canvas_height: 1536, text_font_size: 32, panels: [], texts: [{id:"t",text:"原文",kind:"dialogue",bubble:"speech",direction:"vertical",bbox:{type:"rect",x:40,y:40,w:120,h:200}}] });
  assert.equal(page.bubbles[0].fontSize, 32);
});

test("Large vertical text has full-width glyph cells and fits every token inside the bubble", () => {
  const large = layoutVerticalText(240, 300, "这是竖排文字", 64);
  assert.equal(large.fontSize, 64);
  assert.ok(large.columnWidth >= 64, "columns must not be capped at 36px");
  const small = layoutVerticalText(95, 210, "这是很小的气泡中的文字", 128);
  assert.equal(small.columns.flat().join(""), "这是很小的气泡中的文字");
  assert.ok(small.columns.length * small.columnWidth <= 75);
  assert.ok(Math.max(...small.columns.map(column => column.length)) * small.cellHeight <= 186);
});

test("Oversized horizontal text fits instead of becoming an empty clipped line", () => {
  const size = fitHorizontalFontSize(180, 60, "这是横排文字", 128);
  assert.ok(size > 8 && size < 60 / 1.25);
  assert.equal(fitHorizontalFontSize(300, 100, "短句", 32), 32);
});
