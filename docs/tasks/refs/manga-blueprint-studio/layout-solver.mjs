// Recipe-bank manga layout solver v4. Base geometry is selected first; expressive modifiers are applied afterwards.
import{listLayoutRecipes,buildLayoutRecipe,getLayoutRecipe}from'./layout-recipes.mjs';
import{applyGeometryModifiers}from'./layout-modifiers.mjs';
import{normalizeLayoutSeed}from'./layout-mutator.mjs';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));const area=r=>r.w*r.h;
const targetArea=s=>.10+s*.22;
const dir=v=>{const s=String(v||'').toLowerCase();if(/left|左/.test(s))return'left';if(/right|右/.test(s))return'right';if(/down|下/.test(s))return'down';if(/up|上/.test(s))return'up';return'';};
function directionalSignal(s){const vals=[s.flow?.entry,s.flow?.exit,s.motionDirection,...Object.values(s.gaze||{}),...Object.values(s.motion||{})];return vals.map(dir).filter(Boolean);}
function applyLocks(rects,semantic){return rects.map((r,i)=>{const lock=semantic[i]?.layoutLock;if(!lock)return r;return{x:Number(lock.x),y:Number(lock.y),w:Number(lock.w),h:Number(lock.h),skew:lock.skew||r.skew,locked:true};});}
const has=(set,id)=>set?.has(id);function techniqueSignals(advice=[]){return advice.map(x=>new Set(x?.techniques||[]));}
function normalizedHint(hint='auto'){
  const raw=String(hint||'auto').trim().toLowerCase();
  const aliases={grid:'balanced-grid',balanced:'balanced-grid',vertical:'vertical-rhythm','hero-bottom':'hero-bottom','hero-top':'hero-top',conversation:'dialogue-stagger',action:'action-step',climax:'hero-bottom'};
  return aliases[raw]||raw;
}
function candidateAffinity(candidate,semantic,heroIndex,techniques,readingDirection){
  let score=0;const recipe=candidate.recipe,tags=new Set(recipe.tags||[]),workingArea=candidate.workingArea;
  const energies=semantic.map(s=>s?.importance?.energy??.5),max=Math.max(...energies,.5);
  for(let i=0;i<candidate.rects.length;i++){
    const r=candidate.rects[i],s=semantic[i]||{},e=energies[i]??.5,t=techniques[i]||new Set(),normArea=area(r)/workingArea;
    score-=Math.abs(normArea-targetArea(e))*3;
    if(e===max)score+=normArea*2.15;
    if((s.timing?.hold??.5)>.75)score+=Math.min(r.w,r.h)/Math.sqrt(workingArea)*.42;
    if(/dominant|hero|large|大|climax/i.test(s.size||''))score+=normArea*1.15;
    const ds=directionalSignal(s);if(ds.length){score+=.04*ds.length;if(readingDirection==='rtl'&&ds.includes('left'))score+=.12;if(readingDirection==='ltr'&&ds.includes('right'))score+=.12;}
    if(s.attention?.primary)score+=.08;if(s.layoutLock)score+=.5;
    if(has(t,'hero-panel')&&(tags.has('climax')||tags.has('payoff')||tags.has('entrance')))score+=normArea*.8;
    if(has(t,'small-panel')&&tags.has('detail'))score+=.16;
    if(has(t,'detail-inset')&&tags.has('detail'))score+=.28;
    if((has(t,'pause')||has(t,'negative-space'))&&(tags.has('quiet')||tags.has('emotion')))score+=.24;
    if(has(t,'wide-shot')&&(tags.has('establishing')||tags.has('cinematic')))score+=.2;
    if(has(t,'page-turn-reveal')&&i===semantic.length-1&&(tags.has('reveal')||tags.has('payoff')))score+=.34;
    if((has(t,'scroll-delay')||has(t,'viewport-reveal'))&&(tags.has('cinematic')||tags.has('vertical')))score+=.58;
    if((has(t,'motion-lines')||has(t,'foreshortening')||has(t,'contact-focus'))&&tags.has('action'))score+=.24;
  }
  if(recipe.heroPosition==='last')score+=heroIndex===semantic.length-1?.72:-.18;
  if(recipe.heroPosition==='first')score+=heroIndex===0?.72:-.18;
  if(tags.has('conversation')&&semantic.some(s=>(s.timing?.hold??.5)>.65))score+=.12;
  return score;
}
function scoreCandidate(candidate,semantic,heroIndex,readingDirection,techniques,hint){
  let score=candidateAffinity(candidate,semantic,heroIndex,techniques,readingDirection);
  if(hint!=='auto'&&candidate.recipe.id===hint)score+=2.4;
  else if(hint!=='auto'&&candidate.recipe.family===hint)score+=.65;
  return score;
}
export function solveLayout(semanticPanels,{hint='auto',readingDirection='rtl',directionAdvice=[],medium='print-page',width=1200,height=1697,seed=0,mutation=0}={}){
  if(!semanticPanels.length)return{name:'empty',recipeId:null,rects:[],score:0,candidates:[],signals:{}};
  const baseIndices=semanticPanels.map((panel,index)=>({panel,index})).filter(({panel})=>!panel?.inset).map(x=>x.index),baseSemantic=baseIndices.map(index=>semanticPanels[index]),count=baseSemantic.length||semanticPanels.length;
  const energies=baseSemantic.map(s=>s?.importance?.energy??.5);let hero=0;for(let i=1;i<count;i++)if(energies[i]>energies[hero])hero=i;
  const normalized=normalizedHint(hint),exact=getLayoutRecipe(normalized),available=listLayoutRecipes({panelCount:count});
  const recipes=exact&&count>=exact.minPanels&&count<=exact.maxPanels?[exact,...available.filter(r=>r.id!==exact.id)]:available;
  const workingArea=Math.max(1,(Number(width)-Math.min(width,height)*.09)*(Number(height)-Math.min(width,height)*.09)),baseSeed=normalizeLayoutSeed(seed);
  const raw=recipes.map((recipe,index)=>{
    const candidateSeed=(baseSeed+index*101)>>>0;
    const built=buildLayoutRecipe(recipe.id,{width,height,panelCount:count,seed:candidateSeed,mutation});
    return{name:recipe.id,recipe,recipeId:recipe.id,rects:applyLocks(built.rects,baseSemantic),workingArea,seed:candidateSeed,mutation:Number(mutation)||0};
  });
  const baseAdvice=baseIndices.map(index=>directionAdvice[index]||{}),baseTech=techniqueSignals(baseAdvice);for(const candidate of raw)candidate.score=scoreCandidate(candidate,baseSemantic,hero,readingDirection,baseTech,normalized);
  raw.sort((a,b)=>b.score-a.score||a.recipeId.localeCompare(b.recipeId));
  const winner=raw[0];
  const expanded=[];let baseCursor=0;for(let i=0;i<semanticPanels.length;i++){if(!semanticPanels[i]?.inset){expanded[i]=winner.rects[baseCursor++];continue;}const raw=String(semanticPanels[i].inset||''),m=raw.match(/(?:parent|親)?\s*(?:panel|p|コマ)?\s*(\d+)/i),parentIndex=m?Math.max(0,Number(m[1])-1):Math.max(0,i-1);expanded[i]={...(expanded[parentIndex]||winner.rects[Math.max(0,baseCursor-1)]||winner.rects[0])};}
  const modified=applyGeometryModifiers(expanded,semanticPanels,{directionAdvice,readingDirection}).map(r=>({x:clamp(r.x,0,width),y:clamp(r.y,0,height),w:r.w,h:r.h,skew:r.skew,locked:!!r.locked}));
  return{
    name:winner.recipeId,recipeId:winner.recipeId,rects:modified,score:winner.score,
    candidates:raw.map(c=>({name:c.recipeId,recipeId:c.recipeId,family:c.recipe.family,score:c.score})),
    signals:{heroPanel:(baseIndices[hero]??hero)+1,basePanelCount:count,insetCount:semanticPanels.length-count,medium,recipeId:winner.recipeId,seed:baseSeed,mutation:Number(mutation)||0,techniques:directionAdvice.map(a=>({panel:a.panel,techniques:a.techniques||[]}))}
  };
}
