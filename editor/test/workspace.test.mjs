import test from 'node:test';
import assert from 'node:assert/strict';
import { anchoredPan, readViewport, saveViewport, readWorkspace, saveWorkspace, resetWorkspacePreferences } from '../src/lib/workspace.ts';
test('pointer anchored zoom preserves page coordinates with centered paper and existing pan', ()=>{
  const point={x:317,y:213},center={x:530,y:380},pan={x:82,y:-64};
  for(const zoom of [.05,.32,1,2.5]) {
    const next=anchoredPan(pan,point,center,.4,zoom);
    assert.ok(Math.abs((point.x-center.x-next.x)/zoom-(point.x-center.x-pan.x)/.4)<1e-9);
    assert.ok(Math.abs((point.y-center.y-next.y)/zoom-(point.y-center.y-pan.y)/.4)<1e-9);
  }
});
test('workspace preferences validate corrupt data and reset only their own keys',()=>{
  const map=new Map([['other-app','keep']]);
  globalThis.localStorage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),get length(){return map.size;},key:i=>[...map.keys()][i]??null};
  saveWorkspace({sidebarOpen:true,inspectorOpen:false,sidebarWidth:9999,inspectorWidth:NaN});
  assert.equal(readWorkspace().sidebarWidth,420);assert.equal(readWorkspace().inspectorWidth,340);
  saveViewport('page',{zoom:.5,pan:{x:22,y:18},fit:false});assert.equal(readViewport('page').pan.x,22);
  saveViewport('bad',{zoom:NaN,pan:{x:0,y:0},fit:false});assert.equal(readViewport('bad'),null);
  resetWorkspacePreferences();assert.equal(map.get('other-app'),'keep');assert.equal(map.size,1);
  delete globalThis.localStorage;
});
