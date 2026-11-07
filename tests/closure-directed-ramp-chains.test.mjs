import test from 'node:test';
import assert from 'node:assert/strict';
import {closedNetworkSpans} from '../dist/closure-network.js';

function road(key,points){
 const metres=[0];
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i];
  metres.push(metres.at(-1)+111195*Math.hypot(
   (b[1]-a[1])*Math.cos((a[0]+b[0])*Math.PI/360),b[0]-a[0]));
 }
 return {key,points,metres,lengthM:metres.at(-1)};
}
const selected='extra-a4-aachen',open='extra-a4-olpe';
const main=road(selected,[[50,7],[50,7.015],[50,7.019],[50,7.03],[50,7.045]]);
const openRoad=road(open,[[50,7.015],[50.003,7.017]]);
const exits=[
 {road:'A4',ref:'915',name:'AD Köln-Heumar',position:main.points[1],source:'test'},
 {road:'A4',ref:'916',name:'AK Köln-Süd',position:main.points[3],source:'test'}
];
const event={id:'closed-to-aachen',kind:'closure',pathKey:selected,
 point:[50,7.018],laneCount:3,closedLanes:[0,1,2],
 createdAt:'2026-11-07T07:00:00Z',
 settings:{lengthM:400,speedKmh:0,shoulder:'blocked'}};
const fork=[50.0005,7.016],exclusiveFork=[50.001,7.017];
const shared=road('ramp-shared-approach',[[50.001,7.014],fork]);
const closedArm=road('ramp-closed-arm',[fork,main.points[2]]);
const openArm=road('ramp-open-arm',[fork,openRoad.points[1]]);
const exclusive=road('ramp-exclusive-approach',[[50.002,7.016],exclusiveFork]);
const exclusiveEnd=road('ramp-exclusive-closed',[exclusiveFork,main.points[2]]);
const wrongWay=road('ramp-wrong-way',[[50,7.021],main.points[2]]);
const external=road('ramp-unmapped-boundary',[[50.007,7.023],[50.008,7.024]]);
const roads=[main,openRoad,shared,closedArm,openArm,exclusive,exclusiveEnd,wrongWay,external];
const routes=Object.fromEntries(roads.map(r=>[r.key,r]));

test('directed OSM chains inherit full closure only on branches with no open alternative',()=>{
 const spans=closedNetworkSpans([event],routes,exits,[]);
 const blocked=new Set(spans.map(s=>s.pathKey));
 for(const id of [selected,closedArm.key,exclusive.key,exclusiveEnd.key])
  assert.ok(blocked.has(id),'missing closure on '+id);
 for(const id of [open,shared.key,openArm.key,wrongWay.key,external.key])
  assert.ok(!blocked.has(id),'must keep physically open '+id);
});
test('when a ramp has a closed mainline endpoint AND an open onward branch, the common segment stays open',()=>{
 const common=road('ramp-fork-at-mainline',[[50.001,7.018],main.points[2]]);
 const escape=road('ramp-escape-from-fork',[main.points[2],openRoad.points[1]]);
 const full={...routes,[common.key]:common,[escape.key]:escape};
 const blocked=new Set(closedNetworkSpans([event],full,exits,[]).map(s=>s.pathKey));
 assert.ok(!blocked.has(common.key),'never block a shared feeder before the branch');
 assert.ok(!blocked.has(escape.key),'the exit to the open motorway stays usable');
 assert.ok(blocked.has(closedArm.key),'other exclusively blocked ramp stays closed');
});
test('ordinary roadworks and accidents never produce red-white administrative ramp stripes',()=>{
 for(const kind of ['accident','roadworks'])
  assert.deepEqual(closedNetworkSpans([{...event,kind}],routes,exits,[]),[]);
});
