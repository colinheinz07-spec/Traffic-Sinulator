import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice,emptySpatial,advanceSpatial,jamsAt} from '../dist/spatial.js';
import {buildRampConnections,rampSpillbacks} from '../dist/interchange.js';
import {routeReport} from '../dist/network-report.js';
import {defaultDemands,PATHS,eventCapacity,laneDemandShares,closedDemandShare} from '../dist/traffic.js';
import {eventFromHit} from '../dist/events.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
const links=buildRampConnections(networkData.ramps,routes);
function blockedTarget(link,distance=2400){
 const route=routes[link.to];
 const at=Math.min(route.lengthM-20,link.downstreamMergeM+distance);
 const point=routeSlice(route,at,at+2)[0];
 const hit={kind:'road',road:networkData.roads.find(r=>r.road===link.to),key:link.to,point,distance:0,fraction:.5};
 return eventFromHit(hit,'closure',3,[],'closed:'+link.rampId,'2026-10-19T12:00:00Z',{lengthM:100,speedKmh:0,shoulder:'blocked'});
}
test('A3 Frankfurt closure builds REAL queues on A48 ramp and A48 feeder, opposite A48 remains free',()=>{
 const link=links.find(x=>x.rampId==='ramp-a48-to-frankfurt');
 assert.ok(link);
 const event=blockedTarget(link);
 const d=defaultDemands();const halfway=advanceSpatial(emptySpatial(),[event],d,60,routes,links);
 const after=advanceSpatial(halfway,[event],d,60,routes,links);
 const jams=jamsAt(after,[event],routes),spills=rampSpillbacks(jams,links,routes);
 const ramp=routeReport(link.rampId,jams,spills,[event]);
 const feeder=routeReport(link.from,jams,spills,[event]);
 const opposite=routeReport('A48-koblenz',jams,spills,[event]);
 assert.ok(ramp.ownVehicles>0,'the blocked merge creates a real ramp queue');
 assert.ok(feeder.queueVehicles>0,'feeder has actual or on-feeder vehicles, never zero on colored section');
 assert.ok(spills.some(s=>s.rampId===link.rampId&&s.source==='A48-dernbach'));
 assert.ok(feeder.delayMin===null||feeder.delayMin>0,'feeder delay must not read zero');
 assert.equal(opposite.queueVehicles,0,'opposite A48 direction unaffected');
 assert.ok(Object.keys(after.queues).some(id=>id==='merge:'+link.rampId));
 const ownerIds=new Set(jams.map(j=>j.id));assert.equal(ownerIds.size,jams.length);
 assert.ok(feeder.sharedRampVehicles>0,'physically relocated ramp queues are reported but owned only once');
});
test('coupling only blocks ramps if a downstream queue has actually reached their merge',()=>{
 const link=links.find(x=>x.rampId==='ramp-a48-to-frankfurt');
 const e=blockedTarget(link,4000),d=defaultDemands();
 const first=advanceSpatial(emptySpatial(),[e],d,1,routes,links);
 assert.ok(!first.queues['merge:'+link.rampId],'queue has not reached merge after one minute');
});
test('independent right/left lane closures differ, with normalized lane distributions',()=>{
 const shares=laneDemandShares(3);assert.ok(Math.abs(shares.reduce((a,b)=>a+b,0)-1)<1e-9);
 assert.ok(shares[0]>shares[1]&&shares[1]>shares[2]);
 const point=routes['A3-koeln'].points[500];
 const hit={kind:'road',road:networkData.roads.find(r=>r.road==='A3-koeln'),key:'A3-koeln',point,distance:0,fraction:.5};
 const make=lanes=>eventFromHit(hit,'roadworks',3,lanes,'lane','2026-10-19T12:00:00Z',{lengthM:500,speedKmh:60,shoulder:'normal'});
 assert.ok(closedDemandShare(make([0]))>closedDemandShare(make([2])));
 assert.ok(eventCapacity(make([0]))<eventCapacity(make([2])),'right lane is more disruptive in scenario assumptions');
 assert.ok(eventCapacity(make([0,1]))<eventCapacity(make([1,2])));
});
