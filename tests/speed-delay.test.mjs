import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {initialiseCells,advanceCells} from '../dist/traffic-cells.js';
import {speedDelayInCells,speedDelayLabel,queueTravelHeads} from '../dist/speed-delay.js';
import {freeSpeedKmh} from '../dist/traffic-physics.js';

const routes=makeCorridors(networkData.roads,networkData.ramps),free=freeSpeedKmh('A3-koeln');
function synthetic(speeds,km=1){
 const route=routes['A3-koeln'];
 const state=initialiseCells(route,2000);
 state.cells=speeds.map((speed,i)=>({
  fromM:i*km*1000,toM:(i+1)*km*1000,
  speedKmh:speed,vehicles:35,flowVph:speed*35,densityVehKm:35
 }));
 return state;
}
test('travel delay comes from actual local speed and distance, not elapsed closure time',()=>{
 const fast=synthetic([40,40]),slow=synthetic([10,10]);
 const a=speedDelayInCells(fast),b=speedDelayInCells(slow);
 assert.ok(Math.abs(a.delayMin-60*2*(1/40-1/free))<1e-7,'travel loss must use the current free-speed reference');
 assert.ok(Math.abs(b.delayMin-60*2*(1/10-1/free))<1e-7,'slow traffic has its actual distance/speed penalty');
 assert.ok(b.delayMin>a.delayMin*5);
 // Two identical traffic fields represent identical delays regardless of
 // simulation tick or closure timestamp.
 slow.minute=5000;
 assert.deepEqual(speedDelayInCells(slow),b);
 assert.equal(speedDelayLabel(b),'+11,1 min');
});
test('free-flow cannot invent time loss; shorter/slower affected roads have proportional loss',()=>{
 const freeState=synthetic([free,free]);
 assert.equal(speedDelayInCells(freeState).delayMin,0);
 const state=synthetic([10,10]);
 const half=speedDelayInCells(state,0,500);
 assert.ok(Math.abs(half.delayMin-60*.5*(1/10-1/free))<1e-7);
 assert.ok(speedDelayInCells(state,0,1000).delayMin<speedDelayInCells(state,0,2000).delayMin);
});
test('zero km/h is not an invented 1–5 km/h forecast or years since closure',()=>{
 const state=synthetic([0,10,free]);
 const d=speedDelayInCells(state);
 assert.equal(d.blocked,true);
 assert.equal(d.stoppedKm,1);
 assert.ok(Math.abs(d.delayMin-60*(1/10-1/free))<1e-7);
 assert.doesNotMatch(speedDelayLabel(d),/\+\d/,'partial moving sections cannot predict a blocked journey');
 assert.match(speedDelayLabel(d),/blockiert/);
 state.minute=110000;
 assert.equal(speedDelayInCells(state).delayMin,d.delayMin);
 const all=speedDelayInCells(synthetic([0,0]));
 assert.equal(all.blocked,true);
 assert.equal(all.delayMin,0);
 assert.match(speedDelayLabel(all),/nicht prognostizierbar/);
 assert.doesNotMatch(speedDelayLabel(all),/\+\d/);
});
test('cell delay can be calculated over only the spatial footprint of one jam',()=>{
 const state=synthetic([25,5,120,120]);
 const local=speedDelayInCells(state,1000,2000);
 assert.ok(Math.abs(local.delayMin-(60*(1/5-1/free)))<1e-7);
 assert.equal(local.blocked,false);
 assert.equal(local.assessedKm,1);
});
test('physical closure produces a blocked travel-time state while downstream cars clear',()=>{
 const route=routes['A3-koeln'];
 const {exits}=networkData;
 const p=routeSlice(route,route.lengthM*.45,route.lengthM*.45+2)[0];
 const event={id:'closure',kind:'closure',pathKey:'A3-koeln',point:p,laneCount:3,
  closedLanes:[0,1,2],createdAt:'2026-10-22T09:00:00Z',
  settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}};
 let state=initialiseCells(route,3400);
 for(let i=0;i<12;i++)state=advanceCells(state,route,[event],3400,exits);
 const d=speedDelayInCells(state);
 assert.equal(d.blocked,true,'queue contains genuine stopped cells');
 assert.ok(d.stoppedKm>0);
 assert.ok(d.delayMin>=0&&Number.isFinite(d.delayMin));
});
test('UI labels read physical speed field, never event age',()=>{
 const app=readFileSync('src/app.ts','utf8');
 const spatial=readFileSync('src/spatial.ts','utf8');
 const view=readFileSync('src/traffic-view.ts','utf8');
 assert.match(view,/speedDelayInCells\(state,group\.fromM,group\.toM(?:,|\))/);
 assert.ok(app.includes('speedDelayLabel(jam.delay)'));
 assert.ok(app.includes('speedDelayLabel(view.delays[key])'));
 assert.doesNotMatch(app,/jam\.elapsedWait/);
 assert.doesNotMatch(spatial,/firstQueuedMinute/);
 assert.doesNotMatch(app,/min\$\{jam\.elapsedWait/);
});


test('near-zero mandatory exit service cannot produce millions of minutes',()=>{
 const state=synthetic([3,3,3],2.3);
 for(const c of state.cells){c.densityVehKm=180;c.vehicles=414;c.criticalDensityVehKm=30;}
 const head=state.cells.at(-1);
 head.blockedAtM=head.toM;
 head.travelDetector={control:'exit38',capacityVph:420,meanFlowVph:.007,active:true,samples:99,diversionExitRef:'38'};
 const delay=speedDelayInCells(state);
 assert.equal(delay.blocked,true);
 assert.equal(delay.delayMin,0);
 assert.equal(delay.diversionExitRef,'38');
 assert.match(speedDelayLabel(delay,1,true),/Ausleitung AS 38.*nicht berechenbar/);
 // A recovered real discharge restores a speed-derived finite estimate.
 head.travelDetector.meanFlowVph=420;
 const recovered=speedDelayInCells(state);
 assert.equal(recovered.blocked,false);
 assert.ok(recovered.delayMin>100&&recovered.delayMin<200);
});
test('near-zero creeping velocity is standstill rather than a years-long prediction',()=>{
 const delay=speedDelayInCells(synthetic([.00004]));
 assert.equal(delay.blocked,true);assert.equal(delay.delayMin,0);
 assert.doesNotMatch(speedDelayLabel(delay),/\+\d/);
});
test('invalid delay cannot leak NaN or Infinity into UI',()=>{
 for(const delayMin of [NaN,Infinity,-1])assert.match(speedDelayLabel({delayMin,blocked:false,assessedKm:1,stoppedKm:0}),/nicht berechenbar/);
});


test('one temporarily free cell before a detector cannot detach the whole upstream queue from its service',()=>{
 const state=synthetic(Array(20).fill(8),.1);
 for(const c of state.cells){c.vehicles=15;c.densityVehKm=150;c.criticalDensityVehKm=30;c.travelFlowVph=2400;}
 const head=state.cells.at(-1);head.travelDetector={control:'steady',active:true,capacityVph:1200,meanFlowVph:1200,samples:20};
 const before=speedDelayInCells(state);
 Object.assign(state.cells[18],{vehicles:1,densityVehKm:10,speedKmh:130});
 assert.equal(queueTravelHeads(state).get(state.cells[0].toM),head);
 const after=speedDelayInCells(state);
 assert.ok(Math.abs(after.delayMin-before.delayMin)<1,'only the cleared 100m cell changes travel loss');
});
