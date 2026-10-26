import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {DIRECTIONS} from '../dist/core.js';
import {makeCorridors,routeSlice,metres} from '../dist/spatial.js';
import {bundledExitRoutes,bundledTargets,bundledDetourGeometry,isNetworkDestination} from '../dist/bundled-detours.js';
import {automaticDiversions} from '../dist/auto-diversions.js';
import {buildRampConnections} from '../dist/interchange.js';
import {initialiseCells,cellInventory,advanceCells,cellSpeedBands,platoonServiceFactor} from '../dist/traffic-cells.js';
import {emptyDetour,detourVehicles} from '../dist/detour-flow.js';
import {advanceRoutedNetwork} from '../dist/routed-traffic.js';
import {defaultDemands} from '../dist/traffic.js';
const exits=networkData.exits,routes=makeCorridors(networkData.roads,networkData.ramps);
const connections=buildRampConnections(networkData.ramps,routes);
function incident(path,at,kind='closure',closedLanes=[0,1,2],speedKmh=0){return {
 id:'offline-'+path,kind,pathKey:path,point:routeSlice(routes[path],at,at+2)[0],
 laneCount:path.startsWith('A48')?2:3,closedLanes,createdAt:'2026-10-22T12:00:00Z',
 settings:{lengthM:100,speedKmh,shoulder:kind==='closure'?'blocked':'normal'}};}
function config(option){return {id:option.key,path:option.path,fromM:option.from.metre,toM:option.to.metre,
 targetPath:option.targetPath,sourceEndM:option.sourceEndM,targetEntryM:option.targetEntryM,
 exitsNetwork:isNetworkDestination(option.to),eventId:option.event?.id??option.causeId,
 geometry:bundledDetourGeometry(option.key,option.path,option.from,option.to,exits)};}

test('all 26 directional normal exits have an immediately usable bundled route',()=>{
 let count=0;
 for(const path of DIRECTIONS){
  const choices=bundledExitRoutes(path,exits,routes[path]);count+=choices.length;
  assert.equal(choices.length,path.startsWith('A3')?10:3);
  for(const choice of choices){
   assert.ok(!choice.from.isInterchange&&choice.to.metre>choice.from.metre);
   const g=choice.geometry;
   assert.equal(g.source,'simulated-bundled');assert.match(g.label,/angenäherter/);
   assert.ok(g.points.length>=5&&g.freeMinutes>=2&&g.roadCapacityVph>0);
   assert.deepEqual(g.points[0],choice.from.position);assert.deepEqual(g.points.at(-1),choice.to.position);
   assert.ok(g.points.every(p=>p.length===2&&p.every(Number.isFinite)));
   assert.ok(g.lengthKm*1000>=metres(choice.from.position,choice.to.position));
   assert.equal(g.relationId,null,'simulated roads must not masquerade as an official OSM relation');
  }
 }
 assert.equal(count,26);
});
test('long incidents compose every downstream target pair without fetching or leaving a route gap',()=>{
 for(const path of DIRECTIONS){
  const targets=bundledTargets(path,exits,routes[path]);
  for(let a=0;a<targets.length-1;a++)for(let b=a+1;b<targets.length;b++){
   const g=bundledDetourGeometry('pair',path,targets[a],targets[b],exits);
   const measured=g.points.slice(1).reduce((n,p,i)=>n+metres(g.points[i],p),0)/1000;
   assert.ok(Math.abs(measured-g.lengthKm)<1e-8);
   assert.ok(g.points.slice(1).every((p,i)=>metres(g.points[i],p)<3500),'avoid giant straight connectors');
  }
 }
});
test('an incident after each exit always has a bundled bypass including the last AS at each boundary',()=>{
 for(const path of DIRECTIONS)for(const entry of bundledExitRoutes(path,exits,routes[path])){
  const at=(entry.from.metre+entry.to.metre)/2;
  const options=automaticDiversions([incident(path,at)],routes,exits,{});
  const option=options.find(o=>o.from.ref===entry.from.ref);
  assert.ok(option,`${path} AS ${entry.from.ref} was skipped`);
  const c=config(option);assert.ok(c.geometry.points.length>2);
  assert.equal(c.exitsNetwork,isNetworkDestination(option.to));
 }
});
test('an incident reaching the end of the map retains every upstream exit route',()=>{
 for(const path of DIRECTIONS){
  const e=incident(path,routes[path].lengthM-100);e.settings.lengthM=5000;
  const options=automaticDiversions([e],routes,exits,{});
  assert.equal(options.length,path.startsWith('A3')?10:3);
  assert.ok(options.every(o=>isNetworkDestination(o.to)));
  for(const option of options)assert.ok(config(option).exitsNetwork);
 }
});
test('boundary detours finish outside the network and conserve all cars without a fictitious re-entry',()=>{
 for(const path of DIRECTIONS){
  const route=routes[path],e=incident(path,route.lengthM-250);
  const last=bundledExitRoutes(path,exits,route).at(-1);
  const choice=automaticDiversions([e],routes,exits,{}).find(o=>o.from.ref===last.from.ref);
  const c=config(choice),demands={...defaultDemands(),[path]:1800};
  let cells={[path]:initialiseCells(route,1800)},detours=[{config:c,state:emptyDetour(c)}];
  const initial=cellInventory(cells[path]);
  for(let t=0;t<65;t++){
   const next=advanceRoutedNetwork(cells,routes,[e],demands,exits,detours);cells=next.cells;detours=next.detours;
   const grid=cells[path],side=detours[0].state;
   assert.ok(Math.abs(cellInventory(grid)+detourVehicles(side)+grid.exitedTotal+(side.exitedNetworkTotal??0)-initial-grid.offeredTotal)<1e-5);
   assert.equal(side.lastRejoined,0);assert.equal(grid.rejoinedTotal,0);
  }
  assert.ok(detours[0].state.exitedNetworkTotal>100,`${path} must actually complete outside trips`);
  assert.equal(detours[0].state.waitingMerge,0);
  detours=detours.map(entry=>({...entry,enabled:false}));demands[path]=0;
  const admitted=detours[0].state.admittedTotal;
  const service=Math.min(c.geometry.roadCapacityVph,...(c.geometry.sections??[]).map(s=>s.capacityVph));
  const clearingMinutes=Math.ceil(detourVehicles(detours[0].state)/service*60+c.geometry.freeMinutes)+3;
  for(let t=0;t<clearingMinutes;t++){
   const next=advanceRoutedNetwork(cells,routes,[],demands,exits,detours);cells=next.cells;detours=next.detours;
   assert.equal(detours[0].state.admittedTotal,admitted,'pausing closes admission while the larger existing queue finishes');
  }
  assert.ok(detourVehicles(detours[0].state)<1e-6);
  assert.ok(Math.abs(detours[0].state.admittedTotal-detours[0].state.exitedNetworkTotal)<1e-6);
 }
});
test('bundled cross-motorway routes bypass an A3 queue via every A48 normal exit',()=>{
 const path='A3-koeln',merge=connections.find(c=>c.rampId==='ramp-a48-to-koeln');
 const e=incident(path,merge.downstreamMergeM+1600,'accident',[0,1,2]);
 let grid=initialiseCells(routes[path],3600);
 for(let t=0;t<45;t++)grid=advanceCells(grid,routes[path],[e],3600,exits);
 const choices=automaticDiversions([e],routes,exits,{[path]:grid},connections).filter(c=>c.path==='A48-dernbach');
 assert.deepEqual(choices.map(o=>o.from.ref).sort(),['10','11','12']);
 for(const option of choices){const c=config(option);assert.equal(c.targetPath,path);assert.ok(c.geometry.lengthKm>5);}
});
test('braking and discharge intervals vary rather than repeating a fixed pulse period',()=>{
 const samples=Array.from({length:840},(_,i)=>platoonServiceFactor('irregular-driver-history',i/6));
 const begins=[],ends=[],depths=[];let minimum=Infinity;
 for(let i=1;i<samples.length;i++){
  if(samples[i]<.8){minimum=Math.min(minimum,samples[i]);if(samples[i-1]>=.8)begins.push(i);}
  else if(samples[i-1]<.8){ends.push(i);depths.push(Math.round(minimum*100));minimum=Infinity;}
 }
 const intervals=begins.slice(1).map((v,i)=>v-begins[i]);
 assert.ok(new Set(intervals).size>=5,'releases need different distances in time');
 assert.ok(new Set(depths).size>=5,'braking strength must vary');
 assert.ok(Math.abs(samples.reduce((n,x)=>n+x,0)/samples.length-1)<.04,'pulses must not quietly destroy average service');
 assert.equal(platoonServiceFactor('irregular-driver-history',7.25),platoonServiceFactor('irregular-driver-history',7.25));
});
test('a reopened lane produces unequal moving color sections while a long queue drains',()=>{
 const path='A3-frankfurt',route=routes[path],e=incident(path,route.lengthM*.65,'accident',[0,1],40);
 e.id='irregular-sample';let grid=initialiseCells(route,4100);
 for(let t=0;t<110;t++)grid=advanceCells(grid,route,[e],4100,exits);
 const before=cellInventory(grid),opened={...e,closedLanes:[0],settings:{...e.settings,speedKmh:60}};
 const lengths=new Set(),layouts=new Set();let mixed=0;
 for(let t=0;t<65;t++){
  grid=advanceCells(grid,route,[opened],1400,exits);
  if(t<20)continue;
  const bands=cellSpeedBands(grid);if(new Set(bands.map(b=>b.color)).size>=3)mixed++;
  for(const band of bands)lengths.add(Math.round((band.toM-band.fromM)/grid.cellM));
  layouts.add(bands.map(b=>[Math.round(b.fromM/grid.cellM),Math.round(b.toM/grid.cellM),b.color].join(':')).join('|'));
 }
 assert.ok(mixed>=5,'simultaneous orange/red/dark-red sections should occur after release');
 assert.ok(lengths.size>=5,'sections must have different lengths');
 assert.ok(layouts.size>=20,'the density pattern must move and change over time');
 assert.ok(cellInventory(grid)<before-500,'two open lanes and lower inflow must drain conserved vehicles');
});
