import { useEffect, useState } from "react";
import { ArrowLeft, Columns2, Download, Image, RotateCcw } from "lucide-react";
import { useEditorStore } from "../lib/store";
import CandidateReview from "./CandidateReview";

export default function OutputInspector({ onEdit }: { onEdit: () => void }) {
  const renders = useEditorStore(s => s.renders);
  const activePageId = useEditorStore(s => s.activePageId);
  const pickRender = useEditorStore(s => s.pickRender);
  const [reviewPath, setReviewPath] = useState<string | null>(null);
  useEffect(() => { setReviewPath(null); }, [activePageId]);
  const current = renders?.renders.find(item => item.path === renders.selected_render);
  const index = renders?.renders.findIndex(item => item.path === renders.selected_render) ?? -1;
  return <aside className="inspector-panel output-inspector" aria-label="出图结果">
    <div className="inspector-heading"><h2>出图结果</h2></div>
    <div className="inspector-content">
      <section className="output-current">
        <span className="output-eyebrow">项目已选用</span>
        {current ? <><h3>候选 {String(index + 1).padStart(2, "0")}</h3><p>已作为这一页的出图保存。</p><div className="output-seed"><span>种子</span><code>{current.seed ?? "未记录"}</code></div><a href={current.url} download className="ui-btn"><Download />保存这张图片</a></> : <><Image /><h3>还没有选用出图</h3><p>生成后，从下方候选中选择一张。</p></>}
      </section>
      {Boolean(renders?.renders.length) && <section className="output-next"><h3>查看与比较</h3><p>预览其他候选不会更改这一页的选用结果。</p><button className="ui-btn" onClick={() => setReviewPath(current?.path || renders!.renders[0].path)}><Columns2 />预览 / A/B 比较</button></section>}
      <section className="output-next"><h3>想改画面或台词？</h3><p>返回分镜修改内容，再生成新候选。已有出图会保留。</p><button className="ui-btn" onClick={onEdit}><ArrowLeft />返回编辑分镜</button><button className="output-regenerate" onClick={() => useEditorStore.getState().openGenerateModal()}><RotateCcw />再生成一组候选</button></section>
    </div>
    {reviewPath && renders && <CandidateReview key={`${activePageId}:${reviewPath}`} items={renders.renders} initialPath={reviewPath} savedPath={renders.selected_render} onClose={() => setReviewPath(null)} onPick={pickRender} />}
  </aside>;
}
