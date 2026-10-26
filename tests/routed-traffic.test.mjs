import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice,emptySpatial,advanceSpatial,closureGate} from '../dist/spatial.js';
import {initialiseCells,advanceCells,cellInventory,cellSpeedBands,assertCellConservation} from '../dist/traffic-cells.js';
import {advanceRoutedPath,advanceRoutedNetwork} from '../dist/routed-traffic.js';
import {emptyDetour,detourVehicles} from '../dist/detour-flow.js';
import {defaultDemands} from '../dist/traffic.js';
import {automaticDiversions} from '../dist/auto-diversions.js';
import {diversionJunctions,potentialDiversionPercent} from '../dist/diversions.js';
import {buildRampConnections} from '../dist/interchange.js';
const routes=makeCorridors(networkData.roads,networkData.ramps),exits=networkData.exits;
const links=buildRampConnections(networkData.ramps,routes),path='A3-frankfurt',route=routes[path];
const junction=(key,ref)=>diversionJunctions(key,exits,routes[key]).find(j=>j.ref===ref);
function event(at,kind='accident',closed=[0,1],speed=40){return {
 id:'waves-test',kind,pathKey:path,point:routeSlice(route,at,at+2)[0],laneCount:3,closedLanes:closed,
 createdAt:'2026-10-22T16:00:00Z',settings:{lengthM:100,speedKmh:speed,shoulder:kind==='closure'?'blocked':'normal'}};}
function detour(id,fromM,toM,targetPath=path){const geometry={id,path,sourceExitRef:'38',targetExitRef:'41',
 points:[[50.5,7.7],[50.51,7.72]],lengthKm:12,freeMinutes:8,roadCapacityVph:800,
 junctionCount:2,trafficLightCount:0,source:'osm-routed-infill',relationId:null,label:'Test fixture'};
 const config={id,path,fromM,toM,eventId:'waves-test',geometry,...(targetPath!==path?{targetPath}:{})};
 return {config,state:emptyDetour(config)};}
test('real bottleneck discharge and local speeds vary while every vehicle is conserved',()=>{
 const incident=event(route.lengthM*.55),flows=[],speeds=new Set();
 let state=initialiseCells(route,3900);
 for(let i=0;i<80;i++){
  state=advanceCells(state,route,[incident],3900,exits);assertCellConservation(state);
  if(i>30){flows.push(state.dischargeVph);for(const b of cellSpeedBands(state))speeds.add(b.color);}
 }
 assert.ok(Math.max(...flows)>Math.min(...flows)*1.5,JSON.stringify(flows));
 assert.ok(speeds.size>=2,'platoons must alter real local speeds, not paint identical cells');
 assert.ok(state.cells.some(c=>c.densityVehKm>100));
});
test('two reopened lanes discharge more and clear a long queue faster than keeping one lane',()=>{
 const incident=event(route.lengthM*.6);
 let initial=initialiseCells(route,3900);
 for(let i=0;i<105;i++)initial=advanceCells(initial,route,[incident],3900,exits);
 const opened={...incident,closedLanes:[0],settings:{...incident.settings,speedKmh:60}};
 let one=initial,two=initial,totalOne=0,totalTwo=0;
 for(let i=0;i<100;i++){
  one=advanceCells(one,route,[incident],1400,exits);
  two=advanceCells(two,route,[opened],1400,exits);
  totalOne+=one.dischargeVph;totalTwo+=two.dischargeVph;
 }
 const length=s=>cellSpeedBands(s).reduce((n,b)=>n+b.toM-b.fromM,0);
 assert.ok(totalTwo>totalOne*1.5,`${totalOne} / ${totalTwo}`);
 assert.ok(cellInventory(two)<cellInventory(one)-500);
 assert.ok(length(two)<length(one),'more throughput must reduce mapped congestion');
 assert.ok(two.cells.some(c=>c.speedKmh>30&&c.fromM<route.lengthM*.6),'release fronts must move back into the old jam');
});
test('multiple simultaneous exits remove only cars reaching those cells, then return them after travel',()=>{
 const at=junction(path,'38').metre+350,closure=event(at,'closure',[0,1,2],0);
 // The earlier exit needs 45 minutes of remaining delay; preparing its
 // geometry alone must never force drivers to use it.
 const last=closureGate(route,closure,exits).metre,previous=junction(path,'37').metre;
 let cells=initialiseCells(route,2400),detours=[detour('first',previous,route.lengthM*.8),detour('second',last,route.lengthM*.85)];
 for(const c of cells.cells)if(c.toM>previous-500&&c.fromM<last){
  c.densityVehKm=180;c.vehicles=180*(c.toM-c.fromM)/1000;c.speedKmh=4;c.flowVph=720;
 }
 cells.initialVehicles=cellInventory(cells);
 const initial=cellInventory(cells);let offered=0,departures=0;
 for(let t=0;t<90;t++){
  const before=cells;const next=advanceRoutedPath(cells,route,t<35?[closure]:[],t<35?2400:400,exits,detours);
  cells=next.cells;detours=next.detours;
  offered+=cells.offeredTotal-before.offeredTotal;departures+=cells.exitedTotal-before.exitedTotal;
  const total=cellInventory(cells)+detours.reduce((n,e)=>n+detourVehicles(e.state),0);
  assert.ok(Math.abs(total+departures-initial-offered)<1e-5);
  assert.ok(detours.every(e=>e.state.lastDeparture*60<=cells.junctions.find(j=>Math.abs(j.metre-e.config.fromM)<25).exitCapacityVph+1e-6));
 }
 assert.ok(detours.every(e=>e.state.admittedTotal>20),'both real exits must receive cars');
 assert.ok(detours.some(e=>e.state.returnedTotal>0));
});
test('an empty cell cannot create detached side-road vehicles, even at 100 percent desired diversion',()=>{
 const closure=event(route.lengthM*.6,'closure',[0,1,2],0);
 const state=initialiseCells(route,0),entry=detour('empty',route.lengthM*.2,route.lengthM*.8);
 const result=advanceRoutedPath(state,route,[closure],0,exits,[entry]);
 assert.equal(result.detours[0].state.admittedTotal,0);
 assert.equal(cellInventory(result.cells),0);
});
test('routes can load in advance without forcing low-delay traffic off the motorway',()=>{
 const incident=event(route.lengthM*.6),cells=initialiseCells(route,500);
 assert.ok(automaticDiversions([incident],routes,exits,{[path]:cells}).length>0);
 const result=advanceRoutedPath(cells,route,[incident],500,exits,[detour('prepare',route.lengthM*.2,route.lengthM*.8)]);
 assert.equal(result.detours[0].state.admittedTotal,0);
 assert.equal(result.cells.divertedTotal,0);
});
test('a disabled diversion retains its cars and lets all of them finish their journey',()=>{
 const closure=event(route.lengthM*.6,'closure',[0,1,2],0);
 let cells=initialiseCells(route,2300),entries=[detour('finish',closureGate(route,closure,exits).metre,route.lengthM*.8)];
 for(let t=0;t<15;t++){const next=advanceRoutedPath(cells,route,[closure],2300,exits,entries);cells=next.cells;entries=next.detours;}
 const admitted=entries[0].state.admittedTotal;assert.ok(admitted>20);
 entries=entries.map(e=>({...e,enabled:false}));
 for(let t=0;t<100;t++){const next=advanceRoutedPath(cells,route,[],500,exits,entries);cells=next.cells;entries=next.detours;}
 assert.equal(entries[0].state.admittedTotal,admitted);
 assert.ok(detourVehicles(entries[0].state)<1e-6);
 assert.ok(Math.abs(entries[0].state.returnedTotal-admitted)<1e-6);
});
test('extreme delay reaches 100 percent willingness and all feasible upstream exits are offered',()=>{
 assert.equal(potentialDiversionPercent(120,false),60);
 assert.equal(potentialDiversionPercent(180,false),100);
 assert.equal(potentialDiversionPercent(500,false),100);
 const a=junction(path,'41'),b=junction(path,'42'),e=event((a.metre+b.metre)/2,'closure',[0,1,2],0);
 const choices=automaticDiversions([e],routes,exits,{});
 const expected=diversionJunctions(path,exits,route).filter(j=>!j.isInterchange&&j.metre<(a.metre+b.metre)/2-50);
 assert.equal(choices.length,expected.length);assert.ok(choices.length>3);
 assert.ok(choices.every(c=>c.to.metre>c.from.metre&&!c.from.isInterchange&&!c.to.isInterchange));
 assert.ok(choices.some(c=>c.link.code==='SIM'),'missing official U-routes still need a real-route request');
});
test('an A3 queue reaching AD Dernbach offers A48 exits including Höhr to rejoin after the incident',()=>{
 const connection=links.find(c=>c.rampId==='ramp-a48-to-frankfurt');
 const at=connection.downstreamMergeM+1000,e=event(at);
 const cells=initialiseCells(route,3000);
 for(const c of cells.cells)if(c.fromM<=at&&c.toM>=connection.downstreamMergeM-1000){c.speedKmh=5;c.densityVehKm=160;c.vehicles=160*(c.toM-c.fromM)/1000;}
 const choices=automaticDiversions([e],routes,exits,{[path]:cells},links).filter(c=>c.path==='A48-dernbach'&&!c.from.isInterchange);
 assert.deepEqual(choices.map(c=>c.from.ref).sort(),['10','11','12']);
 assert.ok(choices.every(c=>c.targetPath===path&&c.to.metre>at));
});
test('cross-motorway detours leave A48 and return on A3 exactly once with global conservation',()=>{
 const source='A48-dernbach',a=junction(source,'12'),target=junction(path,'41');
 const connection=links.find(c=>c.rampId==='ramp-a48-to-frankfurt');
 const closure=event(connection.downstreamMergeM+5000,'accident',[0,1,2],0);
 const geometry={id:'cross',path:source,sourceExitRef:'12',targetExitRef:'41',points:[[50.5,7.7],[50.4,7.9]],
 lengthKm:18,freeMinutes:10,roadCapacityVph:900,junctionCount:3,trafficLightCount:1,source:'osm-routed-infill',relationId:null,label:'Cross test fixture'};
 const config={id:'cross',path:source,targetPath:path,fromM:a.metre,toM:target.metre,
 sourceEndM:connection.rampEntryM,targetEntryM:connection.downstreamMergeM,eventId:closure.id,geometry};
 let congested=initialiseCells(route,1500);
 for(let i=0;i<60;i++)congested=advanceCells(congested,route,[closure],1500,exits);
 const sourceGrid=initialiseCells(routes[source],2000);sourceGrid.minute=congested.minute;
 let entries=[{config,state:emptyDetour(config)}],cells={[source]:sourceGrid,[path]:congested};
 const demands={...defaultDemands(),[source]:2000,[path]:1500};
 for(let minute=0;minute<55;minute++){
  const next=advanceRoutedNetwork(cells,routes,[closure],demands,exits,entries);cells=next.cells;entries=next.detours;
 }
 assert.ok(cells[source].divertedTotal>100);
 assert.ok(cells[path].rejoinedTotal>50);
 assert.equal(cells[path].divertedTotal,0);
 assert.equal(cells[source].rejoinedTotal,0);
 assert.ok(Math.abs(cells[source].divertedTotal-entries[0].state.admittedTotal)<1e-6);
 assert.ok(Math.abs(cells[path].rejoinedTotal-entries[0].state.returnedTotal)<1e-6);
});

test('ramp backpressure follows cleared physical mainline cells rather than a stale legacy jam',()=>{
 const key='A3-koeln',road=routes[key],link=links.find(l=>l.rampId==='ramp-a48-to-koeln');
 const at=link.downstreamMergeM+2000;
 const closure={...event(route.lengthM*.6,'accident',[0,1,2],0),pathKey:key,point:routeSlice(road,at,at+2)[0]};
 const demands=defaultDemands();let state=emptySpatial();
 for(let i=0;i<90;i++)state=advanceSpatial(state,[closure],demands,1,routes,links,[],exits);
 const id='merge:'+link.rampId;assert.ok(state.queues[id]?.vehicles>50);
 const before=state.queues[id].vehicles;
 const free=advanceSpatial(state,[],demands,1,routes,links,[],exits,[]);
 assert.ok((free.queues[id]?.vehicles??0)<before,'unblocked physical merge must discharge its old ramp queue');
});
