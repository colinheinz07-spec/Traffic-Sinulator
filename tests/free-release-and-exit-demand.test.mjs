import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {initialiseCells,advanceCells,cellSpeedBands,cellInventory,assertCellConservation} from '../dist/traffic-cells.js';
import {diversionJunctions} from '../dist/diversions.js';
import {voluntaryDiversionPercent} from '../dist/diversion-policy.js';
import {advanceRoutedPath} from '../dist/routed-traffic.js';
import {advanceDetour,emptyDetour,detourVehicles} from '../dist/detour-flow.js';
import {junctionMovements} from '../dist/junction-movements.js';

const routes=makeCorridors(networkData.roads,networkData.ramps),{exits}=networkData;
function block(path,at){const lanes=path.startsWith('A3')?3:2;
 return {id:'release-demand',kind:'accident',pathKey:path,point:routeSlice(routes[path],at,at+1)[0],laneCount:lanes,
  closedLanes:Array.from({length:lanes},(_,i)=>i),createdAt:'2026-10-26T12:00:00Z',
  settings:{lengthM:100,speedKmh:0,shoulder:'normal'}};}
const bandsKm=(s,color)=>cellSpeedBands(s).filter(b=>!color||b.color===color).reduce((n,b)=>n+b.toM-b.fromM,0)/1000;

for(const path of ['A3-koeln','A3-frankfurt','A48-dernbach','A48-koblenz'])
 test(`${path}: full reopening sends a clearing front backwards instead of leaving a long orange plateau`,()=>{
  const route=routes[path],demand=path.startsWith('A3')?3200:2000,after=path.startsWith('A3')?1800:900;
  const event=block(path,route.lengthM*.62);let state=initialiseCells(route,demand);
  for(let i=0;i<45;i++)state=advanceCells(state,route,[event],demand,exits);
  const before=cellInventory(state),initialKm=bandsKm(state),head=cellSpeedBands(state).at(-1).toM;
  const headCell=state.cells.findIndex(c=>c.toM>=head-.1);let peakOrange=0,fullFlow=0,clearAt=null,retreat=0;
  for(let i=0;i<120;i++){
   state=advanceCells(state,route,[],after,exits);assertCellConservation(state);
   const bands=cellSpeedBands(state);peakOrange=Math.max(peakOrange,bandsKm(state,'slow'));
   fullFlow=Math.max(fullFlow,state.cells[headCell].flowVph);
   if(i===20)retreat=bands.length?head-bands.at(-1).toM:head;
   if(!bands.length&&clearAt===null)clearAt=i+1;
   if(clearAt!==null)assert.equal(bands.length,0,'cleared underloaded traffic stays green');
  }
  assert.ok(retreat>1000,'the released head must move away from the old incident');
  assert.ok(peakOrange<initialKm*.55+.3,'queued local entrants may make a short merge wave, not a full orange plateau');
  assert.ok(fullFlow>after*1.5,'real discharge, not just colors, clears the queue');
  assert.ok(clearAt!==null&&clearAt<100);assert.ok(cellInventory(state)<before-500);
 });

test('full recovery under continuing high A3 demand does not spread a 17km jam into a 25km orange strip',()=>{
 const path='A3-koeln',route=routes[path],event=block(path,route.lengthM*.62);
 let state=initialiseCells(route,4200);for(let i=0;i<90;i++)state=advanceCells(state,route,[event],4200,exits);
 const head=cellSpeedBands(state).at(-1).toM;let peakOrange=0,after90;
 for(let i=0;i<180;i++){
  state=advanceCells(state,route,[],3400,exits);assertCellConservation(state);
  peakOrange=Math.max(peakOrange,bandsKm(state,'slow'));if(i===89)after90=state;
 }
 assert.ok(peakOrange<8,'temporary acceleration waves may remain, but no 25km orange plateau');
 assert.ok(cellSpeedBands(after90).at(-1).toM<head-12000,'recovery traverses the original queue');
 assert.equal(cellSpeedBands(state).length,0);
});

test('three hours of net saving can attract all drivers while the 45-minute onset stays gradual',()=>{
 assert.equal(voluntaryDiversionPercent(44.9),0);assert.equal(voluntaryDiversionPercent(45),2);
 for(const extra of [0,15,60,120]){
  assert.equal(voluntaryDiversionPercent(180+extra,extra),100);
  const values=Array.from({length:240},(_,i)=>voluntaryDiversionPercent(45+i,extra));
  assert.ok(values.every((v,i)=>i===0||v>=values[i-1]));
 }
 assert.equal(voluntaryDiversionPercent(200,240),0,'an even slower alternative is not forced');
 assert.equal(voluntaryDiversionPercent(210,30,85),100,'AD choices retain their 85-minute onset and may also reach 100%');
});

function exitRoute(path,fromRef,toRef){
 const js=diversionJunctions(path,exits,routes[path]),from=js.find(j=>j.ref===fromRef),to=js.find(j=>j.ref===toRef);
 const config={id:'high-exit-'+path,path,fromM:from.metre,toM:to.metre,eventId:'release-demand',geometry:{
  id:'high-exit-'+path,path,sourceExitRef:fromRef,targetExitRef:toRef,points:[from.position,to.position],
  lengthKm:8,freeMinutes:4,roadCapacityVph:650,storageVehicles:180,junctionCount:2,trafficLightCount:0,
  source:'osm-routed-infill',relationId:null,label:'Finite side-road scenario'}};
 return {config,state:emptyDetour(config)};
}

test('the detour ledger admits more than 1200/h when requested, then queues at its real side-road service',()=>{
 const entry=exitRoute('A3-frankfurt','38','40');let state=entry.state;
 const first=advanceDetour(state,entry.config,0,3000,100,900);state=first.state;
 assert.ok(first.entered*60>2900);assert.equal(first.capacityVph,650);assert.ok(state.waitingRoad>30);
 for(let i=1;i<35;i++){
  state=advanceDetour(state,entry.config,i,3000,100,900).state;
  assert.ok(detourVehicles(state)<=entry.config.geometry.storageVehicles+1e-6);
  assert.ok(Math.abs(state.admittedTotal-state.returnedTotal-detourVehicles(state))<1e-6);
 }
 assert.ok(state.waitingRoad>100);assert.ok(state.lastDeparture*60<1000,'finite receiving room eventually limits admission');
});

for(const [path,from,to] of [['A3-koeln','40','38'],['A3-frankfurt','38','40'],['A48-koblenz','12','11']])
 test(`${path}: all exit requests share the real stream, exceed 1200/h and spill back when the side road fills`,()=>{
  const route=routes[path],entry=exitRoute(path,from,to),event={...block(path,entry.config.fromM+350),kind:'closure'};
  let state=initialiseCells(route,3000),detours=[entry];const initial=cellInventory(state);let peak=0,lateDemand=0,lateActual=0;
  for(let i=0;i<75;i++){
   const next=advanceRoutedPath(state,route,[event],3000,exits,detours);state=next.cells;detours=next.detours;
   const local=state.junctions.find(j=>j.ref===from),actual=(local.lastExited+detours[0].state.lastDeparture)*60;
   peak=Math.max(peak,actual);assert.equal(detours[0].desiredPercent,100);
   assert.ok(local.lastExitDemand*60>=actual-1e-6);assert.equal(local.lastEntered,0);
   assert.ok(Math.abs(cellInventory(state)+detourVehicles(detours[0].state)+state.exitedTotal-initial-state.offeredTotal)<1e-5);
   if(i>60){lateDemand=Math.max(lateDemand,local.lastExitDemand*60);lateActual=Math.max(lateActual,actual);}
  }
  assert.ok(peak>2500,'the actual exit is not clipped to the former 1200/h limit');
  assert.ok(lateDemand>2500&&lateActual<1600,'unserved exit demand remains visible when the 650/h road is full');
  assert.ok(state.cells.some(c=>c.fromM<entry.config.fromM&&c.fromM>entry.config.fromM-3000&&c.speedKmh<20),
   'real vehicles must back up on the motorway rather than disappear into an unlimited side road');
  assert.ok(detours[0].state.waitingRoad>100);
  const real=[{path,fromM:entry.config.fromM,toM:entry.config.toM,eventId:event.id,desiredPercent:100,
   outVph:detours[0].state.lastDeparture*60,inVph:detours[0].state.lastRejoined*60,vehiclesOnDetour:detourVehicles(detours[0].state),
   waitingAtReentry:detours[0].state.waitingMerge}];
  const shown=junctionMovements(path,route,exits,[event],null,real,state.junctions).find(j=>j.exit.ref===from);
  assert.ok(shown.exitDemandVph>shown.outVph+1000,'wishes and actual departures are distinct UI figures');
 });
