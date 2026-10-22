import { useRef } from "react";
export default function WorkspaceResizeHandle({ side, value, onChange }: { side: "left"|"right"; value:number; onChange:(value:number)=>void }) {
  const origin = useRef({x:0,width:0});
  return <div className={`workspace-resizer workspace-resizer-${side}`} role="separator" tabIndex={0} aria-label={side === "left" ? "调整页面面板宽度" : "调整检查器宽度"} aria-orientation="vertical" aria-valuenow={value} aria-valuemin={side === "left" ? 220 : 280} aria-valuemax={side === "left" ? 420 : 520}
    onKeyDown={e=> { if(e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); onChange(value + (e.key === "ArrowRight" ? 16 : -16)*(side === "right" ? -1 : 1)); } }}
    onPointerDown={e=>{ e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); origin.current={x:e.clientX,width:value}; document.body.style.cursor="col-resize"; }}
    onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId)) onChange(origin.current.width + (e.clientX-origin.current.x)*(side === "right" ? -1 : 1));}}
    onPointerUp={e=>{ e.currentTarget.releasePointerCapture(e.pointerId); document.body.style.cursor=""; }} onLostPointerCapture={()=>{document.body.style.cursor="";}} />;
}
