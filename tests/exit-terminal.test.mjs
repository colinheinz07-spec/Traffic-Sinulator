import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {initialiseCells,advanceCells,cellInventory,assertCellConservation} from '../dist/traffic-cells.js';
import {normalJunctionTraffic,exitRampVehicles} from '../dist/junction-traffic.js';
import {diversionJunctions} from '../dist/diversions.js';
import {advanceRoutedPath,advanceRoutedNetwork} from '../dist/routed-traffic.js';
import {emptyDetour,detourVehicles} from '../dist/detour-flow.js';
import {junctionMovements} from '../dist/junction-movements.js';
import {defaultDemands} from '../dist/traffic.js';

const routes=makeCorridors(networkData.roads,networkData.ramps),{exits}=networkData;
function scenario(path,ref,toRef,id='terminal'){
 const route=routes[path],js=diversionJunctions(path,exits,route),from=js.find(j=>j.ref===ref),to=js.find(j=>j.ref===toRef);
 const laneCount=path.startsWith('A3')?3:2,at=from.metre+350;
 const event={id,kind:'closure',pathKey:path,point:routeSlice(route,at,at+1)[0],laneCount,
  closedLanes:Array.from({length:laneCount},(_,i)=>i),createdAt:'2026-10-26T18:00:00Z',settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}};
 const config={id,path,fromM:from.metre,toM:to.metre,eventId:id,geometry:{id,path,sourceExitRef:ref,targetExitRef:toRef,
  points:[from.position,to.position],lengthKm:20,freeMinutes:20,roadCapacityVph:850,storageVehicles:1800,
  junctionCount:5,trafficLightCount:2,source:'simulated-bundled',relationId:null,label:'Terminal scenario'}};
 return {route,from,event,entry:{config,state:emptyDetour(config)}};
}

for(const [path,ref,to] of [['A3-frankfurt','40','41'],['A3-koeln','38','37'],['A48-dernbach','11','12'],['A48-koblenz','12','11']])
 test(`${path}: 3000/h exit demand fills its finite ramp storage and spills back within minutes despite a long empty bypass`,()=>{
  const {route,from,event,entry}=scenario(path,ref,to);
  const large=path==='A3-frankfurt'&&ref==='40'||path==='A48-dernbach'&&ref==='11';
  const terminal=large?1500:700,storage=large?120:40;
  let grid=initialiseCells(route,3000),entries=[entry];const initial=cellInventory(grid);let spilledAt=null;
  for(let i=0;i<20;i++){
   const next=advanceRoutedPath(grid,route,[event],3000,exits,entries);grid=next.cells;entries=next.detours;
   const j=grid.junctions.find(j=>j.ref===ref),actual=(j.lastExited+entries[0].state.lastDeparture)*60;
   assert.ok(actual<=terminal+1e-6&&actual>0,'all departures share terminal service, including normal destinations');
   assert.ok(exitRampVehicles(j)<=storage+1e-6&&exitRampVehicles(j)>=0);
   assert.ok(entries[0].desiredPercent===100&&j.lastEntered===0);
   assert.ok(Math.abs(cellInventory(grid)+detourVehicles(entries[0].state)+grid.exitedTotal-initial-grid.offeredTotal)<1e-5);
   assert.ok(detourVehicles(entries[0].state)<=terminal*(i+1)/60+1e-6,'side-road stock cannot exceed cumulative physical terminal service');
   if(grid.cells.some(c=>c.toM<from.metre-150&&c.fromM>from.metre-1500&&c.speedKmh<30))spilledAt??=i+1;
  }
  assert.ok(spilledAt!==null&&spilledAt<=Math.ceil(storage/(3000-terminal)*60)+5,'finite ramp storage must spill locally before the bypass fills; minute '+spilledAt);
  const j=grid.junctions.find(j=>j.ref===ref);assert.ok(exitRampVehicles(j)>storage-1&&j.lastExitDemand*60>2000);
  const real=[{path,fromM:from.metre,toM:entry.config.toM,eventId:event.id,outVph:entries[0].state.lastDeparture*60,
   inVph:0,desiredPercent:100,vehiclesOnDetour:detourVehicles(entries[0].state),waitingAtReentry:0}];
  const row=junctionMovements(path,route,exits,[event],null,real,grid.junctions).find(r=>r.exit.ref===ref);
  assert.ok(row.outVph<=terminal+1e-6&&row.exitDemandVph>row.outVph+1000);
  assert.ok(row.exitRampVehicles>storage-1&&row.exitRampStorageVehicles===storage&&row.exitTerminalVph===terminal);
 });

function localFixture(terminal=700,storage=40){
 const {route,from}=scenario('A3-frankfurt','40','41');
 const j={id:'isolated',ref:'40',metre:from.metre,entryVph:0,exitPercent:100,entryCapacityVph:900,exitCapacityVph:1800,
  exitTerminalVph:terminal,exitStorageVehicles:storage};
 return {route,j};
}
test('ordinary destinations alone also queue at the terminal instead of disappearing from the motorway',()=>{
 const {route,j}=localFixture();let state=initialiseCells(route,3000);
 for(let i=0;i<12;i++){
  state=advanceCells(state,route,[],3000,exits,[],[j]);assertCellConservation(state);
  assert.ok(state.junctions[0].lastExited*60<=700+1e-6);
 }
 assert.ok(exitRampVehicles(state.junctions[0])>39);
 assert.ok(state.cells.some(c=>c.toM<j.metre&&c.toM>j.metre-2000&&c.speedKmh<20));
});
test('a red/blocked terminal fills storage, and reopening drains the same retained vehicles even without new junction demand',()=>{
 const {route,j}=localFixture(0,12);let state=initialiseCells(route,3000);
 for(let i=0;i<3;i++)state=advanceCells(state,route,[],3000,exits,[],[j]);
 assert.equal(state.junctions[0].exitedTotal,0);assert.ok(Math.abs(exitRampVehicles(state.junctions[0])-12)<1e-6);
 const snapshot=structuredClone(state);
 state=advanceCells(state,route,[],0,exits,[],[{...j,exitPercent:0,exitTerminalVph:600}]);
 assert.ok(state.junctions[0].lastExited>9&&state.junctions[0].lastExited<=10+1e-6);
 state=advanceCells(state,route,[],0,exits,[],[]);
 assert.ok(exitRampVehicles(state.junctions[0])<1e-6,'existing ramp inventory survives removal of the demand row');
 assert.deepEqual(snapshot.junctions[0].exitQueue,{normal:12,detours:{}},'updates do not mutate the old queue');
 assertCellConservation(state);
});
test('terminal capacity is configurable rather than a blanket under-1000 clamp; finite storage stays separate',()=>{
 const {route,j}=localFixture(1500,20);let state=initialiseCells(route,3000);
 for(let i=0;i<10;i++)state=advanceCells(state,route,[],3000,exits,[],[j]);
 assert.ok(state.junctions[0].lastExited*60>1400&&state.junctions[0].lastExited*60<=1500+1e-6);
 assert.ok(exitRampVehicles(state.junctions[0])<=20+1e-6);
 assertCellConservation(state);
});
test('a full side road blocks committed ramp trips; reopening it serves old trips even with zero new interest',()=>{
 const {route,j}=localFixture(700,15),id='blocked-road';
 const local={...j,exitPercent:0};
 const port={id,fromM:j.metre,toM:j.metre+2000,interestPercent:100,exitCapacityVph:0,returnVehicles:0};
 let state=initialiseCells(route,3000);
 for(let i=0;i<6;i++)state=advanceCells(state,route,[],3000,exits,[port],[local]);
 assert.ok(Math.abs(exitRampVehicles(state.junctions[0])-15)<1e-6);
 assert.equal(state.divertedTotal,0,'neither a full road nor a finite ramp can swallow extra vehicles');
 const before=state.junctions[0].exitQueue.detours[id];
 state=advanceCells(state,route,[],3000,exits,[{...port,interestPercent:0,exitCapacityVph:1800}],[local]);
 assert.ok(state.lastTransfers[0].leaveVpm>11&&state.lastTransfers[0].leaveVpm<=700/60+1e-6);
 assert.ok(Math.abs(state.lastTransfers[0].leaveVpm+state.junctions[0].exitQueue.detours[id]-before)<1e-6);
 state=advanceCells(state,route,[],3000,exits,[{...port,interestPercent:0,exitCapacityVph:1800}],[local]);
 assert.ok(exitRampVehicles(state.junctions[0])<1e-6);assertCellConservation(state);
});
test('normal and two bypass destinations use one AS ramp, not one independent capacity per route',()=>{
 const a=scenario('A3-frankfurt','40','41','family-a'),b=scenario('A3-frankfurt','40','42','family-b');
 const events=[a.event,b.event],demands={...defaultDemands(),'A3-frankfurt':3000};
 let grids={'A3-frankfurt':initialiseCells(a.route,3000)},entries=[a.entry,b.entry];
 const initial=cellInventory(grids['A3-frankfurt']);
 for(let i=0;i<15;i++){
  const next=advanceRoutedNetwork(grids,routes,events,demands,exits,entries);grids=next.cells;entries=next.detours;
  const grid=grids['A3-frankfurt'],j=grid.junctions.find(j=>j.ref==='40');
  const terminal=j.lastExited+entries.reduce((s,e)=>s+e.state.lastDeparture,0);
  assert.ok(terminal*60<=1500+1e-6&&exitRampVehicles(j)<=120+1e-6);
  assert.ok(Math.abs(cellInventory(grid)+entries.reduce((s,e)=>s+detourVehicles(e.state),0)+grid.exitedTotal-initial-grid.offeredTotal)<1e-5);
 }
});
test('ordinary A3/A48 exits have individual finite terminal models; AD/AK motorway branches do not',()=>{
 let count=0;
 for(const path of ['A3-koeln','A3-frankfurt','A48-dernbach','A48-koblenz'])
  for(const j of normalJunctionTraffic(routes[path],exits,3000)){
   const large=path.startsWith('A3')?['40','42'].includes(j.ref):['10','11'].includes(j.ref);
   if(large){assert.ok(j.exitTerminalVph>=1500&&j.exitStorageVehicles>=120)}else{assert.equal(j.exitTerminalVph,700);assert.equal(j.exitStorageVehicles,40)}count++;
  }
 assert.equal(count,26);
 for(const [terminal,storage] of [[-1,40],[NaN,40],[700,0],[700,NaN]]){
  const {route,j}=localFixture(terminal,storage);
  assert.throws(()=>advanceCells(initialiseCells(route,0),route,[],0,exits,[],[j]),/Anschlussstellenzufluss/);
 }
});
