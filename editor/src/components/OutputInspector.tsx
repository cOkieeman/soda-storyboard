import { ArrowLeft, Download, Image, RotateCcw } from "lucide-react";
import { useEditorStore } from "../lib/store";

export default function OutputInspector({ onEdit }: { onEdit: () => void }) {
  const renders = useEditorStore(s => s.renders);
  const current = renders?.renders.find(item => item.path === renders.selected_render);
  const index = renders?.renders.findIndex(item => item.path === renders.selected_render) ?? -1;
  return <aside className="inspector-panel output-inspector" aria-label="出图结果">
    <div className="inspector-heading"><h2>出图结果</h2></div>
    <div className="inspector-content">
      <section className="output-current">
        <span className="output-eyebrow">当前选用</span>
        {current ? <><h3>候选 {String(index + 1).padStart(2, "0")}</h3><p>已作为这一页的出图保存。</p><div className="output-seed"><span>种子</span><code>{current.seed ?? "未记录"}</code></div><a href={current.url} download className="ui-btn"><Download />保存这张图片</a></> : <><Image /><h3>还没有选用出图</h3><p>生成后，从下方候选中选择一张。</p></>}
      </section>
      <section className="output-next"><h3>想改画面或台词？</h3><p>返回分镜修改内容，再生成新候选。已有出图会保留。</p><button className="ui-btn" onClick={onEdit}><ArrowLeft />返回编辑分镜</button><button className="output-regenerate" onClick={() => useEditorStore.getState().openGenerateModal()}><RotateCcw />再生成一组候选</button></section>
    </div>
  </aside>;
}
