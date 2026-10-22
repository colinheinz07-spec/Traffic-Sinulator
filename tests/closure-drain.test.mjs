import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice,positionM,closureGate,advanceSpatial,emptySpatial,jamsAt} from '../dist/spatial.js';
import {initialiseCells,advanceCells,assertCellConservation} from '../dist/traffic-cells.js';
import {diversionJunctions} from '../dist/diversions.js';
import {defaultDemands} from '../dist/traffic.js';
import {routeReport} from '../dist/network-report.js';

const corridors=makeCorridors(networkData.roads,networkData.ramps),exits=networkData.exits;
const makeEvent=(path,fromRef,toRef,kind='closure')=>{
 const route=corridors[path],junctions=diversionJunctions(path,exits,route);
 const from=junctions.find(x=>x.ref===fromRef),to=junctions.find(x=>x.ref===toRef);
 assert.ok(from&&to&&from.metre<to.metre);
 const at=from.metre+(to.metre-from.metre)*.62;
 const point=routeSlice(route,at,at+2)[0];
 const lanes=path.startsWith('A48')?2:3;
 return {id:'ev-'+path,kind,pathKey:path,point,
  laneCount:lanes,closedLanes:Array.from({length:lanes},(_,i)=>i),
  createdAt:'2026-10-22T12:00:00.000Z',
  settings:{lengthM:120,speedKmh:0,shoulder:'blocked'}};
};
test('Vollsperrung gates A3 and A48 at last normal upstream AS, not at physical marker',()=>{
 for(const [path,a,b] of [['A3-koeln','40','39'],['A3-frankfurt','37','38'],
  ['A48-dernbach','10','11'],['A48-koblenz','12','11']]){
  const route=corridors[path],event=makeEvent(path,a,b),gate=closureGate(route,event,exits);
  assert.equal(gate.exit.ref,a,path);
  assert.ok(gate.metre<gate.eventM-50);
  const pos=positionM(route,gate.exit.position,900);
  assert.ok(Math.abs(gate.metre-pos)<.01);
 }
});
test('as closure starts, already present downstream cell vehicles continue to flow and ultimately exit',()=>{
 const path='A3-koeln',route=corridors[path],event=makeEvent(path,'40','39');
 const gate=closureGate(route,event,exits),state0=initialiseCells(route,3100);
 const idx=Math.max(1,Math.round(gate.metre/state0.cellM)),initialAfter=state0.cells.slice(idx).reduce((n,c)=>n+c.vehicles,0);
 let state=state0;
 for(let minute=0;minute<12;minute++){
  state=advanceCells(state,route,[event],3100,exits);
  assertCellConservation(state);
 }
 const remainingAfter=state.cells.slice(idx).reduce((n,c)=>n+c.vehicles,0);
 assert.ok(initialAfter>20,'must start with vehicles already beyond the exit');
 assert.ok(remainingAfter<initialAfter*.85,'closed zone must empty: '+initialAfter+' to '+remainingAfter);
 assert.ok(state.exitedTotal>0,'vehicles already inside must leave the map');
 const before=state.cells.slice(Math.max(0,idx-10),idx).reduce((n,c)=>n+c.vehicles,0);
 assert.ok(before>state0.cells.slice(Math.max(0,idx-10),idx).reduce((n,c)=>n+c.vehicles,0),
  'following drivers wait before the last exit');
});
test('spatial closure queue forms at AS; elapsed waiting shows real elapsed minutes, not null',()=>{
 const path='A3-koeln',route=corridors[path],event=makeEvent(path,'40','39'),gate=closureGate(route,event,exits);
 const demand={...defaultDemands(),[path]:3300};
 let s=emptySpatial();
 for(let i=0;i<19;i++)s=advanceSpatial(s,[event],demand,1,corridors,[],[],exits);
 const queue=s.queues[event.id];
 assert.ok(queue&&queue.vehicles>100);
 assert.ok(Math.abs(positionM(route,queue.point)-gate.metre)<5,'queue must anchor at last usable AS');
 const jam=jamsAt(s,[event],corridors).find(j=>j.id===event.id);
 assert.ok(jam&&jam.elapsedWait);
 assert.ok(jam.delayMin>=17&&jam.delayMin<=19,'elapsed: '+jam.delayMin);
 const report=routeReport(path,[jam],[],[event]);
 assert.ok(report.delayMin>=17,'closure must show finite accrued time: '+report.delayMin);
});
test('a full carriageway-blocking accident still blocks at its own location',()=>{
 const path='A3-koeln',route=corridors[path],event=makeEvent(path,'40','39','accident');
 const cells=initialiseCells(route,3100);
 let state=cells;
 for(let i=0;i<6;i++)state=advanceCells(state,route,[event],3100,exits);
 const crashM=positionM(route,event.point),gateM=closureGate(route,{...event,kind:'closure'},exits).metre;
 assert.ok(crashM>gateM+50);
 const atCrash=Math.max(1,Math.round(crashM/state.cellM));
 const atGate=Math.max(1,Math.round(gateM/state.cellM));
 assert.ok(state.cells[atCrash-1].densityVehKm>cells.cells[atCrash-1].densityVehKm,
  'accident should produce a queue near crash');
 assert.ok(state.cells[atGate].flowVph>0,
  'an accident past the AS must not impose an administrative no-entry at the AS');
});
test('lifting closure does not delete accumulated vehicles',()=>{
 const path='A3-koeln',route=corridors[path],closure=makeEvent(path,'40','39');
 let state=initialiseCells(route,3200);
 for(let i=0;i<15;i++)state=advanceCells(state,route,[closure],3200,exits);
 const totalBefore=state.cells.reduce((sum,c)=>sum+c.vehicles,0)+state.backlog;
 const departedBefore=state.exitedTotal;
 state=advanceCells(state,route,[],850,exits);
 assertCellConservation(state);
 assert.ok(state.exitedTotal>departedBefore);
 assert.ok(state.cells.every(c=>c.vehicles>=0));
 assert.ok(totalBefore>0,'vehicles not deleted when closure removed');
});
