import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {initialiseCells,advanceCells,assertCellConservation,cellInventory} from '../dist/traffic-cells.js';
import {speedDelayInCells} from '../dist/speed-delay.js';
import {trafficView} from '../dist/traffic-view.js';
import {freeSpeedKmh} from '../dist/traffic-physics.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
function event(path,at,kind,closed,id){
 const laneCount=path.startsWith('A48')?2:3;
 return {id,kind,pathKey:path,point:routeSlice(routes[path],at,at+1)[0],laneCount,closedLanes:closed,
  createdAt:'2026-10-25T10:00:00Z',settings:{lengthM:100,speedKmh:closed.length===laneCount?0:40,shoulder:'normal'}};
}

for(const path of ['A3-koeln','A3-frankfurt','A48-dernbach','A48-koblenz'])
 test(`${path}: a new worksite's empty arrival stream cannot price the distant released accident queue`,()=>{
  const route=routes[path],at=path.startsWith('A3')?14000:7000,gap=path.startsWith('A3')?8000:4500;
  const lanes=path.startsWith('A3')?3:2,demand=path.startsWith('A3')?3400:1900;
  const accident=event(path,at,'accident',Array.from({length:lanes},(_,i)=>i),'first-accident');
  let grid=initialiseCells(route,demand);
  for(let i=0;i<90;i++)grid=advanceCells(grid,route,[accident],demand,networkData.exits);
  const work=event(path,at+gap,'roadworks',Array.from({length:lanes-1},(_,i)=>i),'new-roadworks');
  for(let i=0;i<6;i++){
   grid=advanceCells(grid,route,[work],demand,networkData.exits);assertCellConservation(grid);
   const head=grid.cells.find(c=>c.travelDetector?.active);
   assert.ok(head&&head.toM>at+gap);
   const withoutNew={...grid,cells:grid.cells.map(c=>c===head?{...c,travelDetector:undefined}:c)};
   const own=speedDelayInCells(grid,0,at+100),reference=speedDelayInCells(withoutNew,0,at+100);
   assert.equal(own.blocked,false);assert.equal(own.forecastWaitMin,undefined);
   assert.ok(Math.abs(own.delayMin-reference.delayMin)<1e-8,
    `step ${i}: the same upstream cars and release flow must have the same loss`);
   const view=trafficView([],{[path]:grid},routes,[work],[],grid.minute);
   const upstream=view.jams.filter(j=>j.anchorM<at+1000);
   assert.ok(upstream.length>0);
   assert.ok(upstream.every(j=>!j.delay.blocked&&j.delay.forecastWaitMin===undefined));
   // A field measured at ~5,400/3,600 veh/h cannot imply hundreds of
   // thousands of minutes for the much smaller actual vehicle stock.
   const released=grid.cells.find(c=>c.travelDetector&&!c.travelDetector.active).travelDetector.meanFlowVph;
   const stockBound=cellInventory(grid)/released*60;
   assert.ok(upstream.every(j=>j.delay.delayMin<=stockBound+1e-6));
  }
 });

for(const path of ['A3-koeln','A48-dernbach'])for(const sameId of [false,true])
 test(`${path}: replacing a blocked accident with open roadworks (${sameId?'edited event':'new event'}) resets the forecast`,()=>{
  const route=routes[path],at=route.lengthM*.45,lanes=path.startsWith('A3')?3:2,demand=path.startsWith('A3')?3400:1900;
  const old=event(path,at,'accident',Array.from({length:lanes},(_,i)=>i),'blocked');
  let state=initialiseCells(route,demand);
  for(let i=0;i<45;i++)state=advanceCells(state,route,[old],demand,networkData.exits);
  const work=event(path,at,'roadworks',[0],sameId?old.id:'replacement');
  for(let i=0;i<60;i++){
   state=advanceCells(state,route,[work],demand,networkData.exits);assertCellConservation(state);
   const loss=speedDelayInCells(state);
   assert.equal(loss.forecastWaitMin,undefined);assert.equal(loss.blocked,false);
   assert.ok(state.cells.filter(c=>c.travelDetector?.active).every(c=>c.travelDetector.meanFlowVph>0));
   assert.ok(Number.isFinite(loss.delayMin));
   const shown=trafficView([],{[path]:state},routes,[work],[],state.minute);
   assert.ok(Math.abs(shown.reports[path].delayMin-loss.delayMin)<1e-8);
  }
 });

test('a starved worksite warms up from actual queued service instead of freezing a near-zero average',()=>{
 const path='A3-koeln',route=routes[path],at=14000,work=event(path,at,'roadworks',[0,1],'warm-up');
 let state=initialiseCells(route,3400);
 for(let i=0;i<60;i++)state=advanceCells(state,route,[work],3400,networkData.exits);
 const head=state.cells.find(c=>c.travelDetector?.active);
 head.travelDetector={...head.travelDetector,meanFlowVph:.001,samples:30};
 let actual=0;
 for(let i=0;i<12;i++){
  state=advanceCells(state,route,[work],3400,networkData.exits);assertCellConservation(state);actual+=state.dischargeVph/12;
 }
 const measured=state.cells.find(c=>c.travelDetector?.active).travelDetector.meanFlowVph;
 assert.ok(measured>actual*.05,'new observed outflow must recover the estimator within minutes');
});

test('roadworks held behind a long downstream accident retain their own service after reopening',()=>{
 const path='A3-koeln',route=routes[path],at=16000;
 const accident=event(path,at,'accident',[0,1,2],'long-downstream-block');
 const work=event(path,at-500,'roadworks',[0,1],'existing-works');
 let state=initialiseCells(route,3400);
 for(let i=0;i<1500;i++)state=advanceCells(state,route,[accident,work],3400,networkData.exits);
 assertCellConservation(state);
 const stopped=speedDelayInCells(state),reopening=state.cells.find(c=>c.reopeningForecast).reopeningForecast;
 const onRoad=state.cells.reduce((n,c)=>n+c.vehicles,0);
 assert.equal(stopped.forecastWaitMin,30);assert.equal(stopped.blocked,false);
 assert.ok(stopped.delayMin<onRoad/reopening.serviceVph*60+90,
  'one real downstream reopening forecast governs the connected queue through the upstream worksite');
 const stalledWork=state.cells.find(c=>c.travelDetector?.active&&c.toM<at).travelDetector;
 assert.ok(stalledWork.meanFlowVph>stalledWork.capacityVph*.1,
  'downstream backpressure must not be mistaken for the upstream worksite losing its capacity');
 for(let i=0;i<30;i++){
  state=advanceCells(state,route,[work],3400,networkData.exits);assertCellConservation(state);
  const current=state.cells.find(c=>c.travelDetector?.active).travelDetector;
  const loss=speedDelayInCells(state),stock=state.cells.reduce((n,c)=>n+c.vehicles,0);
  assert.equal(loss.forecastWaitMin,undefined);assert.equal(loss.blocked,false);
  assert.ok(current.meanFlowVph>current.capacityVph*.1);
  assert.ok(loss.delayMin<stock/current.meanFlowVph*60+90,
   'the reopened accident cannot leave hundreds of thousands of minutes on the remaining worksite');
 }
});

test('long real travel losses remain uncapped after fixing the detector association',()=>{
 const path='A3-koeln',state=initialiseCells(routes[path],2000),speed=.25,km=6;
 state.cells=[{fromM:0,toM:km*1000,vehicles:600,densityVehKm:100,speedKmh:speed,flowVph:speed*100}];
 const loss=speedDelayInCells(state),expected=60*km*(1/speed-1/freeSpeedKmh(path));
 assert.equal(loss.blocked,false);assert.ok(loss.delayMin>1000);
 assert.ok(Math.abs(loss.delayMin-expected)<1e-8,'the fix must not hide a bug behind a display ceiling');
});
