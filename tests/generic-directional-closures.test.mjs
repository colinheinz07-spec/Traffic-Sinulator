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
const routes=Object.fromEntries([main,branch,toAachen,awayToOpen,before,other].map(r=>[r.key,r]));
const exits=[{road:'A4',ref:'15',name:'AD Köln-Heumar',position:main.points[1],source:'test'},
 {road:'A4',ref:'16',name:'AK Köln-Süd',position:main.points[2],source:'test'}];
const pos=main.metres;
const event={id:'closed-aachen',kind:'closure',pathKey:selected,point:[50,7.018],
 laneCount:3,closedLanes:[0,1,2],createdAt:'2026-11-06T00:00:00Z',
 settings:{lengthM:400,speedKmh:0,shoulder:'blocked'}};
const links=[
 {rampId:toAachen.key,from:open,to:selected,rampEntryM:0,downstreamMergeM:pos[1]+150,sourceGapM:0,mergeGapM:0},
 {rampId:awayToOpen.key,from:selected,to:open,rampEntryM:pos[1]+150,downstreamMergeM:50,sourceGapM:0,mergeGapM:0},
 {rampId:before.key,from:open,to:selected,rampEntryM:0,downstreamMergeM:pos[0]+200,sourceGapM:0,mergeGapM:0},
 {rampId:other.key,from:selected,to:open,rampEntryM:pos[1]+150,downstreamMergeM:100,sourceGapM:0,mergeGapM:0}
];
test('closure spans the last usable exit through the next end exit, not a 400m marker only',()=>{
 const gate=closureGate(main,event,exits,[event]);
 assert.equal(gate.exit.ref,'15');
 assert.equal(gate.endExit.ref,'16');
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
