import test from 'node:test';
import assert from 'node:assert/strict';
import {closureGate,makeCorridors,positionM} from '../dist/spatial.js';
import {closedNetworkSpans} from '../dist/closure-network.js';
import {networkData} from '../dist/geodata.js';
import {extensionJunctions} from '../dist/network-extensions.js';
import {junctionAccess} from '../dist/road-controls.js';

function route(key,points){
 const metres=[0];let sum=0;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i];
  sum+=Math.hypot((b[1]-a[1])*111195*Math.cos(a[0]*Math.PI/180),(b[0]-a[0])*111195);
  metres.push(sum);
 }
 return {key,points,metres,lengthM:sum};
}
const selected='extra-a4-aachen',open='extra-a4-olpe';
const main=route(selected,[[50,7],[50,7.015],[50,7.03],[50,7.045]]);
const branch=route(open,[[50,7.015],[50.003,7.017]]);
const toAachen=route('ramp-into-aachen',[[50.002,7.017],[50,7.019]]);
const awayToOpen=route('ramp-to-open',[[50,7.019],[50.003,7.017]]);
const before=route('ramp-before-closure',[[50.002,7.006],[50,7.007]]);
const other=route('ramp-into-other',[[50.003,7.017],[50.004,7.019]]);
const localInside=route('ramp-to-local-inside',[[50,7.021],[50.001,7.022]]);
const lastExit=route('ramp-last-open-exit',[[50,7.015],[50.001,7.016]]);
const routes=Object.fromEntries([main,branch,toAachen,awayToOpen,before,other,localInside,lastExit].map(r=>[r.key,r]));
const exits=[{road:'A4',ref:'915',name:'AD Köln-Heumar',position:main.points[1],source:'test'},
 {road:'A4',ref:'916',name:'AK Köln-Süd',position:main.points[2],source:'test'}];
const pos=main.metres;
const event={id:'closed-aachen',kind:'closure',pathKey:selected,point:[50,7.018],
 laneCount:3,closedLanes:[0,1,2],createdAt:'2026-11-06T00:00:00Z',
 settings:{lengthM:400,speedKmh:0,shoulder:'blocked'}};
const links=[
 {rampId:toAachen.key,from:open,to:selected,rampEntryM:0,downstreamMergeM:pos[1]+150,sourceGapM:0,mergeGapM:0},
 {rampId:awayToOpen.key,from:selected,to:open,rampEntryM:pos[1]+150,downstreamMergeM:50,sourceGapM:0,mergeGapM:0},
 {rampId:before.key,from:open,to:selected,rampEntryM:0,downstreamMergeM:pos[0]+200,sourceGapM:0,mergeGapM:0},
 {rampId:other.key,from:selected,to:open,rampEntryM:pos[1]+150,downstreamMergeM:100,sourceGapM:0,mergeGapM:0},
 {rampId:localInside.key,from:selected,to:localInside.key,rampEntryM:pos[1]+220,downstreamMergeM:0,sourceGapM:0,mergeGapM:0},
 {rampId:lastExit.key,from:selected,to:lastExit.key,rampEntryM:pos[1],downstreamMergeM:0,sourceGapM:0,mergeGapM:0}
];
test('closure spans the last usable exit through the next end exit, not a 400m marker only',()=>{
 const gate=closureGate(main,event,exits,[event]);
 assert.equal(gate.exit.ref,'915');
 assert.equal(gate.endExit.ref,'916');
 const spans=closedNetworkSpans([event],routes,exits,links);
 const primary=spans.find(x=>x.pathKey===selected);
 assert.equal(primary.fromM,gate.metre);
 assert.equal(primary.toM,gate.endM);
 assert.ok(primary.toM-primary.fromM>event.settings.lengthM);
});
test('Heumar-direction closure blocks only entry toward Aachen; open outgoing autobahn arms survive',()=>{
 const spans=closedNetworkSpans([event],routes,exits,links);
 assert.ok(spans.some(s=>s.pathKey===toAachen.key&&s.source==='interchange-entry'));
 assert.ok(!spans.some(s=>s.pathKey===awayToOpen.key));
 assert.ok(!spans.some(s=>s.pathKey===before.key));
 assert.ok(!spans.some(s=>s.pathKey===other.key));
 assert.ok(!spans.some(s=>s.pathKey===open));
 assert.ok(spans.some(s=>s.pathKey===localInside.key&&s.source==='local-exit'));
 assert.ok(!spans.some(s=>s.pathKey===lastExit.key),'last regular off-ramp stays open');
});
test('roadworks and accidents never receive administrative red/white closure stripes',()=>{
 for(const kind of ['roadworks','accident']){
  const e={...event,kind};
  assert.deepEqual(closedNetworkSpans([e],routes,exits,links),[]);
 }
});
test('regular last off-ramp remains available; on-ramp barred, internal AS access shut',()=>{
 const existing=makeCorridors(networkData.roads,networkData.ramps),key='A3-koeln',r=existing[key];
 const catalog=[...networkData.exits,...extensionJunctions];
 const anchor=catalog.find(e=>e.road==='A3'&&e.ref==='40');
 const metre=positionM(r,anchor.directional?.[key]?.position??anchor.position,900);
 assert.ok(metre!==null&&metre<r.lengthM-1200);
 const point=r.points.find((p,i)=>r.metres[i]>metre+180);
 const closure={...event,id:'closed-a3',pathKey:key,point,settings:{...event.settings,lengthM:500}};
 const gate=closureGate(r,closure,catalog,[closure]);
 assert.ok(gate.exit);
 const last=positionM(r,gate.exit.position,900);
 assert.equal(junctionAccess(r,[closure],last,gate.exit.ref).exit,true);
 assert.equal(junctionAccess(r,[closure],last,gate.exit.ref).entry,false);
});

test('multi-way ramps close only when every downstream branch enters the closed direction',()=>{
 const closedRoad=route(selected,[[50,7],[50,7.015],[50,7.019],[50,7.03],[50,7.045]]);
 const openRoad=route(open,[[50,7.015],[50.003,7.017]]);
 const fork=[50.005,7.018],exclusiveFork=[50.005,7.022];
 const shared=route('ramp-shared-approach',[[50.006,7.016],fork]);
 const blockedBranch=route('ramp-closed-branch',[fork,closedRoad.points[2]]);
 const openBranch=route('ramp-open-branch',[fork,openRoad.points[1]]);
 const exclusive=route('ramp-exclusive-approach',[[50.006,7.02],exclusiveFork]);
 const exclusiveEnd=route('ramp-exclusive-closed',[exclusiveFork,closedRoad.points[2]]);
 const outside=route('ramp-unmapped-boundary',[[50.007,7.023],[50.008,7.024]]);
 const all=Object.fromEntries([closedRoad,openRoad,shared,blockedBranch,openBranch,exclusive,exclusiveEnd,outside].map(r=>[r.key,r]));
 const e={...event,pathKey:selected,point:[50,7.018]};
 const j=[{road:'A4',ref:'915',name:'AD Köln-Heumar',position:closedRoad.points[1],source:'test'},
  {road:'A4',ref:'916',name:'AK Köln-Süd',position:closedRoad.points[3],source:'test'}];
 // No precomputed direct motorway connection: intermediate OSM ramp ways
 // must still inherit the ban without closing the shared, open approach.
 const spans=closedNetworkSpans([e],all,j,[]);
 const closed=new Set(spans.map(s=>s.pathKey));
 assert.ok(closed.has(selected));
 assert.ok(closed.has(blockedBranch.key));
 assert.ok(closed.has(exclusive.key));
 assert.ok(closed.has(exclusiveEnd.key));
 assert.ok(!closed.has(shared.key),'the feeder can still reach an open motorway');
 assert.ok(!closed.has(openBranch.key));
 assert.ok(!closed.has(outside.key),'an unmapped boundary is not automatically blocked');
 assert.ok(!closed.has(open));
});
