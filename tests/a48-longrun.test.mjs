import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice,emptySpatial,advanceSpatial,jamsAt,jamBands} from '../dist/spatial.js';
import {buildRampConnections,rampSpillbacks} from '../dist/interchange.js';
import {routeReport} from '../dist/network-report.js';
import {eventFromHit} from '../dist/events.js';
import {defaultDemands} from '../dist/traffic.js';
const routes=makeCorridors(networkData.roads,networkData.ramps);
const links=buildRampConnections(networkData.ramps,routes);
const ramp=links.find(l=>l.rampId==='ramp-a48-to-koeln');
const demands=defaultDemands();

function roadwork(key,at,id,closed=[0,1],speed=40){
 const road=networkData.roads.find(r=>r.road===key);
 const point=routeSlice(routes[key],at,at+3)[0];
 const hit={kind:'road',road,key,point,distance:0,fraction:.5};
 return eventFromHit(hit,'roadworks',3,closed,id,'2026-10-20T08:00:00Z',{lengthM:500,speedKmh:speed,shoulder:'normal'});
}
test('240 simulated minutes of severe A3 congestion cannot spawn a fake A48 through-lane queue',()=>{
 const e=roadwork(ramp.to,ramp.downstreamMergeM+1200,'downstream');
 let state=emptySpatial(),maxThroughDelay=0,hasRampOverflow=false;
 for(let i=0;i<240;i++){
  state=advanceSpatial(state,[e],demands,1,routes,links);
  const jams=jamsAt(state,[e],routes);
  const spillbacks=rampSpillbacks(jams,links,routes);
  const a48=routeReport('A48-dernbach',jams,spillbacks,[e]);
  const a3=routeReport('A3-koeln',jams,spillbacks,[e]);
  assert.ok(a3.queueVehicles>=0);
  assert.equal(a48.ownVehicles,0,'A48 has no true mainline restriction at minute '+i);
  assert.equal(a48.delayMin,0,'A48 through time cannot artificially grow at minute '+i);
  assert.equal(a48.color,'free','A48 through color unaffected by off-ramp cars');
  assert.ok(!Object.keys(state.queues).some(id=>id.startsWith('spill:')),'fabricated mainline queue was created');
  maxThroughDelay=Math.max(maxThroughDelay,a48.delayMin);
  if(a48.sharedRampVehicles>0){
    hasRampOverflow=true;
    assert.notEqual(a48.exitColor,'free','actual ramp congestion is still visible');
  }
 }
 assert.equal(maxThroughDelay,0);
 assert.ok(hasRampOverflow,'the test must exercise a real A48 exit lane spillback');
});
test('no change in queued vehicles or discharge means no artificial delay increment',()=>{
 const e=roadwork('A3-koeln',ramp.downstreamMergeM+1500,'event');
 const start=advanceSpatial(emptySpatial(),[e],demands,30,routes,links);
 const later={...start,minute:start.minute+500};
 const before=jamsAt(start,[e],routes),after=jamsAt(later,[e],routes);
 assert.deepEqual(after.map(x=>x.delayMin),before.map(x=>x.delayMin));
 assert.deepEqual(after.map(x=>x.color),before.map(x=>x.color));
});
test('real A48 lane closure may form a real mainline jam, but removing it discharges queues',()=>{
 const e=roadwork('A48-dernbach',routes['A48-dernbach'].lengthM*.67,'real-a48');
 const packed=advanceSpatial(emptySpatial(),[e],demands,35,routes,links);
 const own=jamsAt(packed,[e],routes).filter(j=>j.pathKey==='A48-dernbach');
 assert.ok(own.some(j=>j.queueVehicles>20));
 const released=advanceSpatial(packed,[],demands,1,routes,links);
 const next=jamsAt(released,[],routes).filter(j=>j.pathKey==='A48-dernbach');
 assert.ok(next.length>0&&next[0].queueVehicles<own[0].queueVehicles,'no instantaneous deletion or permanent lock');
});
test('no permanent predetermined orange stripe at merges',()=>{
 for(const color of ['slow','jam','standstill']){
  const bands=jamBands({anchorM:5000,queueM:3500,color});
  assert.deepEqual(bands.map(b=>b.color),[color]);
  assert.equal(bands[0].toM-bands[0].fromM,3500);
 }
});
