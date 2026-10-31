import {junctionAccess} from '../dist/road-controls.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {DIRECTIONS} from '../dist/core.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {diversionJunctions} from '../dist/diversions.js';
import {bundledExitRoutes,bundledDetourGeometry,isNetworkDestination} from '../dist/bundled-detours.js';
import {automaticDiversions} from '../dist/auto-diversions.js';
import {initialiseCells,advanceCells,cellInventory,cellQueueSpans,assertCellConservation} from '../dist/traffic-cells.js';
import {routedDiversionChoice} from '../dist/diversion-policy.js';
import {emptyDetour,detourVehicles} from '../dist/detour-flow.js';
import {advanceRoutedPath} from '../dist/routed-traffic.js';
import {speedDelayInCells} from '../dist/speed-delay.js';
import {trafficView} from '../dist/traffic-view.js';
import {buildRampConnections} from '../dist/interchange.js';

const routes=makeCorridors(networkData.roads,networkData.ramps),{exits}=networkData;
function prepare(events,cells={}){return automaticDiversions(events,routes,exits,cells).map(p=>{
 const config={id:p.key,path:p.path,fromM:p.from.metre,toM:p.to.metre,eventId:p.event?.id??p.causeId,
  geometry:bundledDetourGeometry(p.key,p.path,p.from,p.to,exits),exitsNetwork:isNetworkDestination(p.to)};
 return {config,state:emptyDetour(config)};
});}
function queue(path,tail,head,delay){
 const grid=initialiseCells(routes[path],2000),selected=grid.cells.filter(c=>c.toM>tail&&c.fromM<head);
 const km=selected.length*grid.cellM/1000,speed=60*km/(delay+60*km/130);
 for(const c of selected){c.densityVehKm=100;c.vehicles=100*grid.cellM/1000;c.speedKmh=speed;c.flowVph=speed*100;}
 grid.initialVehicles=cellInventory(grid);return grid;
}

// Every regular directional AS is exercised. No example AS is special.
for(const path of DIRECTIONS)for(const {from,to} of bundledExitRoutes(path,exits,routes[path])){
 for(const kind of ['accident','roadworks','breakdown',null]){
  test(`${path} AS ${from.ref} ${kind??'natural congestion'}: only the nearest exit before this jam diverts`,()=>{
   const route=routes[path],nextExit=diversionJunctions(path,exits,route).find(j=>j.metre>from.metre+1&&junctionAccess(route,[],j.metre,j.ref).exit);
   const end=Math.min(to.metre,nextExit?.metre??to.metre),head=from.metre+(end-from.metre)*.7;
   const tail=from.metre+(head-from.metre)*.5,laneCount=path.startsWith('A48')?2:3;
   const event=kind?{id:'any-'+path+'-'+from.ref,kind,pathKey:path,point:routeSlice(route,head,head+1)[0],
    laneCount,closedLanes:Array.from({length:laneCount-1},(_,i)=>i),createdAt:'2026-10-25T09:00:00Z',
    settings:{lengthM:Math.min(100,(to.metre-head)/2),speedKmh:40,shoulder:'normal'}}:null;
   const grid=queue(path,tail,head,120),events=event?[event]:[],entries=prepare(events,{[path]:grid});
   const choices=entries.map(e=>({entry:e,...routedDiversionChoice(e,entries,{[path]:grid},routes,events,exits,{[path]:2000})}));
   const selected=choices.filter(c=>c.percent>0);
   assert.deepEqual(selected.map(c=>c.entry.config.geometry.sourceExitRef),[from.ref]);
   assert.ok(selected[0].percent<=5&&!selected[0].mandatory,'a newly selected exit starts gradually');
   for(const c of choices)if(c.entry.config.fromM<from.metre-25)assert.equal(c.percent,0,'remote exit must stay normal');
   const next=advanceRoutedPath(grid,route,events,2000,exits,entries);
   assert.ok(next.detours.find(e=>e.config.geometry.sourceExitRef===from.ref).state.lastDeparture>0);
   assert.ok(next.detours.filter(e=>e.config.fromM<from.metre-25).every(e=>e.state.admittedTotal===0));
   for(const local of next.cells.junctions.filter(j=>j.metre<from.metre-25))assert.equal(local.entryAvoidancePercent,0);
   assertCellConservation(next.cells);
  });
 }
}

test('a high delay at Montabaur–Dernbach cannot send a free Limburg-Süd approach off the motorway',()=>{
 const path='A3-koeln',route=routes[path],js=diversionJunctions(path,exits,route);
 const montabaur=js.find(j=>j.ref==='40'),dernbach=js.find(j=>j.ref==='39');
 const at=(montabaur.metre+dernbach.metre)/2;
 const event={id:'reported-remote-exit',kind:'accident',pathKey:path,point:routeSlice(route,at,at+1)[0],
  laneCount:3,closedLanes:[0,1,2],createdAt:'2026-10-25T09:00:00Z',
  settings:{lengthM:100,speedKmh:0,shoulder:'blocked',clearanceMin:300}};
 let grid=initialiseCells(route,2000),entries=prepare([event]);
 const initial=cellInventory(grid);
 for(let minute=0;minute<90;minute++){
  const next=advanceRoutedPath(grid,route,[event],2000,exits,entries);grid=next.cells;entries=next.detours;
  const sud=entries.find(e=>e.config.geometry.sourceExitRef==='43');
  assert.equal(sud.desiredPercent,0);assert.equal(sud.state.admittedTotal,0);
  const local=grid.junctions.find(j=>j.ref==='43');
  assert.equal(local.entryAvoidancePercent,0);
  assert.ok(Math.abs(local.lastEntered*60-140)<1e-6,'ordinary trips at the remote AS continue');
  assert.ok(Math.abs(cellInventory(grid)+entries.reduce((n,e)=>n+detourVehicles(e.state),0)+grid.exitedTotal-initial-grid.offeredTotal)<1e-5);
 }
 assert.ok(entries.some(e=>e.state.admittedTotal>0));assertCellConservation(grid);
});

test('independent short exit queues do not inherit the main incident delay and recursively activate distant AS',()=>{
 const path='A3-frankfurt',route=routes[path],js=diversionJunctions(path,exits,route),at=js.find(j=>j.ref==='42').metre+500;
 const event={id:'local-not-global',kind:'accident',pathKey:path,point:routeSlice(route,at,at+1)[0],
  laneCount:3,closedLanes:[0,1],createdAt:'2026-10-25T09:00:00Z',settings:{lengthM:100,speedKmh:40,shoulder:'normal'}};
 const grid=queue(path,at-200,at,120),entries=prepare([event]);
 for(const ref of ['38','40','41']){
  const at=js.find(j=>j.ref===ref).metre;
  for(const c of grid.cells)if(c.fromM>at-800&&c.toM<at){
   c.densityVehKm=180;c.vehicles=180*grid.cellM/1000;c.speedKmh=5;c.flowVph=900;
  }
 }
 const selected=entries.filter(e=>routedDiversionChoice(e,entries,{[path]:grid},routes,[event],exits,{[path]:2000}).percent>0);
 assert.deepEqual(selected.map(e=>e.config.geometry.sourceExitRef),['42']);
});

test('a short detached exit queue cannot borrow a distant active 300-minute accident forecast',()=>{
 const path='A3-koeln',route=routes[path],js=diversionJunctions(path,exits,route);
 const at=(js.find(j=>j.ref==='40').metre+js.find(j=>j.ref==='39').metre)/2;
 const event={id:'forecast-scope',kind:'accident',pathKey:path,point:routeSlice(route,at,at+1)[0],laneCount:3,
  closedLanes:[0,1,2],createdAt:'2026-10-25T09:00:00Z',settings:{lengthM:100,speedKmh:0,shoulder:'blocked',clearanceMin:300}};
 let grid=initialiseCells(route,2000);
 for(let i=0;i<10;i++)grid=advanceCells(grid,route,[event],2000,exits);
 const diez=js.find(j=>j.ref==='41').metre;
 for(const c of grid.cells)if(c.fromM>diez-800&&c.toM<diez-100){
  c.densityVehKm=180;c.vehicles=180*grid.cellM/1000;c.speedKmh=5;c.flowVph=900;c.travelFlowVph=900;
 }
 const local=cellQueueSpans(grid).find(s=>s.toM<diez);
 assert.ok(local);
 assert.ok(speedDelayInCells(grid,local.fromM,local.toM).delayMin<45,'unbounded callers also keep an independent local queue local');
 assert.equal(speedDelayInCells(grid).forecastWaitMin,300,'the complete journey still includes the real downstream block');
 assert.ok(speedDelayInCells(grid,local.fromM,local.toM,local.toM+grid.cellM).delayMin<45);
 const entries=prepare([event]);
 const nord=entries.find(e=>e.config.geometry.sourceExitRef==='42');
 assert.equal(routedDiversionChoice(nord,entries,{[path]:grid},routes,[event],exits,{[path]:2000}).percent,0);
 const view=trafficView([],{[path]:grid},routes,[event],[],grid.minute);
 const card=view.jams.find(j=>j.anchorM<diez);
 assert.ok(card&&card.delay.delayMin<45&&card.delay.forecastWaitMin===undefined);
 assert.ok(view.jams.some(j=>j.delay.forecastWaitMin===300),'the real accident keeps its own forecast');
});

test('a released stop-and-go cell retains queue membership briefly; a permanent free gap separates jams',()=>{
 const path='A3-koeln',route=routes[path],grid=queue(path,20000,23000,90),index=210;
 const gap=grid.cells[index];gap.densityVehKm=10;gap.vehicles=10*grid.cellM/1000;gap.speedKmh=130;
 gap.queueMemoryMin=3;assert.equal(cellQueueSpans(grid).length,1);
 gap.queueMemoryMin=0;assert.equal(cellQueueSpans(grid).length,2);
 // The memory is advanced only by model time; repeated snapshots are pure.
 gap.queueMemoryMin=3;const snapshot=structuredClone(grid);
 for(let i=0;i<10;i++)cellQueueSpans(grid);
 assert.deepEqual(grid,snapshot);
 grid.initialVehicles=cellInventory(grid);
 let cleared=grid;
 for(let i=0;i<8;i++)cleared=advanceCells(cleared,route,[],0,[],[],[]);
 assert.equal(cleared.cells[index].queueMemoryMin,0);
});

for(const loss of [25,90])test(`two independent ${loss}-minute jams use their own delay and nearest exit`,()=>{
 const path='A3-koeln',route=routes[path],js=diversionJunctions(path,exits,route),grid=initialiseCells(route,2000);
 for(const ref of ['40','38']){
  const from=js.find(j=>j.ref===ref).metre,part=queue(path,from+500,from+1500,loss);
  for(let i=0;i<grid.cells.length;i++)if(part.cells[i].speedKmh<65)grid.cells[i]=part.cells[i];
 }
 grid.initialVehicles=cellInventory(grid);
 const plans=automaticDiversions([],routes,exits,{[path]:grid});
 if(loss<45)assert.equal(plans.length,0,'two short queues cannot borrow the combined direction-wide delay');
 else{
  assert.deepEqual(plans.map(p=>p.from.ref).sort(),['38','40']);
  const entries=prepare([],{[path]:grid});
  assert.deepEqual(entries.filter(e=>routedDiversionChoice(e,entries,{[path]:grid},routes,[],exits,{[path]:2000}).percent>0)
   .map(e=>e.config.geometry.sourceExitRef).sort(),['38','40']);
 }
});

test('a natural queue on the target motorway recruits only the nearest approaching AS on the other branch',()=>{
 const path='A3-frankfurt',source='A48-dernbach',route=routes[path];
 const connection=buildRampConnections(networkData.ramps,routes).find(c=>c.rampId==='ramp-a48-to-frankfurt');
 const grid=queue(path,connection.downstreamMergeM+500,connection.downstreamMergeM+2000,90);
 const cells={[path]:grid,[source]:initialiseCells(routes[source],2000)};
 const cross=automaticDiversions([],routes,exits,cells,[connection]).filter(p=>p.path===source);
 assert.deepEqual(cross.map(p=>p.from.ref),['12']);
 const entries=cross.map(p=>{
  const config={id:p.key,path:p.path,targetPath:p.targetPath,fromM:p.from.metre,toM:p.to.metre,
   sourceEndM:p.sourceEndM,targetEntryM:p.targetEntryM,eventId:p.causeId,
   geometry:bundledDetourGeometry(p.key,p.path,p.from,p.to,exits)};
  return {config,state:emptyDetour(config)};
 });
 assert.ok(routedDiversionChoice(entries[0],entries,cells,routes,[],exits,{[source]:2000,[path]:2000}).percent>0);
});
