import{createLayoutRandom,varyRatio,varyWeights,clampLayout}from'./layout-mutator.mjs';

export const LAYOUT_RECIPE_VERSION=1;
export const LAYOUT_RECIPES=Object.freeze([
  {id:'balanced-grid',ja:'均整グリッド',en:'Balanced grid',family:'standard',minPanels:1,maxPanels:6,tags:['standard','conversation'],helpJa:'最も素直な段組み。会話・日常・説明の基準点。',helpEn:'A neutral baseline for dialogue, daily scenes, and exposition.'},
  {id:'vertical-rhythm',ja:'縦リズム',en:'Vertical rhythm',family:'standard',minPanels:2,maxPanels:6,tags:['conversation','quiet'],helpJa:'全幅コマを縦に積み、時間を順番に読ませる。',helpEn:'Full-width bands for linear time and quiet progression.'},
  {id:'horizontal-rhythm',ja:'横連続',en:'Horizontal rhythm',family:'standard',minPanels:2,maxPanels:4,tags:['sequence','comparison'],helpJa:'横方向に連続する比較・動作向け。',helpEn:'Side-by-side beats for comparison or sequential motion.'},
  {id:'hero-bottom',ja:'下段大ゴマ',en:'Hero bottom',family:'payoff',minPanels:2,maxPanels:6,tags:['climax','reveal','payoff'],heroPosition:'last',helpJa:'上で溜め、最後の下段を大きく見せる。',helpEn:'Build above and release into a large final panel.'},
  {id:'hero-top',ja:'上段大ゴマ',en:'Hero top',family:'entry',minPanels:2,maxPanels:6,tags:['entrance','establishing','impact'],heroPosition:'first',helpJa:'最初の大ゴマで場所・登場・衝撃を固定する。',helpEn:'Open with a large establishing or impact panel.'},
  {id:'hero-right',ja:'右大ゴマ＋左積み',en:'Hero right + stack',family:'entry',minPanels:2,maxPanels:5,tags:['entrance','portrait','dialogue'],heroPosition:'first',helpJa:'右の大きな導入から左側の反応へ流す。',helpEn:'A tall opening panel on the right with supporting beats stacked left.'},
  {id:'dialogue-stagger',ja:'会話段違い',en:'Dialogue stagger',family:'conversation',minPanels:3,maxPanels:6,tags:['conversation','reaction'],helpJa:'左右幅を交互に変え、切り返しと反応に大小差を付ける。',helpEn:'Alternating widths create conversational shot/reaction contrast.'},
  {id:'action-step',ja:'アクション段階',en:'Action step',family:'action',minPanels:3,maxPanels:6,tags:['action','acceleration','payoff'],heroPosition:'last',helpJa:'小→中→大へ面積を段階的に増やして加速する。',helpEn:'Escalates panel area toward the final action beat.'},
  {id:'detail-payoff',ja:'ディテール→見せ場',en:'Detail to payoff',family:'payoff',minPanels:3,maxPanels:6,tags:['detail','reveal','climax'],heroPosition:'last',helpJa:'細部を刻んでから最後の見せ場へ解放する。',helpEn:'Stacks detail beats before a large payoff.'},
  {id:'quiet-build',ja:'静かな積み上げ',en:'Quiet build',family:'quiet',minPanels:3,maxPanels:6,tags:['quiet','emotion','hold'],heroPosition:'last',helpJa:'小さな差を積み、最後だけ少し広くして余韻を作る。',helpEn:'Subtle progression with a gently expanded final beat.'},
  {id:'wide-middle',ja:'中央ワイド',en:'Wide middle',family:'transition',minPanels:3,maxPanels:5,tags:['transition','establishing','action'],helpJa:'中央の横長コマを橋にして前後の意味をつなぐ。',helpEn:'A wide middle beat bridges setup and reaction.'},
  {id:'ladder',ja:'階段リズム',en:'Ladder rhythm',family:'action',minPanels:4,maxPanels:6,tags:['action','tempo','asymmetry'],helpJa:'段ごとに左右比率を反転させ、視線を階段状に送る。',helpEn:'Alternating row splits create a stepped reading rhythm.'},
  {id:'three-band',ja:'三段構成',en:'Three-band composition',family:'standard',minPanels:3,maxPanels:6,tags:['story','balanced','rhythm'],helpJa:'上・中・下の三段に役割を分ける汎用構成。',helpEn:'A flexible three-band page for setup, development, and landing.'},
  {id:'cinematic-stack',ja:'シネマ縦積み',en:'Cinematic stack',family:'cinematic',minPanels:2,maxPanels:6,tags:['cinematic','emotion','vertical'],helpJa:'高さに強弱を付けた全幅コマで映画的に呼吸させる。',helpEn:'Full-width bands with varied heights for cinematic pacing.'}
]);

const byId=new Map(LAYOUT_RECIPES.map(recipe=>[recipe.id,recipe]));
export function getLayoutRecipe(id){return byId.get(String(id||''))||null;}
export function listLayoutRecipes({panelCount=null,family=null,tag=null}={}){
  return LAYOUT_RECIPES.filter(recipe=>(!panelCount||(panelCount>=recipe.minPanels&&panelCount<=recipe.maxPanels))&&(!family||recipe.family===family)&&(!tag||recipe.tags.includes(tag)));
}
export function layoutRecipeCount(){return LAYOUT_RECIPES.reduce((sum,r)=>sum+(r.maxPanels-r.minPanels+1),0);}

function metrics(width,height){
  const min=Math.min(width,height),margin=Math.round(clampLayout(min*.045,20,58)),gutter=Math.round(clampLayout(min*.02,12,30));
  return{margin,gutter,innerW:width-margin*2,innerH:height-margin*2};
}
function balancedRows(count){
  if(count<=1)return[1];if(count===2)return[2];if(count===3)return[2,1];if(count===4)return[2,2];if(count===5)return[2,2,1];return[2,2,2];
}
function distribute(total,gaps,weights){
  const usable=total-gaps,den=weights.reduce((a,b)=>a+b,0)||1;
  return weights.map(w=>usable*w/den);
}
function rowRects({x,y,w,h,count,gutter,rng,strength,bias=.5}){
  if(count===1)return[{x,y,w,h}];
  if(count===2){
    const rightRatio=varyRatio(bias,rng,strength,{min:.30,max:.70,span:.18}),usable=w-gutter,rightW=usable*rightRatio,leftW=usable-rightW;
    return[{x:x+leftW+gutter,y,w:rightW,h},{x,y,w:leftW,h}];
  }
  const weights=varyWeights(Array(count).fill(1),rng,strength,{min:.65,span:.18}),widths=distribute(w,gutter*(count-1),weights),out=[];let cursor=x+w;
  for(let i=0;i<count;i++){cursor-=widths[i];out.push({x:cursor,y,w:widths[i],h});cursor-=gutter;}
  return out;
}
function rowsLayout(width,height,rowCounts,{seed=0,mutation=0,heightWeights=null,rowBiases=[]}={}){
  const {margin,gutter,innerW,innerH}=metrics(width,height),rng=createLayoutRandom(seed),weights=varyWeights(heightWeights||rowCounts.map(()=>1),rng,mutation,{min:.45,span:.20}),heights=distribute(innerH,gutter*(rowCounts.length-1),weights),out=[];let y=margin;
  rowCounts.forEach((count,index)=>{out.push(...rowRects({x:margin,y,w:innerW,h:heights[index],count,gutter,rng,strength:mutation,bias:rowBiases[index]??.5}));y+=heights[index]+gutter;});
  return out;
}
function heroBottom(width,height,count,opts,strong=true){
  const rows=balancedRows(count-1);rows.push(1);const weights=rows.map((_,i)=>i===rows.length-1?(strong?1.9:1.35):1);
  return rowsLayout(width,height,rows,{...opts,heightWeights:weights});
}
function heroTop(width,height,count,opts){
  const rows=[1,...balancedRows(count-1)],weights=rows.map((_,i)=>i===0?1.75:1);
  return rowsLayout(width,height,rows,{...opts,heightWeights:weights});
}
function heroRight(width,height,count,{seed=0,mutation=0}={}){
  const {margin,gutter,innerW,innerH}=metrics(width,height),rng=createLayoutRandom(seed),rightRatio=varyRatio(.55,rng,mutation,{min:.44,max:.68,span:.12}),usable=innerW-gutter,rightW=usable*rightRatio,leftW=usable-rightW;
  const hero={x:margin+leftW+gutter,y:margin,w:rightW,h:innerH},rest=rowRects({x:margin,y:margin,w:leftW,h:innerH,count:count-1,gutter,rng,strength:mutation,bias:.5});
  if(count-1===1)return[hero,rest[0]];
  const heights=distribute(innerH,gutter*(count-2),varyWeights(Array(count-1).fill(1),rng,mutation,{min:.65,span:.18})),stack=[];let y=margin;
  for(let i=0;i<count-1;i++){stack.push({x:margin,y,w:leftW,h:heights[i]});y+=heights[i]+gutter;}
  return[hero,...stack];
}
function dialogueStagger(width,height,count,opts){
  const rows=balancedRows(count),biases=rows.map((n,i)=>n===2?(i%2===0?.60:.40):.5);
  return rowsLayout(width,height,rows,{...opts,rowBiases:biases,heightWeights:rows.map((_,i)=>i===0?1.05:1)});
}
function actionStep(width,height,count,opts){
  const rows=balancedRows(count-1);rows.push(1);const weights=rows.map((_,i)=>.75+i*(1.05/Math.max(1,rows.length-1)));
  return rowsLayout(width,height,rows,{...opts,heightWeights:weights,rowBiases:rows.map((n,i)=>n===2?(i%2?.40:.60):.5)});
}
function wideMiddle(width,height,count,opts){
  if(count===3)return rowsLayout(width,height,[1,1,1],{...opts,heightWeights:[.8,1.45,.8]});
  const top=Math.ceil((count-1)/2),bottom=count-1-top;
  const rows=[top,1,...(bottom?[bottom]:[])];return rowsLayout(width,height,rows,{...opts,heightWeights:rows.map((_,i)=>i===1?1.45:1)});
}
function ladder(width,height,count,opts){
  const rows=balancedRows(count),biases=rows.map((n,i)=>n===2?(i%2===0?.66:.34):.5);
  return rowsLayout(width,height,rows,{...opts,rowBiases:biases});
}
function threeBand(width,height,count,opts){
  if(count===3)return rowsLayout(width,height,[1,1,1],{...opts,heightWeights:[.9,1.2,.9]});
  const a=Math.ceil(count/3),b=Math.ceil((count-a)/2),c=count-a-b;
  return rowsLayout(width,height,[a,b,c].filter(Boolean),{...opts,heightWeights:[.9,1.15,1]});
}
function cinematicStack(width,height,count,opts){
  const weights=Array.from({length:count},(_,i)=>i===Math.floor(count/2)?1.45:(i%2?.85:1.05));
  return rowsLayout(width,height,Array(count).fill(1),{...opts,heightWeights:weights});
}
function horizontal(width,height,count,opts){
  return rowsLayout(width,height,[count],opts);
}
function build(recipe,width,height,count,opts){
  switch(recipe.id){
    case'balanced-grid':return rowsLayout(width,height,balancedRows(count),opts);
    case'vertical-rhythm':return rowsLayout(width,height,Array(count).fill(1),opts);
    case'horizontal-rhythm':return horizontal(width,height,count,opts);
    case'hero-bottom':return heroBottom(width,height,count,opts,true);
    case'hero-top':return heroTop(width,height,count,opts);
    case'hero-right':return heroRight(width,height,count,opts);
    case'dialogue-stagger':return dialogueStagger(width,height,count,opts);
    case'action-step':return actionStep(width,height,count,opts);
    case'detail-payoff':return heroBottom(width,height,count,opts,true);
    case'quiet-build':return heroBottom(width,height,count,opts,false);
    case'wide-middle':return wideMiddle(width,height,count,opts);
    case'ladder':return ladder(width,height,count,opts);
    case'three-band':return threeBand(width,height,count,opts);
    case'cinematic-stack':return cinematicStack(width,height,count,opts);
    default:return rowsLayout(width,height,balancedRows(count),opts);
  }
}
export function buildLayoutRecipe(id,{width=1200,height=1697,panelCount=4,seed=0,mutation=0}={}){
  const recipe=getLayoutRecipe(id);if(!recipe)throw new Error(`Unknown layout recipe: ${id}`);
  const count=Math.trunc(Number(panelCount));if(count<recipe.minPanels||count>recipe.maxPanels)throw new Error(`Recipe ${id} supports ${recipe.minPanels}-${recipe.maxPanels} panels, got ${count}`);
  const rects=build(recipe,Number(width),Number(height),count,{seed,mutation:clampLayout(Number(mutation)||0,0,1)});
  return{recipe,rects,settings:{recipeId:recipe.id,panelCount:count,seed,mutation:clampLayout(Number(mutation)||0,0,1)}};
}
export function layoutSettingsSnippet({recipeId,panelCount=4,seed=0,mutation=0}){
  return[`@layout: ${recipeId}`,`@layout-seed: ${seed}`,`@layout-mutation: ${Number(mutation).toFixed(2)}`,`# panels: ${panelCount}`].join('\n');
}
