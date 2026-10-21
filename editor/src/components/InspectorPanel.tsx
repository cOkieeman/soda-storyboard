import React from "react";
import { useEditorStore } from "../lib/store";
import { Figure, ShotType, AngleType, FigurePose, TextKind, BubbleStyle } from "../types";

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

const KIND_OPTIONS: { value: TextKind; label: string }[] = [
  { value: "dialogue", label: "台词 (Dialogue)" },
  { value: "narration", label: "旁白 (Narration)" },
  { value: "sfx", label: "拟声词 (SFX)" },
  { value: "title", label: "标题 (Title)" }
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

  if (!sodaPage) {
    return (
      <aside className="flex h-full items-center justify-center border-l border-[var(--line)] bg-[var(--paper-surface)] p-4 text-xs text-[var(--muted)]">
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
    <aside className="flex h-full flex-col border-l border-[var(--line)] bg-[var(--paper-surface)]">
      {/* Header */}
      <div className="border-b border-[var(--line)] bg-[var(--paper)] px-3.5 py-2.5">
        <span className="font-mono text-xs font-bold tracking-wider text-[var(--ink)]">
          属性面板 / INSPECTOR
        </span>
      </div>

      {/* Top Banner: VALIDATION ISSUES (422 ERRORS / WARNINGS) */}
      {validationIssues.length > 0 && (
        <div className="border-b-2 border-[var(--signal)] bg-[var(--signal-wash)] p-3">
          <div className="flex items-center justify-between font-mono text-xs font-bold text-[var(--signal-deep)]">
            <span>⚠ 发现 {validationIssues.length} 个校验问题</span>
            <span className="text-[10px] uppercase tracking-wide">HTTP 422</span>
          </div>
          <div className="mt-2 space-y-1.5">
            {validationIssues.map((issue, idx) => {
              const isError = issue.severity === "error";
              return (
                <div
                  key={idx}
                  onClick={() => {
                    if (issue.panel_id) {
                      selectItem({ kind: "panel", id: issue.panel_id });
                    }
                  }}
                  className={`cursor-pointer border p-2 text-xs transition ${
                    isError
                      ? "border-[var(--signal)] bg-[#ffffff] text-[var(--signal-deep)]"
                      : "border-[var(--rule)] bg-[var(--paper-lift)] text-[var(--ink)]"
                  }`}
                >
                  <div className="flex items-center justify-between font-mono font-bold">
                    <span>{isError ? "✖ 错误 (Error)" : "▲ 警告 (Warning)"}</span>
                    {issue.panel_id && (
                      <span className="underline text-[var(--signal)]">点击定位 {issue.panel_id}</span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-snug">{issue.message}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {/* PANEL INSPECTOR */}
        {selectedPanel ? (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
              <div>
                <span className="font-mono text-xs font-bold text-[var(--signal)]">
                  格 #{selectedPanel.order}
                </span>
                <span className="ml-2 font-mono text-[11px] text-[var(--muted)]">
                  ID: {selectedPanel.id}
                </span>
              </div>
              <button
                type="button"
                onClick={deleteSelection}
                className="font-mono text-[11px] text-[var(--signal)] hover:underline"
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
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="ui-label">景别 (Shot)</label>
                <select
                  value={selectedPanel.shot}
                  onChange={(e) => updateSodaPanel(selectedPanel.id, { shot: e.target.value })}
                  className="ui-select"
                >
                  {SHOT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="ui-label">视角 (Angle)</label>
                <select
                  value={selectedPanel.angle}
                  onChange={(e) => updateSodaPanel(selectedPanel.id, { angle: e.target.value })}
                  className="ui-select"
                >
                  {ANGLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Characters Involved */}
            <div>
              <label className="ui-label">登场角色 (Characters)</label>
              <div className="flex flex-wrap gap-1.5">
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
                      className={`px-2 py-1 font-mono text-xs font-bold border transition ${
                        isChecked
                          ? "border-[var(--signal)] bg-[var(--signal)] text-[var(--paper-lift)]"
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
                    const newFigure: Figure = {
                      character_id: defaultChar,
                      pose: "stand",
                      position: "center",
                      facing: "front",
                      framing: null
                    };
                    addFigureToPanel(selectedPanel.id, newFigure);
                  }}
                  className="ui-btn ui-btn-sm"
                >
                  + 添加人物
                </button>
              </div>

              <div className="space-y-2">
                {(selectedPanel.figures || []).map((f, idx) => (
                  <div key={idx} className="border border-[var(--line)] bg-[var(--paper-lift)] p-2 space-y-1.5">
                    <div className="flex items-center justify-between border-b border-[var(--line)] pb-1">
                      <span className="font-mono text-[11px] font-bold text-[var(--signal)]">
                        人物 #{idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFigureFromPanel(selectedPanel.id, idx)}
                        className="font-mono text-[10px] text-[var(--muted)] hover:text-[var(--signal)]"
                      >
                        移除
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      <div>
                        <label className="text-[10px] font-mono text-[var(--muted)]">角色</label>
                        <select
                          value={f.character_id}
                          onChange={(e) => updateFigureInPanel(selectedPanel.id, idx, { character_id: e.target.value })}
                          className="ui-select text-xs py-1"
                        >
                          {characters.map((c) => (
                            <option key={c.id} value={c.id}>{c.display_name} ({c.id})</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-mono text-[var(--muted)]">姿势</label>
                        <select
                          value={f.pose}
                          onChange={(e) => updateFigureInPanel(selectedPanel.id, idx, { pose: e.target.value })}
                          className="ui-select text-xs py-1"
                        >
                          {POSE_OPTIONS.map((p) => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1">
                      <div>
                        <label className="text-[10px] font-mono text-[var(--muted)]">位置</label>
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
                          className="ui-input text-xs py-1"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-mono text-[var(--muted)]">朝向</label>
                        <select
                          value={f.facing}
                          onChange={(e) => updateFigureInPanel(selectedPanel.id, idx, { facing: e.target.value as any })}
                          className="ui-select text-xs py-1"
                        >
                          <option value="front">正 (front)</option>
                          <option value="left">左 (left)</option>
                          <option value="right">右 (right)</option>
                          <option value="back">背 (back)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-mono text-[var(--muted)]">景框</label>
                        <select
                          value={f.framing || ""}
                          onChange={(e) => updateFigureInPanel(selectedPanel.id, idx, { framing: e.target.value ? (e.target.value as any) : null })}
                          className="ui-select text-xs py-1"
                        >
                          <option value="">默认 (null)</option>
                          <option value="full">全身 (full)</option>
                          <option value="waist">半身 (waist)</option>
                          <option value="bust">胸部 (bust)</option>
                          <option value="face">面部 (face)</option>
                        </select>
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
                className="ui-textarea"
              />
            </div>

            {/* English Caption */}
            <div>
              <label className="ui-label">英文生成提示词 (Caption EN)</label>
              <textarea
                rows={4}
                value={selectedPanel.caption_en || ""}
                onChange={(e) => updateSodaPanel(selectedPanel.id, { caption_en: e.target.value })}
                placeholder="Top-right panel: inside kitchen..."
                className="ui-textarea font-mono text-xs"
              />
            </div>

            {/* Shape Geometry Info */}
            <div className="border border-[var(--line)] bg-[var(--paper-lift)] p-2 font-mono text-[11px] text-[var(--muted)]">
              <span className="font-bold text-[var(--ink)]">形状几何: </span>
              {selectedPanel.shape.type === "rect" ? (
                <span>
                  Rect ({selectedPanel.shape.x}, {selectedPanel.shape.y}) {selectedPanel.shape.w}×{selectedPanel.shape.h}
                </span>
              ) : (
                <span>Quad 四边形 ({selectedPanel.shape.points?.length || 4} 顶点)</span>
              )}
            </div>
          </div>
        ) : selectedText ? (
          /* TEXT INSPECTOR */
          <div className="space-y-3.5">
            <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
              <div>
                <span className="font-mono text-xs font-bold text-[var(--signal)]">
                  文字框 ({selectedText.id})
                </span>
              </div>
              <button
                type="button"
                onClick={deleteSelection}
                className="font-mono text-[11px] text-[var(--signal)] hover:underline"
              >
                删除文字框
              </button>
            </div>

            <div>
              <label className="ui-label">类型 (Kind)</label>
              <select
                value={selectedText.kind}
                onChange={(e) => updateSodaText(selectedText.id, { kind: e.target.value as any })}
                className="ui-select"
              >
                {KIND_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="ui-label">原文文本 (Text)</label>
              <textarea
                rows={4}
                value={selectedText.text || ""}
                onChange={(e) => updateSodaText(selectedText.id, { text: e.target.value })}
                placeholder="输入台词，可换行"
                className="ui-textarea"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="ui-label">说话人 (Speaker)</label>
                <select
                  value={selectedText.speaker_id || ""}
                  onChange={(e) => updateSodaText(selectedText.id, { speaker_id: e.target.value || null })}
                  className="ui-select"
                >
                  <option value="">无 (旁白/拟声)</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>{c.display_name} ({c.id})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="ui-label">方向 (Direction)</label>
                <select
                  value={selectedText.direction || "vertical"}
                  onChange={(e) => updateSodaText(selectedText.id, { direction: e.target.value as any })}
                  className="ui-select"
                >
                  <option value="vertical">竖排 (Vertical)</option>
                  <option value="horizontal">横排 (Horizontal)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="ui-label">气泡样式 (Bubble Style)</label>
              <select
                value={selectedText.bubble || "speech"}
                onChange={(e) => updateSodaText(selectedText.id, { bubble: e.target.value as any })}
                className="ui-select"
              >
                {BUBBLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {selectedText.bbox && (
              <div className="border border-[var(--line)] bg-[var(--paper-lift)] p-2 font-mono text-[11px] text-[var(--muted)]">
                位置: ({selectedText.bbox.x}, {selectedText.bbox.y}) 尺寸: {selectedText.bbox.w}×{selectedText.bbox.h}
              </div>
            )}
          </div>
        ) : selectedOverlay ? (
          /* OVERLAY INSPECTOR */
          <div className="space-y-3.5">
            <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
              <span className="font-mono text-xs font-bold text-[var(--signal)]">
                跨格人物 ({selectedOverlay.id})
              </span>
              <button
                type="button"
                onClick={deleteSelection}
                className="font-mono text-[11px] text-[var(--signal)] hover:underline"
              >
                删除
              </button>
            </div>

            <div>
              <label className="ui-label">人物角色 (Character)</label>
              <select
                value={selectedOverlay.character_id}
                onChange={(e) => updateSodaOverlay(selectedOverlay.id, { character_id: e.target.value })}
                className="ui-select"
              >
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>{c.display_name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="ui-label">出格动作描述</label>
              <textarea
                rows={3}
                value={selectedOverlay.description}
                onChange={(e) => updateSodaOverlay(selectedOverlay.id, { description: e.target.value })}
                className="ui-textarea"
              />
            </div>
          </div>
        ) : (
          /* PAGE OVERVIEW */
          <div className="space-y-3.5">
            <div className="border-b border-[var(--line)] pb-2">
              <span className="font-mono text-xs font-bold text-[var(--ink)]">
                当前分镜页: {sodaPage.id}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between border-b border-[var(--line)] py-1">
                <span className="text-[var(--muted)]">画布尺寸</span>
                <span className="font-mono font-bold">{sodaPage.canvas_width} × {sodaPage.canvas_height}</span>
              </div>
              <div className="flex justify-between border-b border-[var(--line)] py-1">
                <span className="text-[var(--muted)]">阅读方向</span>
                <span className="font-mono">{sodaPage.reading_direction === "rtl" ? "从右往左 (RTL)" : "从左往右"}</span>
              </div>
              <div className="flex justify-between border-b border-[var(--line)] py-1">
                <span className="text-[var(--muted)]">格子间距</span>
                <span className="font-mono">{sodaPage.panel_gap} px</span>
              </div>
              <div className="flex justify-between border-b border-[var(--line)] py-1">
                <span className="text-[var(--muted)]">分镜格数</span>
                <span className="font-mono font-bold text-[var(--signal)]">{sodaPage.panels.length} 格</span>
              </div>
              <div className="flex justify-between border-b border-[var(--line)] py-1">
                <span className="text-[var(--muted)]">文字框数</span>
                <span className="font-mono">{sodaPage.texts.length} 项</span>
              </div>
            </div>

            {sodaPage.style_prompt && (
              <div>
                <label className="ui-label">画面风格 (Style Prompt)</label>
                <div className="max-h-36 overflow-y-auto border border-[var(--line)] bg-[var(--paper-lift)] p-2 font-mono text-[11px] text-[var(--muted)] leading-relaxed">
                  {sodaPage.style_prompt}
                </div>
              </div>
            )}

            {sodaPage.tags && sodaPage.tags.length > 0 && (
              <div>
                <label className="ui-label">标签 (Tags)</label>
                <div className="flex flex-wrap gap-1">
                  {sodaPage.tags.map((t, idx) => (
                    <span key={idx} className="border border-[var(--line)] bg-[var(--paper-lift)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--muted)]">
                      #{t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
