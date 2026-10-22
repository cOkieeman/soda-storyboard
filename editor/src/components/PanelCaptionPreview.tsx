import { useEffect, useState } from "react";
import { previewPanelCaptions, type PanelCaptionPreview as CaptionResult } from "../lib/api";
import type { SodaPage, SodaPanel } from "../types";

type PreviewState = { source: SodaPage; panelId: string; result?: CaptionResult; error?: string };

export function usesCustomCaption(panel: SodaPanel, page: SodaPage): boolean {
  return Boolean((panel.use_custom_caption || page.legacy_caption_en) && panel.caption_en?.trim());
}

export function captionSourceKey(item: SodaPanel): string {
  // Position, size and absolute child boxes do not change the translated semantics.
  const figures = item.figures?.map(figure => ({ character_id: figure.character_id, pose: figure.pose, facing: figure.facing, framing: figure.framing,
    editor: figure.editor ? { joints: figure.editor.joints, view: figure.editor.view, flip: figure.editor.flip } : undefined }));
  return JSON.stringify([item.description, item.shot, item.angle, figures, item.character_ids, item.props, item.atmosphere]);
}

export default function PanelCaptionPreview({ page, panel }: { page: SodaPage; panel: SodaPanel }) {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const timer = setTimeout(() => {
      void previewPanelCaptions(page.id, page, controller.signal).then(panels => {
        if (!current) return;
        const result = panels.find(item => item.panel_id === panel.id);
        setPreview({ source: page, panelId: panel.id, result, error: result ? undefined : "这一格尚无提示词预览" });
      }).catch(error => {
        if (current && !controller.signal.aborted) setPreview({ source: page, panelId: panel.id, error: error.message || "提示词预览暂时不可用" });
      });
    }, 250);
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [page, panel.id]);

  const current = preview?.source === page && preview.panelId === panel.id ? preview : null;
  const overridden = current?.result?.custom_override ?? usesCustomCaption(panel, page);
  const priorPanel = preview?.source.panels.find(item => item.id === panel.id);
  const editedChinese = priorPanel && captionSourceKey(priorPanel) !== captionSourceKey(panel);
  const sameSource = priorPanel && !editedChinese ? preview?.result : undefined;
  const translation = current?.result?.translation_status ?? sameSource?.translation_status ?? (panel.caption_auto_en?.text ? editedChinese ? "stale" : "checking" : "missing");
  const statusLabel = { fresh: "新鲜", stale: "过期", missing: "缺失", checking: "核对中", preserved: "导入原文保留" }[translation];
  const language = (current?.result?.language ?? sameSource?.language) === "en" ? "英文" : overridden ? "手动覆盖" : "中文";
  return <div className="caption-preview" aria-busy={!current}>
    <p className="text-[12px] leading-relaxed" role="status">当前出图语言：{language} · 英文译文：{statusLabel}</p>
    {overridden && <p className="caption-override-badge" role="status">自定义提示词覆盖生效</p>}
    {current?.result?.warnings?.map(warning => <p key={warning.code + warning.message} className="caption-override-badge" role="alert">{warning.message}</p>)}
    <textarea className="ui-textarea caption-preview-text" aria-label="最终提示词预览" readOnly rows={6} value={current?.result?.caption ?? ""} placeholder={current?.error || "正在编译当前修改…"} />
    <p className="text-[12px] leading-relaxed text-[var(--ink-light)]" role={current?.error ? "alert" : undefined}>{current?.error || (overridden ? "覆盖本格场景提示词；人物位置与姿势仍按编辑器编译，手写内容应与人物保持一致。" : "由当前画面描述、镜头和人物信息编译，修改后自动更新。")}</p>
  </div>;
}
