import assert from "node:assert/strict";
import test from "node:test";

// Import modules under test
import { projectPageToSodaPage, sodaPageToProjectPage } from "../src/lib/project.ts";
import { translateVerticalForms, verticalColumns, tokenizeLine } from "../src/lib/lettering.ts";

test("1. Page conversion preserves exact float precision and unknown fields (B1 verification)", () => {
  const originalSodaPage = {
    id: "page_pudding",
    version: "v_12345",
    canvas_width: 1024,
    canvas_height: 1536,
    reading_direction: "rtl",
    panel_gap: 20,
    tags: ["drama", "comedy"],
    style_prompt: "masterpiece, anime aesthetic",
    panels: [
      {
        id: "p1",
        order: 1,
        shot: "medium",
        angle: "eye",
        character_ids: ["sylvia", "helena"],
        description: "两人对视",
        caption_en: "Sylvia and Helena looking at each other",
        figures: [
          {
            character_id: "sylvia",
            pose: "stand",
            position: 0.35,
            facing: "right",
            framing: "waist"
          }
        ],
        shape: {
          type: "quad",
          points: [
            [40.123456, 40.987654],
            [980.555555, 42.111111],
            [960.333333, 480.777777],
            [60.888888, 475.222222]
          ]
        },
        custom_backend_meta: "do_not_lose_this_field"
      },
      {
        id: "p2",
        order: 2,
        shot: "close_up",
        angle: "high",
        character_ids: ["helena"],
        description: "特写布丁",
        caption_en: "Close up of pudding",
        figures: [],
        shape: {
          type: "rect",
          x: 40.5,
          y: 500.25,
          w: 460.75,
          h: 480.125
        }
      }
    ],
    texts: [
      {
        id: "t1",
        kind: "dialogue",
        panel_id: "p1",
        speaker_id: "sylvia",
        direction: "vertical",
        bubble: "speech",
        text: "这是我的布丁！",
        bbox: {
          type: "rect",
          x: 750.5,
          y: 80.25,
          w: 95.0,
          h: 210.0
        }
      }
    ],
    overlays: [
      {
        id: "o1",
        character_id: "sylvia",
        description: "头发飘出格子",
        rect: { type: "rect", x: 100, y: 100, w: 200, h: 200 }
      }
    ]
  };

  // Convert SodaPage -> ProjectPage
  const projectPage = sodaPageToProjectPage(originalSodaPage);

  // Unedited roundtrip: dirtyPanelIds is empty
  const roundtripPage = projectPageToSodaPage(
    projectPage,
    originalSodaPage,
    new Set(),
    new Set()
  );

  // Assert unknown / metadata fields are preserved
  assert.equal(roundtripPage.id, originalSodaPage.id);
  assert.equal(roundtripPage.version, originalSodaPage.version);
  assert.equal(roundtripPage.tags[0], "drama");
  assert.equal(roundtripPage.style_prompt, originalSodaPage.style_prompt);
  assert.equal(roundtripPage.overlays[0].id, "o1");
  assert.equal(roundtripPage.panels[0].custom_backend_meta, "do_not_lose_this_field");

  // Assert unedited quad shape retains exact original float points untouched
  assert.deepEqual(roundtripPage.panels[0].shape, originalSodaPage.panels[0].shape);
  assert.equal(roundtripPage.panels[0].shape.points[0][0], 40.123456);
  assert.equal(roundtripPage.panels[0].shape.points[0][1], 40.987654);

  // Assert unedited rect shape retains exact original shape
  assert.deepEqual(roundtripPage.panels[1].shape, originalSodaPage.panels[1].shape);

  // Now simulate user editing p1: mark dirty
  const dirtyPanelIds = new Set(["p1"]);
  const editedRoundtrip = projectPageToSodaPage(
    projectPage,
    originalSodaPage,
    dirtyPanelIds,
    new Set()
  );
  // Verify quad shape has at least 4 decimal places of float precision, NOT rounded to 1 decimal place!
  const p0 = editedRoundtrip.panels[0].shape.points[0];
  const decimalPlacesX = (p0[0].toString().split(".")[1] || "").length;
  assert.ok(
    decimalPlacesX >= 2,
    `Edited quad point should retain high precision, got ${p0[0]}`
  );
});

test("2. Text bubble movement and resize persists upon roundtrip (S1 verification)", () => {
  const baseSodaPage = {
    id: "page_1",
    canvas_width: 1024,
    canvas_height: 1536,
    panels: [],
    texts: [
      {
        id: "t_dialogue_1",
        kind: "dialogue",
        panel_id: "p1",
        speaker_id: "sylvia",
        direction: "vertical",
        bubble: "speech",
        text: "姐姐，布丁分我一半嘛！",
        bbox: {
          type: "rect",
          x: 120,
          y: 150,
          w: 80,
          h: 220
        }
      }
    ]
  };

  const projectPage = sodaPageToProjectPage(baseSodaPage);
  assert.equal(projectPage.bubbles.length, 1);
  assert.equal(projectPage.bubbles[0].x, 120);
  assert.equal(projectPage.bubbles[0].y, 150);

  // User drags text bubble to (340, 280) and resizes to 110x240
  const movedBubble = projectPage.bubbles[0];
  movedBubble.x = 340;
  movedBubble.y = 280;
  movedBubble.width = 110;
  movedBubble.height = 240;

  const dirtyBubbleIds = new Set(["t_dialogue_1"]);
  const savedSodaPage = projectPageToSodaPage(
    projectPage,
    baseSodaPage,
    new Set(),
    dirtyBubbleIds
  );

  // Verify savedSodaPage has updated bbox
  assert.equal(savedSodaPage.texts[0].bbox.x, 340);
  assert.equal(savedSodaPage.texts[0].bbox.y, 280);
  assert.equal(savedSodaPage.texts[0].bbox.w, 110);
  assert.equal(savedSodaPage.texts[0].bbox.h, 240);
  assert.equal(savedSodaPage.texts[0].text, "姐姐，布丁分我一半嘛！");

  // Reloading the page from saved JSON yields the moved position
  const reloadedProjectPage = sodaPageToProjectPage(savedSodaPage);
  assert.equal(reloadedProjectPage.bubbles[0].x, 340);
  assert.equal(reloadedProjectPage.bubbles[0].y, 280);
  assert.equal(reloadedProjectPage.bubbles[0].width, 110);
  assert.equal(reloadedProjectPage.bubbles[0].height, 240);
});

test("3. Vertical text typography and punctuation substitution (Item 9 verification)", () => {
  // Test punctuation substitution
  const input = "你好，世界！真的吗？……「确实」";
  const translated = translateVerticalForms(input);
  assert.ok(translated.includes("︐"), "Comma should become vertical form ︐");
  assert.ok(translated.includes("︕"), "Exclamation should become vertical form ︕");
  assert.ok(translated.includes("︖"), "Question should become vertical form ︖");
  assert.ok(translated.includes("︙"), "Ellipsis should become vertical form ︙");
  assert.ok(translated.includes("﹁"), "Left bracket should become ﹁");
  assert.ok(translated.includes("﹂"), "Right bracket should become ﹂");

  // Test tokenization of ASCII run + Chinese
  const line = "Soda123分镜";
  const tokens = tokenizeLine(line);
  assert.deepEqual(tokens, ["Soda123", "分", "镜"]);

  // Test column balancing
  const longDialogue = "姐姐你看，冰箱里的草莓布丁不见了！到底是谁偷吃的？";
  const cols = verticalColumns(longDialogue, 8);
  assert.ok(cols.length >= 2, "Long dialogue should be split into multiple columns");
  // Total characters accounted for
  const joined = cols.flat().join("");
  assert.equal(joined.length, translateVerticalForms(longDialogue).length);
});

test("4. Speech bubble tail tip position survives roundtrip between SodaText and Bubble", () => {
  const baseSodaPage = {
    id: "page_tail_test",
    canvas_width: 1000,
    canvas_height: 1000,
    panels: [],
    texts: [
      {
        id: "t_tail_1",
        kind: "dialogue",
        panel_id: "p1",
        direction: "horizontal",
        bubble: "speech",
        text: "看看我的引线气泡！",
        tail_tip: [350.5, 420.25],
        bbox: {
          type: "rect",
          x: 200,
          y: 300,
          w: 120,
          h: 60
        }
      }
    ]
  };

  const projectPage = sodaPageToProjectPage(baseSodaPage);
  assert.equal(projectPage.bubbles.length, 1);
  assert.deepEqual(projectPage.bubbles[0].tailTip, [350.5, 420.25]);

  // Now user moves tail tip
  projectPage.bubbles[0].tailTip = [380.0, 450.0];
  const dirtyBubbleIds = new Set(["t_tail_1"]);
  const savedSodaPage = projectPageToSodaPage(
    projectPage,
    baseSodaPage,
    new Set(),
    dirtyBubbleIds
  );

  assert.deepEqual(savedSodaPage.texts[0].tail_tip, [380.0, 450.0]);

  // Roundtrip back
  const reloaded = sodaPageToProjectPage(savedSodaPage);
  assert.deepEqual(reloaded.bubbles[0].tailTip, [380.0, 450.0]);
});

