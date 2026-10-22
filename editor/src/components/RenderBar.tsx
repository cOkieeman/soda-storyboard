import React, { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronUp, Images, LoaderCircle, X } from "lucide-react";
import { useEditorStore } from "../lib/store";
import { RenderItem } from "../types";
import type { CanvasMode } from "./CanvasEditor";
import CandidateReview from "./CandidateReview";

function renderTime(item: RenderItem): string {
  const recorded = item.meta?.created_at;
  const raw = typeof recorded === "string"
    ? recorded
    : item.path.match(/(\d{8}T\d{6}\d*Z)_/)?.[1];
  if (!raw) return "未记录时间";
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d*)Z$/.exec(raw);
  const iso = compact
    ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}.${compact[7].padEnd(3, "0").slice(0, 3)}Z`
    : raw;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  });
}

const jobLabels = {
  queued: "排队中",
  running: "出图中",
  completed: "出图完成",
  failed: "出图失败",
  cancelled: "已取消"
};

export default function RenderBar({ mode = "draft", onViewArtwork }: { mode?: CanvasMode; onViewArtwork?: () => void }) {
  const renders = useEditorStore((state) => state.renders);
  const activePageId = useEditorStore((state) => state.activePageId);
  const activeJob = useEditorStore((state) => state.activeJob);
  const pickRender = useEditorStore((state) => state.pickRender);
  const cancelJob = useEditorStore((state) => state.cancelJob);
  const renderList = renders?.renders || [];
  const [isExpanded, setIsExpanded] = useState(mode === "artwork");
  const [reviewPath, setReviewPath] = useState<string | null>(null);

  useEffect(() => {
    setIsExpanded(mode === "artwork");
  }, [mode]);
  useEffect(() => { setReviewPath(null); }, [activePageId]);

  const jobIsActive = activeJob?.status === "queued" || activeJob?.status === "running";
  const jobMessage = activeJob?.error || activeJob?.message || activeJob?.progress?.message;

  return (
    <footer className={`render-tray ${isExpanded ? "is-expanded" : "is-collapsed"}`}>
      <div className="tray-header">
        <button
          type="button"
          className="tray-toggle"
          onClick={() => { if (mode === "draft" && onViewArtwork) onViewArtwork(); else setIsExpanded((expanded) => !expanded); }}
          aria-expanded={isExpanded}
          aria-controls="render-candidates"
          title={isExpanded ? "收起出图候选" : "展开出图候选"}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          <Images size={15} />
          <span>{mode === "draft" ? "已有出图" : "出图候选"}</span>
          <span className="tray-count">{renderList.length}</span>
        </button>
        <span className="tray-hint">{mode === "draft" ? renderList.length ? "预览和比较已有结果" : "填写分镜后，点击右上角“生成出图”" : "点击仅预览；在预览中确认选用"}</span>
        {activeJob && (
          <div className={`tray-job job-${activeJob.status}`} role="status" title={jobMessage}>
            {jobIsActive && <LoaderCircle size={14} className="is-spinning" />}
            <span className="tray-job-label">{jobLabels[activeJob.status]}</span>
            {jobMessage && <span className="tray-job-message">{jobMessage}</span>}
            {jobIsActive && (
              <button type="button" className="tray-job-cancel" onClick={() => cancelJob(activeJob.id)} title="取消后台任务" aria-label="取消后台任务">
                <X size={14} />
              </button>
            )}
          </div>
        )}
      </div>
      {isExpanded && (
        <div id="render-candidates" className="render-list" aria-label="出图候选列表">
          {renderList.length === 0 ? (
            <div className="tray-empty"><Images size={24} /><span>还没有候选图，使用右上角“生成出图”开始。</span></div>
          ) : renderList.map((item, index) => {
            const isSelected = item.path === renders?.selected_render;
            const number = String(index + 1).padStart(2, "0");
            const details = `预览候选 ${number}${isSelected ? " · 项目已选用" : " · 仅预览"}\n种子：${item.seed ?? "未记录"}\n时间：${renderTime(item)}`;
            return (
              <button
                key={item.path}
                type="button"
                className={`render-candidate${isSelected ? " is-selected" : ""}`}
                onClick={() => { setReviewPath(item.path); }}
                aria-pressed={isSelected}
                aria-label={details}
                title={details}
              >
                <img className="render-thumbnail" src={item.url} alt={`出图候选 ${number}`} loading="lazy" />
                <span className="render-index">{number}</span>
                {isSelected && <span className="render-selected"><Check size={12} /><span>已选用</span></span>}
              </button>
            );
          })}
        </div>
      )}
      {reviewPath && renderList.length > 0 && <CandidateReview key={`${activePageId}:${reviewPath}`} items={renderList} initialPath={reviewPath} savedPath={renders?.selected_render || null} onClose={() => setReviewPath(null)} onPick={pickRender} />}
    </footer>
  );
}
