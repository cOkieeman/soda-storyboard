import React, { useMemo } from "react";
import { useEditorStore } from "../lib/store";
import { Figure, ShotType, AngleType, FigurePose, TextKind, BubbleStyle, SodaCharacter } from "../types";
import CustomSelect from "./ui/CustomSelect";

const SHOT_OPTIONS: { value: ShotType; label: string }[] = [
  { value: "extreme_long", label: "大远景 (Extreme Long)" },
  { value: "long", label: "远景 (Long)" },
  { value: "full", label: "全景 (Full)" },
  { value: "medium", label: "中景 (Medium)" },
  { value: "close_up", label: "特写 (Close-up)" },
  { value: "extreme_close_up", label: "大特写 (Extreme Close-up)" }
];

const ANGLE_OPTIONS: { value: AngleType; label: string }[] = [
  { value: "eye", label: "平视 (Eye level)" },
  { value: "high", label: "俯视 (High angle)" },
  { value: "low", label: "仰视 (Low angle)" },
  { value: "bird", label: "鸟瞰 (Bird's eye)" },
  { value: "worm", label: "虫视 (Worm's eye)" },
  { value: "dutch", label: "荷兰角倾斜 (Dutch tilt)" }
];

const POSE_OPTIONS: { value: FigurePose; label: string }[] = [
  { value: "stand", label: "站立 (stand)" },
  { value: "walk", label: "行走 (walk)" },
  { value: "run", label: "奔跑 (run)" },
  { value: "sit", label: "坐下 (sit)" },
  { value: "crouch", label: "蹲下 (crouch)" },
  { value: "wave", label: "挥手 (wave)" },
  { value: "point", label: "指向 (point)" },
  { value: "arms_up", label: "举手 (arms_up)" },
  { value: "hands_clasped", label: "双手合十 (hands_clasped)" },
  { value: "hand_on_chin", label: "托下巴/推眼镜 (hand_on_chin)" },
  { value: "lie", label: "躺下 (lie)" },
  { value: "back_view", label: "背影 (back_view)" }
];

const FACING_OPTIONS = [
  { value: "front", label: "正 (front)" },
  { value: "left", label: "左 (left)" },
  { value: "right", label: "右 (right)" },
  { value: "back", label: "背 (back)" }
];

const FRAMING_OPTIONS = [
  { value: "", label: "默认 (null)" },
  { value: "full", label: "全身 (full)" },
  { value: "waist", label: "半身 (waist)" },
  { value: "bust", label: "胸部 (bust)" },
  { value: "face", label: "面部 (face)" }
];

const KIND_OPTIONS: { value: TextKind; label: string }[] = [
  { value: "dialogue", label: "台词 (Dialogue)" },
  { value: "narration", label: "旁白 (Narration)" },
  { value: "sfx", label: "拟声词 (SFX)" },
  { value: "title", label: "标题 (Title)" }
];

const DIRECTION_OPTIONS = [
  { value: "vertical", label: "竖排 (Vertical)" },
  { value: "horizontal", label: "横排 (Horizontal)" }
];

const BUBBLE_OPTIONS: { value: BubbleStyle; label: string }[] = [
  { value: "speech", label: "对话气泡 (Speech)" },
  { value: "shout", label: "喊叫气泡 (Shout)" },
  { value: "thought", label: "思考气泡 (Thought)" },
  { value: "box", label: "方框 (Box)" },
  { value: "none", label: "无气泡 (None)" }
];

export default function InspectorPanel() {
  const sodaPage = useEditorStore((state) => state.sodaPage);
  const characters = useEditorStore((state) => state.characters);
  const characterDetails = useEditorStore((state) => state.characterDetails);
  const selection = useEditorStore((state) => state.selection);
  const selectItem = useEditorStore((state) => state.selectItem);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const validationIssues = useEditorStore((state) => state.validationIssues);

  const updateSodaPanel = useEditorStore((state) => state.updateSodaPanel);
  const updateSodaText = useEditorStore((state) => state.updateSodaText);
  const updateSodaOverlay = useEditorStore((state) => state.updateSodaOverlay);
  const addFigureToPanel = useEditorStore((state) => state.addFigureToPanel);
  const removeFigureFromPanel = useEditorStore((state) => state.removeFigureFromPanel);
  const updateFigureInPanel = useEditorStore((state) => state.updateFigureInPanel);

  // Compute Page Checklist (P4c Item 8)
  const checklist = useMemo(() => {
    if (!sodaPage) return [];
    const items: Array<{
      id: string;
      title: string;
      type: "empty_desc" | "no_character" | "long_text" | "multi_lora";
      targetKind: "panel" | "text";
      targetId: string;
    }> = [];

    // Empty description
    sodaPage.panels.forEach((p) => {
      if (!p.description || p.description.trim() === "") {
        items.push({
          id: `desc-${p.id}`,
          title: `格 #${p.order} (${p.id}): 未填写画面描述`,
          type: "empty_desc",
          targetKind: "panel",
          targetId: p.id
        });
      }
    });

    // Unassigned characters
    sodaPage.panels.forEach((p) => {
      if (!p.character_ids || p.character_ids.length === 0) {
        items.push({
          id: `char-${p.id}`,
          title: `格 #${p.order} (${p.id}): 未指定登场角色`,
          type: "no_character",
          targetKind: "panel",
          targetId: p.id
        });
      }
    });

    // Long dialogue (>20 characters)
    sodaPage.texts.forEach((t, idx) => {
      if (t.text && t.text.length > 20) {
        items.push({
          id: `text-${t.id || idx}`,
          title: `台词框 (${t.id}): 台词过长 (${t.text.length}字，建议拆分或精简)`,
          type: "long_text",
          targetKind: "text",
          targetId: t.id
        });
      }
    });

    // Multi-LoRA conflict risk
    sodaPage.panels.forEach((p) => {
      if (p.character_ids && p.character_ids.length > 1) {
        const loras = new Set<string>();
        p.character_ids.forEach((cid) => {
          const char = characterDetails[cid];
          if (char?.lora?.path) loras.add(char.lora.path);
        });
        if (loras.size > 1) {
          items.push({
            id: `lora-${p.id}`,
            title: `格 #${p.order} (${p.id}): 多 LoRA 冲突风险 (${loras.size}个不同LoRA)`,
            type: "multi_lora",
            targetKind: "panel",
            targetId: p.id
          });
        }
      }
    });

    return items;
  }, [sodaPage, characterDetails]);

  if (!sodaPage) {
    return (
      <aside className="flex h-full items-center justify-center border-l border-[var(--line)] bg-[var(--paper-surface)] p-4 text-sm text-[var(--ink)]">
        请选择分镜页
      </aside>
    );
  }

  // Selected panel
  const selectedPanel =
    selection?.kind === "panel"
      ? sodaPage.panels.find((p) => p.id === selection.id)
      : null;

  // Selected text
  const selectedText =
    selection?.kind === "text" || selection?.kind === "bubble"
      ? sodaPage.texts.find((t) => t.id === selection.id)
      : null;

  // Selected overlay
  const selectedOverlay =
    selection?.kind === "overlay"
      ? (sodaPage.overlays || []).find((o) => o.id === selection.id)
      : null;

  return (
    <aside className="flex h-full flex-col border-l border-[var(--line)] bg-[var(--paper-surface)] select-none">
      {/* Header */}
      <div className="border-b border-[var(--line)] bg-[var(--paper)] px-4 py-3">
        <span className="font-mono text-[13px] font-bold tracking-wider text-[var(--ink)]">
          属性面板 / INSPECTOR
        </span>
      </div>

      {/* Top Banner: VALIDATION ISSUES (422 ERRORS / WARNINGS) (P4c Item 6) */}
      {validationIssues.length > 0 && (
        <div className="border-b-2 border-[#d93829] bg-[#fdf2f1] p-3.5">
          <div className="flex items-center justify-between font-bold text-[14px] text-[#9a321f]">
            <span>⚠ 校验失败: 发现 {validationIssues.length} 个问题</span>
            <span className="font-mono text-xs uppercase bg-[#d93829] text-white px-1.5 py-0.5 rounded font-bold">
              HTTP 422
            </span>
          </div>
          <div className="mt-2.5 space-y-2">
            {validationIssues.map((issue, idx) => {
              const isError = issue.severity === "error";
              return (
                <div
                  key={idx}
                  onClick={() => {
                    if (issue.panel_id) {
                      selectItem({ kind: "panel", id: issue.panel_id });
                    } else if (issue.field === "texts") {
                      if (sodaPage.texts.length > 0) {
                        selectItem({ kind: "text", id: sodaPage.texts[0].id });
                      }
                    }
                  }}
                  className={`cursor-pointer border-l-4 p-2.5 text-[13px] transition shadow-sm ${
                    isError
                      ? "border-[#d93829] bg-white text-[#171815] hover:bg-[#fff7f6]"
                      : "border-amber-500 bg-white text-[#171815] hover:bg-amber-50"
                  }`}
                >
                  <div className="flex items-center justify-between font-bold">
                    <span className={isError ? "text-[#d93829]" : "text-amber-800"}>
                      {isError ? "✖ 错误 (Error)" : "▲ 警告 (Warning)"}
                    </span>
                    {issue.panel_id && (
                      <span className="underline text-[#9a321f] text-xs font-semibold">
                        点击定位 {issue.panel_id}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm leading-snug font-medium text-[#171815]">
                    {issue.message}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Sticky/Collapsible Page Checklist when an item is selected */}
        {(selectedPanel || selectedText || selectedOverlay) && checklist.length > 0 && (
          <details className="border border-amber-300 bg-amber-50/90 p-2.5 rounded group shadow-xs">
            <summary className="cursor-pointer select-none font-bold text-xs flex items-center justify-between text-amber-950">
              <span className="flex items-center gap-1.5">
                <span>📋 本页检查清单</span>
                <span className="font-mono text-[11px] px-1.5 py-0.2 rounded bg-amber-200 text-amber-900 font-semibold">
                  {checklist.length} 项待处理
                </span>
              </span>
              <span className="text-[11px] font-normal text-amber-800 underline">
                展开清单
              </span>
            </summary>

            <div className="mt-2.5 space-y-1.5 pt-2 border-t border-amber-200">
              {checklist.map((item) => (
                <div
                  key={item.id}
                  onClick={() => selectItem({ kind: item.targetKind, id: item.targetId })}
                  className="cursor-pointer border border-amber-200 bg-white/95 p-2 text-xs transition hover:bg-amber-100 hover:border-amber-400"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-amber-900 leading-snug">
                      {item.title}
                    </span>
                    <span className="text-xs font-bold text-[var(--signal)] underline shrink-0 ml-2">
                      跳转定位
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* PANEL INSPECTOR */}
        {selectedPanel ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--line)] pb-2.5">
              <div>
                <span className="font-mono text-base font-bold text-[var(--signal)]">
                  格 #{selectedPanel.order}
                </span>
                <span className="ml-2 font-mono text-xs text-[var(--ink-light)]">
                  ID: {selectedPanel.id}
                </span>
              </div>
              <button
                type="button"
                onClick={deleteSelection}
                className="font-mono text-[13px] font-semibold text-[#d93829] hover:underline"
              >
                删除此格
              </button>
            </div>

            {/* Reading Order */}
            <div>
              <label className="ui-label">阅读顺序 (Order)</label>
              <input
                type="number"
                min={1}
                value={selectedPanel.order}
                onChange={(e) => updateSodaPanel(selectedPanel.id, { order: Number(e.target.value) || 1 })}
                className="ui-input"
              />
            </div>

            {/* Shot and Angle */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="ui-label">景别 (Shot)</label>
                <CustomSelect
                  value={selectedPanel.shot}
                  options={SHOT_OPTIONS}
                  onChange={(val) => updateSodaPanel(selectedPanel.id, { shot: val })}
                />
              </div>

              <div>
                <label className="ui-label">视角 (Angle)</label>
                <CustomSelect
                  value={selectedPanel.angle}
                  options={ANGLE_OPTIONS}
                  onChange={(val) => updateSodaPanel(selectedPanel.id, { angle: val })}
                />
              </div>
            </div>

            {/* Characters Involved */}
            <div>
              <label className="ui-label">登场角色 (Characters)</label>
              <div className="flex flex-wrap gap-2">
                {characters.map((c) => {
                  const isChecked = selectedPanel.character_ids?.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        const current = selectedPanel.character_ids || [];
                        const next = isChecked
                          ? current.filter((id) => id !== c.id)
                          : [...current, c.id];
                        updateSodaPanel(selectedPanel.id, { character_ids: next });
                      }}
                      className={`px-3 py-1.5 font-sans text-[13px] font-bold border transition ${
                        isChecked
                          ? "border-[var(--signal)] bg-[var(--signal)] text-white shadow-sm"
                          : "border-[var(--line)] bg-[var(--paper-lift)] text-[var(--ink)] hover:border-[var(--ink)]"
                      }`}
                    >
                      {c.display_name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Figures (Stick Figures / Poses) */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="ui-label mb-0">人物站位与姿态 (Figures)</label>
                <button
                  type="button"
                  onClick={() => {
                    const defaultChar = characters[0]?.id || "char";
                    const existingFigures = selectedPanel.figures || [];
                    const defaultPos =
                      existingFigures.length === 0
                        ? "center"
                        : existingFigures.length === 1
                        ? "right"
                        : 0.8;
                    const newFigure: Figure = {
                      character_id: defaultChar,
                      pose: "stand",
                      position: defaultPos,
                      facing: "front",
                      framing: null
                    };
                    addFigureToPanel(selectedPanel.id, newFigure);
                  }}
                  className="ui-btn ui-btn-sm text-[13px] font-bold"
                >
                  + 添加人物
                </button>
              </div>

              <div className="space-y-2.5">
                {(selectedPanel.figures || []).map((f, idx) => (
                  <div key={idx} className="border border-[var(--line)] bg-[var(--paper-lift)] p-3 space-y-2">
                    <div className="flex items-center justify-between border-b border-[var(--line)] pb-1.5">
                      <span className="font-mono text-xs font-bold text-[var(--signal)]">
                        人物 #{idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFigureFromPanel(selectedPanel.id, idx)}
                        className="font-sans text-xs text-[#d93829] font-semibold hover:underline"
                      >
                        移除
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-semibold text-[var(--ink)] block mb-1">角色</label>
                        <CustomSelect
                          value={f.character_id}
                          options={characters.map((c) => ({ value: c.id, label: `${c.display_name} (${c.id})` }))}
                          onChange={(val) => updateFigureInPanel(selectedPanel.id, idx, { character_id: val })}
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-[var(--ink)] block mb-1">姿势</label>
                        <CustomSelect
                          value={f.pose}
                          options={POSE_OPTIONS}
                          onChange={(val) => updateFigureInPanel(selectedPanel.id, idx, { pose: val })}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs font-semibold text-[var(--ink)] block mb-1">位置</label>
                        <input
                          type="text"
                          value={String(f.position)}
                          onChange={(e) => {
                            const val = e.target.value;
                            const num = parseFloat(val);
                            updateFigureInPanel(selectedPanel.id, idx, {
                              position: !isNaN(num) && num >= 0 && num <= 1 ? num : (val as any)
                            });
                          }}
                          placeholder="left/center/right/0.5"
                          className="ui-input text-[13px] py-1"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-[var(--ink)] block mb-1">朝向</label>
                        <CustomSelect
                          value={f.facing}
                          options={FACING_OPTIONS}
                          onChange={(val) => updateFigureInPanel(selectedPanel.id, idx, { facing: val as any })}
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-[var(--ink)] block mb-1">景框</label>
                        <CustomSelect
                          value={f.framing || ""}
                          options={FRAMING_OPTIONS}
                          onChange={(val) => updateFigureInPanel(selectedPanel.id, idx, { framing: val ? (val as any) : null })}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Chinese Description */}
            <div>
              <label className="ui-label">中文分镜描述 (Description)</label>
              <textarea
                rows={3}
                value={selectedPanel.description || ""}
                onChange={(e) => updateSodaPanel(selectedPanel.id, { description: e.target.value })}
                placeholder="例如：姐姐推眼镜，向前一步"
                className="ui-textarea text-sm"
              />
            </div>

            {/* English Caption (Collapsible) */}
            <details
              className="border border-[var(--line)] bg-[var(--paper-lift)] p-2.5 rounded group"
              open={Boolean(selectedPanel.caption_en && selectedPanel.caption_en.trim())}
            >
              <summary className="ui-label mb-0 cursor-pointer select-none font-semibold flex items-center justify-between text-xs text-[var(--ink)]">
                <span>英文生成提示词 (Caption EN)</span>
                <span className="text-[11px] font-mono text-[var(--ink-light)] font-normal group-open:hidden">
                  {selectedPanel.caption_en ? "已填写 (点击展开)" : "未填写 (点击展开)"}
                </span>
              </summary>
              <div className="mt-2">
                <textarea
                  rows={3}
                  value={selectedPanel.caption_en || ""}
                  onChange={(e) => updateSodaPanel(selectedPanel.id, { caption_en: e.target.value })}
                  placeholder="Top-right panel: inside kitchen..."
                  className="ui-textarea font-mono text-xs"
                />
              </div>
            </details>

            {/* Shape Geometry Info */}
            <div className="border border-[var(--line)] bg-[var(--paper-lift)] p-2.5 font-mono text-xs text-[var(--ink)]">
              <span className="font-bold text-[var(--signal)]">形状几何: </span>
              {selectedPanel.shape.type === "rect" ? (
                <span>
                  Rect ({selectedPanel.shape.x}, {selectedPanel.shape.y}) {selectedPanel.shape.w}×{selectedPanel.shape.h}
                </span>
              ) : (
                <span>Quad 四边形 ({selectedPanel.shape.points?.length || 4} 顶点精确浮点)</span>
              )}
            </div>
          </div>
        ) : selectedText ? (
          /* TEXT INSPECTOR */
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--line)] pb-2.5">
              <div>
                <span className="font-mono text-base font-bold text-[var(--signal)]">
                  台词框 ({selectedText.id})
                </span>
              </div>
              <button
                type="button"
                onClick={deleteSelection}
                className="font-mono text-[13px] font-semibold text-[#d93829] hover:underline"
              >
                删除文字框
              </button>
            </div>

            <div>
              <label className="ui-label">类型 (Kind)</label>
              <CustomSelect
                value={selectedText.kind}
                options={KIND_OPTIONS}
                onChange={(val) => updateSodaText(selectedText.id, { kind: val as any })}
              />
            </div>

            <div>
              <label className="ui-label">原文台词文本 (Text)</label>
              <textarea
                rows={4}
                value={selectedText.text || ""}
                onChange={(e) => updateSodaText(selectedText.id, { text: e.target.value })}
                placeholder="输入台词，可换行"
                className="ui-textarea text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="ui-label">说话人 (Speaker)</label>
                <CustomSelect
                  value={selectedText.speaker_id || ""}
                  options={[
                    { value: "", label: "无 (旁白/拟声)" },
                    ...characters.map((c) => ({ value: c.id, label: `${c.display_name} (${c.id})` }))
                  ]}
                  onChange={(val) => updateSodaText(selectedText.id, { speaker_id: val || null })}
                />
              </div>

              <div>
                <label className="ui-label">排列方向 (Direction)</label>
                <CustomSelect
                  value={selectedText.direction || "vertical"}
                  options={DIRECTION_OPTIONS}
                  onChange={(val) => {
                    const newDir = val as any;
                    const b = selectedText.bbox;
                    let nextW = b?.w || 100;
                    let nextH = b?.h || 200;
                    if (newDir === "horizontal" && nextH > nextW * 1.2) {
                      nextW = Math.max(130, Math.min(260, Math.round(nextH * 0.7)));
                      nextH = Math.max(65, Math.min(130, Math.round((b?.w || 100) * 0.9)));
                    } else if (newDir === "vertical" && nextW > nextH * 1.2) {
                      nextW = Math.max(65, Math.min(130, Math.round(nextH * 0.9)));
                      nextH = Math.max(140, Math.min(320, Math.round((b?.w || 100) * 0.7)));
                    }
                    updateSodaText(selectedText.id, {
                      direction: newDir,
                      bbox: b ? { ...b, w: nextW, h: nextH } : undefined
                    });
                  }}
                />
              </div>
            </div>

            <div>
              <label className="ui-label">气泡样式 (Bubble Style)</label>
              <CustomSelect
                value={selectedText.bubble || "speech"}
                options={BUBBLE_OPTIONS}
                onChange={(val) => updateSodaText(selectedText.id, { bubble: val as any })}
              />
            </div>

            {selectedText.bubble !== "box" && selectedText.bubble !== "none" && (
              <div>
                <label className="ui-label">气泡引线 (Tail)</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedText.tail_tip) {
                        updateSodaText(selectedText.id, { tail_tip: undefined });
                      } else {
                        const defaultTx = Math.round((selectedText.bbox?.w || 100) / 2);
                        const defaultTy = Math.round((selectedText.bbox?.h || 200) + 28);
                        updateSodaText(selectedText.id, { tail_tip: [defaultTx, defaultTy] });
                      }
                    }}
                    className={`flex-1 px-3 py-1.5 text-xs rounded border font-mono transition text-center ${
                      selectedText.tail_tip
                        ? "bg-[var(--signal)] text-white border-[var(--signal)] font-bold shadow-sm"
                        : "bg-[var(--paper-lift)] text-[var(--ink)] border-[var(--line)] hover:border-[var(--ink)]"
                    }`}
                  >
                    {selectedText.tail_tip ? "✓ 已开启引线 (拖拽画布红点)" : "+ 开启气泡引线"}
                  </button>
                  {selectedText.tail_tip && (
                    <button
                      type="button"
                      onClick={() => updateSodaText(selectedText.id, { tail_tip: undefined })}
                      className="text-xs text-red-500 hover:underline px-1 font-mono"
                    >
                      移除
                    </button>
                  )}
                </div>
              </div>
            )}

            {selectedText.bbox && (
              <div className="border border-[var(--line)] bg-[var(--paper-lift)] p-2.5 font-mono text-xs text-[var(--ink)]">
                位置: ({selectedText.bbox.x}, {selectedText.bbox.y}) 尺寸: {selectedText.bbox.w}×{selectedText.bbox.h}
              </div>
            )}
          </div>
        ) : selectedOverlay ? (
          /* OVERLAY INSPECTOR */
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--line)] pb-2.5">
              <span className="font-mono text-base font-bold text-[var(--signal)]">
                跨格人物 ({selectedOverlay.id})
              </span>
              <button
                type="button"
                onClick={deleteSelection}
                className="font-mono text-[13px] font-semibold text-[#d93829] hover:underline"
              >
                删除
              </button>
            </div>

            <div>
              <label className="ui-label">人物角色 (Character)</label>
              <CustomSelect
                value={selectedOverlay.character_id}
                options={characters.map((c) => ({ value: c.id, label: c.display_name }))}
                onChange={(val) => updateSodaOverlay(selectedOverlay.id, { character_id: val })}
              />
            </div>

            <div>
              <label className="ui-label">出格动作描述</label>
              <textarea
                rows={3}
                value={selectedOverlay.description}
                onChange={(e) => updateSodaOverlay(selectedOverlay.id, { description: e.target.value })}
                className="ui-textarea text-sm"
              />
            </div>
          </div>
        ) : (
          /* PAGE CHECKLIST & OVERVIEW (P4c Item 8) */
          <div className="space-y-5">
            {/* Checklist Section */}
            <div className="border border-[var(--line)] bg-[var(--paper-lift)] p-3.5 shadow-sm">
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
                <span className="font-bold text-[14px] text-[var(--ink)]">
                  📋 本页检查清单 (Page Checklist)
                </span>
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-[var(--paper-wash)] text-[var(--ink)]">
                  {checklist.length === 0 ? "全部通过" : `${checklist.length} 项待处理`}
                </span>
              </div>

              <div className="mt-3 space-y-2">
                {checklist.length === 0 ? (
                  <div className="p-3 text-center text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200">
                    ✔ 本页所有分镜描述完整、角色齐备，无超长台词与多 LoRA 冲突
                  </div>
                ) : (
                  checklist.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => selectItem({ kind: item.targetKind, id: item.targetId })}
                      className="cursor-pointer border border-amber-300 bg-amber-50/70 p-2.5 text-xs transition hover:bg-amber-100 hover:border-amber-400"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-amber-900 leading-snug">
                          {item.title}
                        </span>
                        <span className="text-xs font-bold text-[var(--signal)] underline shrink-0 ml-2">
                          跳转定位
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Page Overview Section */}
            <div className="space-y-3">
              <div className="border-b border-[var(--line)] pb-2">
                <span className="font-mono text-xs font-bold text-[var(--ink)]">
                  分镜页配置: {sodaPage.id}
                </span>
              </div>

              <div className="space-y-2 text-sm text-[var(--ink)]">
                <div className="flex justify-between border-b border-[var(--line)] py-1.5">
                  <span className="text-[var(--ink-light)] font-medium">画布尺寸</span>
                  <span className="font-mono font-bold">{sodaPage.canvas_width} × {sodaPage.canvas_height}</span>
                </div>
                <div className="flex justify-between border-b border-[var(--line)] py-1.5">
                  <span className="text-[var(--ink-light)] font-medium">阅读方向</span>
                  <span className="font-mono font-semibold">{sodaPage.reading_direction === "rtl" ? "从右往左 (RTL)" : "从左往右"}</span>
                </div>
                <div className="flex justify-between border-b border-[var(--line)] py-1.5">
                  <span className="text-[var(--ink-light)] font-medium">分镜格数</span>
                  <span className="font-mono font-bold text-[var(--signal)]">{sodaPage.panels.length} 格</span>
                </div>
                <div className="flex justify-between border-b border-[var(--line)] py-1.5">
                  <span className="text-[var(--ink-light)] font-medium">台词框数</span>
                  <span className="font-mono font-semibold">{sodaPage.texts.length} 项</span>
                </div>
              </div>

              {sodaPage.style_prompt && (
                <div>
                  <label className="ui-label">画面风格提示词 (Style Prompt)</label>
                  <div className="max-h-36 overflow-y-auto border border-[var(--line)] bg-[var(--paper-lift)] p-2.5 font-mono text-xs text-[var(--ink)] leading-relaxed">
                    {sodaPage.style_prompt}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
