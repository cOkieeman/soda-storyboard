import assert from "node:assert/strict";
import test from "node:test";

// Import modules under test
import { projectPageToSodaPage, sodaPageToProjectPage } from "../src/lib/project.ts";
import { translateVerticalForms, verticalColumns, tokenizeLine } from "../src/lib/lettering.ts";
import { parseJsonWithStringSeeds } from "../src/lib/api.ts";
import { useEditorStore } from "../src/lib/store.ts";
import { cloneFigurePose, ensureFigureEditor, getFigureId } from "../src/lib/figureRig.ts";
import { generatePageSketchGeometry } from "../src/lib/sketchGeometry.ts";

test("Render seeds retain every integer digit at the JSON boundary", () => {
  const raw = '{"renders":[{"seed":3896687444318080379},{"seed":0},{"seed":"8925744111054236951"}],"count":3}';
  const value = parseJsonWithStringSeeds(raw);
  assert.deepEqual(value.renders.map((item) => item.seed), ["3896687444318080379", "0", "8925744111054236951"]);
  assert.equal(value.count, 3);
});

test("Seed protection preserves ordinary JSON strings and nested page metadata", () => {
  const value = parseJsonWithStringSeeds('{"production":{"renders":[{"seed":8925744111054236951}]},"description":"say \\"seed\\": 123","seed":null,"weight":0.8}');
  assert.equal(value.production.renders[0].seed, "8925744111054236951");
  assert.equal(value.description, 'say "seed": 123');
  assert.equal(value.seed, null);
  assert.equal(value.weight, 0.8);
});

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

function withHistoryFixture(run) {
  const originalState = useEditorStore.getState();
  const sodaPage = {
    id: "history_page",
    canvas_width: 1024,
    canvas_height: 1536,
    reading_direction: "rtl",
    panel_gap: 20,
    panels: [{
      id: "panel_1", order: 1, shot: "medium", angle: "eye",
      character_ids: [], figures: [], description: "原始画面", caption_en: "",
      shape: { type: "rect", x: 40.123456, y: 50.987654, w: 400.333333, h: 600.444444 }
    }],
    texts: [{
      id: "text_1", panel_id: "panel_1", kind: "dialogue", speaker_id: null,
      direction: "vertical", bubble: "speech", text: "原台词",
      bbox: { type: "rect", x: 120.125, y: 140.25, w: 90, h: 180 }
    }],
    overlays: []
  };
  useEditorStore.setState({
    activePageId: sodaPage.id,
    sodaPage,
    project: { id: sodaPage.id, name: sodaPage.id, activePageId: sodaPage.id, pages: [sodaPageToProjectPage(sodaPage)] },
    characters: [], selection: null, historyPast: [], historyFuture: [],
    historyGroup: null, canUndo: false, canRedo: false,
    dirtyPanelIds: new Set(), dirtyBubbleIds: new Set(), hasUnsavedChanges: false,
    autoSaveTimer: null,
    triggerAutoSave: () => useEditorStore.setState({ hasUnsavedChanges: true })
  });
  const savePayload = () => {
    const state = useEditorStore.getState();
    return projectPageToSodaPage(state.project.pages[0], state.sodaPage, state.dirtyPanelIds, state.dirtyBubbleIds);
  };
  try {
    run({ originalPage: sodaPage, savePayload, getState: useEditorStore.getState });
  } finally {
    useEditorStore.setState(originalState, true);
  }
}

test("Adding and editing figures preserves untouched panel geometry at its original precision", () => {
  withHistoryFixture(({ originalPage, savePayload, getState }) => {
    getState().addFigurePreset("stand", undefined, "panel_1");
    const id = getState().selection.id;
    const figure = getState().sodaPage.panels[0].figures[0];
    getState().updateFigureById("panel_1", id, { editor: { ...figure.editor, x: 125.5, y: 280.75 } });
    assert.deepEqual(savePayload().panels[0].shape, originalPage.panels[0].shape);
    // A preceding panel drag still has to survive a subsequent figure edit.
    getState().updatePanel("panel_1", { x: 222.25, y: 333.75 });
    getState().updateFigureById("panel_1", id, { editor: { ...figure.editor, x: 150.5, y: 290.75 } });
    assert.equal(savePayload().panels[0].shape.x, 222.25);
    assert.equal(savePayload().panels[0].shape.y, 333.75);
  });
});

test("Starting an empty page creates one selectable, saveable panel and can be undone", () => {
  withHistoryFixture(({ savePayload, getState }) => {
    const emptyPage = {
      ...getState().sodaPage,
      canvas_width: 1000,
      canvas_height: 1000,
      panels: [],
      texts: []
    };
    useEditorStore.setState({
      sodaPage: emptyPage,
      project: { ...getState().project, pages: [sodaPageToProjectPage(emptyPage)] }
    });

    getState().startFirstPanel();
    assert.equal(getState().sodaPage.panels.length, 1);
    assert.equal(getState().project.pages[0].panels.length, 1);
    const firstPanel = getState().sodaPage.panels[0];
    assert.deepEqual(getState().selection, { kind: "panel", id: firstPanel.id },
      "the first panel must be selected so its description can be edited immediately");
    const shape = firstPanel.shape;
    assert.equal(shape.type, "rect");
    assert.ok([shape.x, shape.y, shape.w, shape.h].every(Number.isFinite));
    assert.ok(shape.x >= 0 && shape.y >= 0 && shape.w > 0 && shape.h > 0);
    assert.ok(shape.x + shape.w <= 1000 && shape.y + shape.h <= 1000,
      "the first panel must fit inside the page canvas");
    assert.equal(getState().hasUnsavedChanges, true);
    assert.equal(getState().canUndo, true);
    assert.equal(savePayload().panels.length, 1);
    assert.equal(savePayload().panels[0].id, firstPanel.id);
    assert.deepEqual(savePayload().panels[0].shape, shape);

    const historyLength = getState().historyPast.length;
    getState().selectItem(null);
    getState().startFirstPanel();
    assert.equal(getState().sodaPage.panels.length, 1,
      "starting an existing page must select its panel without adding another");
    assert.equal(getState().project.pages[0].panels.length, 1);
    assert.deepEqual(getState().selection, { kind: "panel", id: firstPanel.id });
    assert.equal(getState().historyPast.length, historyLength,
      "selecting an existing panel must not add an undo step");

    getState().undo();
    assert.equal(getState().sodaPage.panels.length, 0);
    assert.equal(getState().project.pages[0].panels.length, 0);
    assert.equal(savePayload().panels.length, 0,
      "saving after undo must restore the empty page");
  });
});

test("Panel drag undo preserves original float geometry and redo keeps the moved save payload", () => {
  withHistoryFixture(({ originalPage, savePayload, getState }) => {
    getState().updatePanel("panel_1", { x: 180.25, y: 240.75 });
    assert.equal(getState().canUndo, true, "a canvas move must create an undo step");
    const movedShape = savePayload().panels[0].shape;
    assert.equal(movedShape.x, 180.25);
    assert.equal(movedShape.y, 240.75);

    getState().undo();
    assert.equal(getState().project.pages[0].panels[0].x, originalPage.panels[0].shape.x);
    assert.deepEqual(savePayload().panels[0].shape, originalPage.panels[0].shape,
      "saving after undo must retain all six original decimal places");
    assert.equal(getState().dirtyPanelIds.size, 0);
    assert.equal(getState().canRedo, true);

    getState().redo();
    assert.equal(getState().project.pages[0].panels[0].x, 180.25);
    assert.deepEqual(savePayload().panels[0].shape, movedShape,
      "redo must save the moved geometry even after undo cleared dirty IDs");
    getState().undo();
    assert.deepEqual(savePayload().panels[0].shape, originalPage.panels[0].shape);
  });
});

test("Text typing coalesces until a pause and creating a new bubble can be undone independently", (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  withHistoryFixture(({ savePayload, getState }) => {
    getState().updateSodaText("text_1", { text: "修改" });
    now += 500;
    getState().updateSodaText("text_1", { text: "修改后的台词" });
    assert.equal(getState().historyPast.length, 1, "continuous typing should be one undo step");

    now += 751;
    getState().updateSodaText("text_1", { text: "停顿后继续" });
    assert.equal(getState().historyPast.length, 2, "typing after a pause needs a separate undo step");
    getState().undo();
    assert.equal(savePayload().texts[0].text, "修改后的台词");
    getState().undo();
    assert.equal(savePayload().texts[0].text, "原台词");
    getState().redo();
    assert.equal(savePayload().texts[0].text, "修改后的台词");
    getState().redo();
    assert.equal(savePayload().texts[0].text, "停顿后继续");

    getState().addTextToPanel("panel_1");
    const createdId = getState().selection.id;
    assert.equal(savePayload().texts.length, 2);
    assert.ok(savePayload().texts.some((text) => text.id === createdId));

    getState().undo();
    assert.equal(getState().project.pages[0].bubbles.length, 1);
    assert.equal(savePayload().texts.length, 1);
    assert.equal(savePayload().texts[0].text, "停顿后继续",
      "undoing creation must keep the preceding text edit");
    getState().undo();
    assert.equal(savePayload().texts[0].text, "修改后的台词");
  });
});

const expectedTextPresets = [
  ["narration_vertical", "vertical", "box", "narration"],
  ["speech_vertical", "vertical", "speech", "dialogue"],
  ["speech_horizontal", "horizontal", "speech", "dialogue"],
  ["thought", "horizontal", "thought", "dialogue"],
  ["shout", "horizontal", "shout", "dialogue"],
  ["transparent", "horizontal", "none", "narration"],
  ["title", "horizontal", "box", "title"]
];

test("Every text preset creates the advertised editable object in its selected panel", () => {
  for (const [preset, direction, bubble, kind] of expectedTextPresets) {
    withHistoryFixture(({ savePayload, getState }) => {
      getState().selectItem({ kind: "panel", id: "panel_1" });
      getState().addTextPreset(preset);
      const selection = getState().selection;
      assert.equal(selection?.kind, "text", `${preset}: immediately select the new text`);
      const text = savePayload().texts.find((item) => item.id === selection.id);
      assert.ok(text, `${preset}: the new text must be in the save payload`);
      assert.notEqual(text.id, "text_1");
      assert.equal(text.panel_id, "panel_1");
      assert.equal(text.direction, direction);
      assert.equal(text.bubble, bubble);
      assert.equal(text.kind, kind);
      assert.ok(text.text.trim().length > 0, `${preset}: supply editable placeholder copy`);
      assert.ok([text.bbox.x, text.bbox.y, text.bbox.w, text.bbox.h].every(Number.isFinite));
      assert.ok(text.bbox.w > 0 && text.bbox.h > 0);
      const canvasBubble = getState().project.pages[0].bubbles.find((item) => item.id === text.id);
      assert.ok(canvasBubble, `${preset}: the canvas object must exist immediately`);
      assert.equal(canvasBubble.direction, direction);
      if (preset === "transparent") assert.ok(["transparent", "rgba(255,255,255,0)"].includes(canvasBubble.background), "transparent text must have no opaque fill");
      getState().undo();
      assert.equal(savePayload().texts.length, 1, `${preset}: creation is one undo step`);
      getState().redo();
      assert.ok(savePayload().texts.some((item) => item.id === text.id));
    });
  }
});

test("Adding elements follows a selected text or figure into its parent panel", () => {
  withHistoryFixture(({ getState, savePayload }) => {
    const secondPanel = { ...getState().sodaPage.panels[0], id: "panel_2", order: 2, shape: { type: "rect", x: 500, y: 100, w: 450, h: 650 } };
    const page = { ...getState().sodaPage, panels: [...getState().sodaPage.panels, secondPanel] };
    useEditorStore.setState({ sodaPage: page, project: { ...getState().project, pages: [sodaPageToProjectPage(page)] } });
    getState().addTextPreset("speech_horizontal", "panel_2");
    const selectedTextId = getState().selection.id;
    assert.equal(savePayload().texts.find((item) => item.id === selectedTextId).panel_id, "panel_2");
    getState().addFigurePreset("stand");
    const selectedFigure = getState().selection;
    assert.equal(selectedFigure.kind, "figure");
    assert.equal(selectedFigure.panelId, "panel_2");
    getState().addTextPreset("thought");
    assert.equal(savePayload().texts.find((item) => item.id === getState().selection.id).panel_id, "panel_2");
    assert.equal(savePayload().panels[0].figures.length, 0, "the first panel must stay untouched");
  });
});

test("Text font size changes reach the canvas and survive saving and undo", () => {
  withHistoryFixture(({ getState, savePayload }) => {
    getState().addTextPreset("title", "panel_1");
    const id = getState().selection.id;
    assert.equal(getState().project.pages[0].bubbles.find((item) => item.id === id).fontSize, 32);
    getState().updateSodaText(id, { font_size: 48 });
    assert.equal(getState().project.pages[0].bubbles.find((item) => item.id === id).fontSize, 48);
    const saved = savePayload();
    assert.equal(saved.texts.find((item) => item.id === id).font_size, 48);
    assert.equal(sodaPageToProjectPage(JSON.parse(JSON.stringify(saved))).bubbles.find((item) => item.id === id).fontSize, 48);
    getState().undo();
    assert.equal(savePayload().texts.find((item) => item.id === id).font_size, 32);
  });
});

test("Bubble tails can be enabled and explicitly cleared through save, move, and reload", () => {
  withHistoryFixture(({ getState, savePayload }) => {
    const bubble = () => getState().project.pages[0].bubbles.find((item) => item.id === "text_1");
    const text = () => getState().sodaPage.texts.find((item) => item.id === "text_1");
    const reloadSaved = () => {
      const saved = JSON.parse(JSON.stringify(savePayload()));
      useEditorStore.setState({ sodaPage: saved, project: { ...getState().project, pages: [sodaPageToProjectPage(saved)] }, dirtyPanelIds: new Set(), dirtyBubbleIds: new Set() });
      return saved.texts.find((item) => item.id === "text_1");
    };

    const tip = [45.25, 214.5];
    getState().updateSodaText("text_1", { tail_tip: tip });
    assert.deepEqual(bubble().tailTip, tip);
    assert.deepEqual(reloadSaved().tail_tip, tip);
    assert.deepEqual(bubble().tailTip, tip, "an enabled tail must reappear after reloading the page");

    getState().updateSodaText("text_1", { tail_tip: null });
    assert.equal(text().tail_tip, null);
    assert.equal(bubble().tailTip, null, "clearing from the inspector must clear the visible canvas tail");
    assert.equal(bubble().sodaData.tail_tip, null);
    getState().updateBubble("text_1", { x: bubble().x + 20, y: bubble().y + 10 });
    assert.equal(bubble().tailTip, null);
    assert.equal(reloadSaved().tail_tip, null, "saving and moving a bubble must not revive a cleared tail");
    assert.equal(text().tail_tip, null);
    assert.equal(bubble().tailTip, null);

    const newTip = [60, 240];
    getState().updateBubble("text_1", { tailTip: newTip });
    assert.deepEqual(text().tail_tip, newTip);
    assert.deepEqual(reloadSaved().tail_tip, newTip);
    getState().updateBubble("text_1", { tailTip: null });
    assert.equal(text().tail_tip, null, "the reverse canvas-to-text path must also retain explicit null");
    assert.equal(reloadSaved().tail_tip, null);
    assert.equal(bubble().tailTip, null);
  });
});

test("Switching transparent text to a speech bubble updates its fill and border immediately and on reload", () => {
  withHistoryFixture(({ getState, savePayload }) => {
    getState().addTextPreset("transparent", "panel_1");
    const id = getState().selection.id;
    const bubble = () => getState().project.pages[0].bubbles.find((item) => item.id === id);
    assert.equal(bubble().borderWidth, 0);
    getState().updateSodaText(id, { bubble: "speech" });
    assert.equal(bubble().type, "rounded");
    assert.equal(bubble().background, "#ffffff");
    assert.equal(bubble().borderColor, "#171815");
    assert.equal(bubble().borderWidth, 2);
    const saved = JSON.parse(JSON.stringify(savePayload()));
    const reloadedBubble = sodaPageToProjectPage(saved).bubbles.find((item) => item.id === id);
    assert.equal(saved.texts.find((item) => item.id === id).bubble, "speech");
    assert.equal(reloadedBubble.type, "rounded");
    assert.equal(reloadedBubble.background, "#ffffff");
    assert.equal(reloadedBubble.borderWidth, 2);

    getState().updateSodaText(id, { bubble: "none" });
    assert.equal(bubble().type, "rect");
    assert.equal(bubble().borderWidth, 0);
    assert.equal(bubble().borderColor, "transparent");
    assert.ok(["transparent", "rgba(255,255,255,0)"].includes(bubble().background));
    const transparentReload = sodaPageToProjectPage(JSON.parse(JSON.stringify(savePayload()))).bubbles.find((item) => item.id === id);
    assert.equal(transparentReload.borderWidth, 0);
    assert.ok(["transparent", "rgba(255,255,255,0)"].includes(transparentReload.background));
  });
});

test("Handshake and hug presets create two independent figures with one undo step", () => {
  for (const pair of ["handshake", "hug"]) {
    withHistoryFixture(({ getState, savePayload }) => {
      getState().addFigurePreset("stand", pair, "panel_1");
      const figures = savePayload().panels[0].figures;
      assert.equal(figures.length, 2, `${pair}: add both people together`);
      assert.ok(figures.every((figure) => figure.id && figure.editor?.version === 1));
      assert.notEqual(figures[0].id, figures[1].id);
      assert.notEqual(figures[0].editor.x, figures[1].editor.x);
      assert.notEqual(figures[0].editor.flip, figures[1].editor.flip, "partners must face each other");
      assert.equal(getState().historyPast.length, 1, "the pair must be a single undo operation");
      assert.equal(getState().selection.kind, "figure");
      assert.ok(figures.some((figure) => figure.id === getState().selection.id));
      getState().undo();
      assert.equal(savePayload().panels[0].figures.length, 0);
      getState().redo();
      assert.deepEqual(savePayload().panels[0].figures.map((figure) => figure.id), figures.map((figure) => figure.id));
      getState().removeFigureById("panel_1", figures[0].id);
      assert.deepEqual(savePayload().panels[0].figures.map((figure) => figure.id), [figures[1].id], "each partner remains independently editable");
    });
  }
});

test("Independent figure edits retain two-dimensional pose data through JSON save and reload", () => {
  withHistoryFixture(({ getState, savePayload }) => {
    getState().addFigurePreset("wave", undefined, "panel_1");
    const id = getState().selection.id;
    const figure = getState().sodaPage.panels[0].figures.find((item) => item.id === id);
    const joints = cloneFigurePose("wave");
    joints.rHand = [43.75, -87.25];
    const editor = { ...figure.editor, x: 123.5, y: 456.25, size: 278.75, flip: true, style: "rough", break_frame: true, joints };
    getState().updateFigureById("panel_1", id, { editor });
    const saved = savePayload();
    assert.deepEqual(saved.panels[0].figures.find((item) => item.id === id).editor, editor);
    const reloaded = JSON.parse(JSON.stringify(saved));
    const roundtrip = projectPageToSodaPage(sodaPageToProjectPage(reloaded), reloaded, new Set(), new Set());
    assert.deepEqual(roundtrip.panels[0].figures.find((item) => item.id === id).editor, editor);
    assert.deepEqual(ensureFigureEditor(roundtrip.panels[0].figures[0], { width: 400, height: 600 }).joints.rHand, joints.rHand);
    const historyBeforeDelete = getState().historyPast.length;
    getState().selectItem({ kind: "figure", id, panelId: "panel_1" });
    getState().deleteSelection();
    assert.equal(savePayload().panels[0].figures.length, 0);
    assert.equal(generatePageSketchGeometry(savePayload(), []).panels[0].figures.length, 0, "deleting the last figure must not revive a fallback figure");
    assert.equal(getState().historyPast.length, historyBeforeDelete + 1);
    getState().undo();
    assert.deepEqual(savePayload().panels[0].figures.find((item) => item.id === id).editor, editor);
  });
});

test("Editing a legacy figure assigns stable identity without losing its custom metadata", () => {
  withHistoryFixture(({ getState, savePayload }) => {
    const legacy = { character_id: "alice", pose: "stand", position: "center", facing: "front", framing: "full", custom_note: "keep me" };
    const page = { ...getState().sodaPage, panels: [{ ...getState().sodaPage.panels[0], figures: [legacy], character_ids: ["alice"] }] };
    useEditorStore.setState({ sodaPage: page, project: { ...getState().project, pages: [sodaPageToProjectPage(page)] } });
    const editor = { ...ensureFigureEditor(legacy, { width: 400, height: 600 }), x: 75.25, y: 380.5 };
    getState().updateFigureById("panel_1", getFigureId(legacy, 0), { editor });
    const migrated = savePayload().panels[0].figures[0];
    assert.ok(migrated.id, "the first edit must store a persistent figure identity");
    assert.equal(migrated.custom_note, "keep me");
    assert.equal(migrated.editor.x, 75.25);
    assert.equal(migrated.editor.y, 380.5);
    getState().removeFigureById("panel_1", migrated.id);
    assert.equal(generatePageSketchGeometry(savePayload(), []).panels[0].figures.length, 0);
  });
});

test("Character-only legacy pages materialize all visible people, then deletion never revives them", () => {
  withHistoryFixture(({ getState, savePayload }) => {
    const page = { ...getState().sodaPage, panels: [{ ...getState().sodaPage.panels[0], figures: [], character_ids: ["alice", "bob"] }] };
    useEditorStore.setState({ sodaPage: page, project: { ...getState().project, pages: [sodaPageToProjectPage(page)] } });
    const initialGeometry = generatePageSketchGeometry(page, []);
    assert.equal(initialGeometry.panels[0].figures.length, 2);
    const firstVisibleId = initialGeometry.panels[0].figures[0].figure_id;
    const legacy = { character_id: "alice", pose: "stand", position: 0.75, facing: "front", framing: null };
    const editor = { ...ensureFigureEditor(legacy, { width: 400, height: 600, shot: "medium" }), x: 96.5 };
    getState().updateFigureById("panel_1", firstVisibleId, { editor });
    const migrated = savePayload().panels[0].figures;
    assert.equal(migrated.length, 2, "editing one fallback person must retain the other person");
    assert.ok(migrated.every((figure) => figure.id));
    assert.equal(migrated.find((figure) => figure.character_id === "alice").editor.x, 96.5);
    getState().removeFigureById("panel_1", migrated.find((figure) => figure.character_id === "alice").id);
    assert.deepEqual(generatePageSketchGeometry(savePayload(), []).panels[0].figures.map((figure) => figure.character_id), ["bob"]);
    getState().removeFigureById("panel_1", savePayload().panels[0].figures[0].id);
    const saved = savePayload();
    assert.equal(saved.panels[0].figures.length, 0);
    assert.equal(generatePageSketchGeometry(JSON.parse(JSON.stringify(saved)), []).panels[0].figures.length, 0);
  });
});

