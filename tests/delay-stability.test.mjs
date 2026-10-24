import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {initialiseCells,advanceCells,assertCellConservation,cellSpeedBands} from '../dist/traffic-cells.js';
import {speedDelayInCells,speedDelayLabel} from '../dist/speed-delay.js';
import {trafficView} from '../dist/traffic-view.js';
import {diversionJunctions} from '../dist/diversions.js';

const routes=makeCorridors(networkData.roads,networkData.ramps),path='A3-frankfurt',route=routes[path];
const junctions=diversionJunctions(path,networkData.exits,route);
const a=junctions.find(j=>j.ref==='42'),b=junctions.find(j=>j.ref==='43'),at=(a.metre+b.metre)/2;
function incident(closedLanes,id='limburg-regression'){
 return {id,kind:'accident',pathKey:path,point:routeSlice(route,at,at+2)[0],laneCount:3,
  closedLanes,createdAt:'2026-10-23T13:00:00Z',
  settings:{lengthM:100,speedKmh:closedLanes.length===3?0:40,shoulder:'normal'}};
}

test('a blocked accident forecasts declared reopening without dividing by tiny CTM flow',()=>{
 const event=incident([0,1,2]);let state=initialiseCells(route,3400);
 for(let minute=0;minute<120;minute++){
  state=advanceCells(state,route,[event],3400);assertCellConservation(state);
  const delay=speedDelayInCells(state);
  assert.equal(state.dischargeVph,0,'the physical accident remains fully blocked');
  assert.equal(delay.blocked,false);assert.equal(delay.forecastWaitMin,30);
  assert.ok(delay.delayMin>=30&&delay.delayMin<1000,'bounded by queue inventory and reopening service, not epsilon flow');
  assert.match(speedDelayLabel(delay),/^~\+.*geschätzt/);
  const shown=trafficView([], {[path]:state},routes,[event],[],state.minute);
  assert.equal(shown.reports[path].delayMin,delay.delayMin);
  for(const jam of shown.jams){
   assert.equal(jam.delay.blocked,false);
   assert.match(speedDelayLabel(jam.delay,1,true),/^~\+/);
  }
 }
 assert.deepEqual(speedDelayInCells({...state,minute:100000}),speedDelayInCells(state),'forecast is independent of event age');
});

for(const [lanes,demand] of [[[0,1],3400],[[0],3900]]){
 test(`${3-lanes.length} open lanes: stop-and-go does not cause ten/twenty-minute prediction jumps`,()=>{
  const event=incident(lanes);let state=initialiseCells(route,demand),previous=0,peak=0,maxChange=0;
  const flows=[],colors=new Set();let previousCard=0,maxCardChange=0;
  for(let minute=0;minute<180;minute++){
   state=advanceCells(state,route,[event],demand,networkData.exits);assertCellConservation(state);
   const loss=speedDelayInCells(state);
   assert.equal(loss.blocked,false);
   maxChange=Math.max(maxChange,Math.abs(loss.delayMin-previous));previous=loss.delayMin;
   peak=Math.max(peak,loss.delayMin);flows.push(state.dischargeVph);
   const shown=trafficView([],{[path]:state},routes,[event],[],state.minute);
   const card=Math.max(0,...shown.jams.map(j=>j.delay.delayMin));
   maxCardChange=Math.max(maxCardChange,Math.abs(card-previousCard));previousCard=card;
   for(const band of cellSpeedBands(state))colors.add(band.color);
  }
  assert.ok(peak>45,'a growing queue must still report substantial, uncapped travel loss');
  assert.ok(maxChange<8,`largest one-minute change: ${maxChange}`);
  assert.ok(maxCardChange<8,`largest individual card change: ${maxCardChange}`);
  assert.ok(Math.max(...flows)>Math.min(...flows)*1.5,'real platoon discharge must remain dynamic');
  assert.ok(colors.size>=2,'map velocities must retain their real braking waves');
  const before=speedDelayInCells(state);
  assert.deepEqual(speedDelayInCells({...state,minute:100000}),before,'pause/clock cannot modify observations');
 });
}

test('lifting a long block estimates the released queue and then returns to free flow',()=>{
 const event=incident([0,1,2]);let state=initialiseCells(route,3400);
 for(let minute=0;minute<30;minute++)state=advanceCells(state,route,[event],3400,networkData.exits);
 assert.equal(speedDelayInCells(state).forecastWaitMin,30);
 const losses=[];
 for(let minute=0;minute<80;minute++){
  state=advanceCells(state,route,[],700,networkData.exits);assertCellConservation(state);
  const loss=speedDelayInCells(state);
  assert.equal(loss.blocked,false);losses.push(loss.delayMin);
 }
 assert.ok(losses[0]>5&&losses[0]<40,'a released 7km queue cannot inherit hours of hypothetical standstill');
 assert.ok(losses.slice(1).every((n,i)=>Math.abs(n-losses[i])<8));
 assert.ok(losses.at(-1)<1e-8,'cleared traffic cannot retain historical phantom delay');
 assert.equal(cellSpeedBands(state).length,0);
});

test('exit-bound movement does not open the accident through edge or replace its reopening forecast',()=>{
 const event=incident([0,1,2]);let state=initialiseCells(route,3400);
 const face=Math.max(1,Math.round((at+100)/state.cellM));
 const demand=[{id:'at-block',metre:face*state.cellM,entryVph:0,exitPercent:15,entryCapacityVph:900,exitCapacityVph:1200}];
 state=advanceCells(state,route,[event],3400,[],[],demand);
 assert.ok(state.cells[face-1].flowVph>0);
 const loss=speedDelayInCells(state);
 assert.equal(state.dischargeVph,0);
 assert.ok(state.cells[face-1].blockedAtM!==undefined);
 assert.equal(loss.blocked,false);assert.equal(loss.forecastWaitMin,30);
 assert.match(speedDelayLabel(loss),/^~\+/);
 assert.equal(speedDelayInCells(state,state.cells[face].fromM).blocked,false,'downstream remains traversable');
});
