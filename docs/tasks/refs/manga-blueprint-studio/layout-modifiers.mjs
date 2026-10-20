const lower=v=>String(v||'').trim().toLowerCase();
export function normalizeBleed(value=''){
  const v=lower(value);if(!v||/none|なし/.test(v))return'none';if(/all|全面|全周/.test(v))return'all';if(/top|上/.test(v))return'top';if(/right|右/.test(v))return'right';if(/bottom|下/.test(v))return'bottom';if(/left|左/.test(v))return'left';return'none';
}
export function normalizeBreakout(value=''){
  const v=lower(value);if(!v||/none|なし/.test(v))return'none';if(/cross|跨|またぎ/.test(v))return'cross-panel';if(/foreground|前景/.test(v))return'foreground';if(/character|人物|キャラ/.test(v))return'character';return'none';
}
export function applyGeometryModifiers(rects,semanticPanels,{directionAdvice=[],readingDirection='rtl'}={}){
  return rects.map((rect,index)=>{
    const semantic=semanticPanels[index]||{},advice=directionAdvice[index]||{},techniques=new Set(advice.techniques||[]);
    if(semantic.layoutLock)return rect;
    const explicit=String(semantic.shape||'rectangle').toLowerCase();
    if(explicit!=='rectangle'&&explicit!=='auto')return rect;
    const wantsDiagonal=techniques.has('diagonal-panel')||((techniques.has('motion-lines')||techniques.has('foreshortening'))&&(semantic.importance?.energy??.5)>.68);
    if(!wantsDiagonal)return rect;
    const rtl=readingDirection!=='ltr',even=index%2===0;
    return{...rect,skew:(rtl?even:!even)?'diagonal-right':'diagonal-left'};
  });
}
