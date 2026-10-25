import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice,positionM,closureGate} from '../dist/spatial.js';
import {normalJunctionTraffic} from '../dist/junction-traffic.js';
import {initialiseCells,advanceCells,cellInventory,cellSpeedBands,assertCellConservation} from '../dist/traffic-cells.js';
import {automaticDiversions} from '../dist/auto-diversions.js';
import {bundledDetourGeometry,isNetworkDestination} from '../dist/bundled-detours.js';
import {emptyDetour,detourVehicles} from '../dist/detour-flow.js';
import {advanceRoutedNetwork} from '../dist/routed-traffic.js';
import {junctionMovements} from '../dist/junction-movements.js';
import {diversionJunctions} from '../dist/diversions.js';
import {defaultDemands} from '../dist/traffic.js';
const routes=makeCorridors(networkData.roads,networkData.ramps),{exits}=networkData;
const paths=['A3-koeln','A3-frankfurt','A48-dernbach','A48-koblenz'];
const anchor=(path,ref)=>diversionJunctions(path,exits,routes[path]).find(j=>j.ref===ref);
function closed(path,a,b,lengthM=200){
 const from=anchor(path,a).metre,to=anchor(path,b).metre,at=(from+to)/2,laneCount=path.startsWith('A48')?2:3;
 return {id:'ordinary-test',kind:'closure',pathKey:path,point:routeSlice(routes[path],at,at+1)[0],
  laneCount,closedLanes:Array.from({length:laneCount},(_,i)=>i),createdAt:'2026-10-23T12:00:00Z',
  settings:{lengthM,speedKmh:0,shoulder:'blocked'}};
}
function prepare(event){return automaticDiversions([event],routes,exits,{}).map(option=>{
 const config={id:option.key,path:option.path,fromM:option.from.metre,toM:option.to.metre,eventId:event.id,
  geometry:bundledDetourGeometry(option.key,option.path,option.from,option.to,exits),exitsNetwork:isNetworkDestination(option.to)};
 return {config,state:emptyDetour(config)};
});}
function checkLocal(state){
 for(const j of state.junctions??[]){
  assert.ok(j.waiting>=0&&j.lastEntered>=0&&j.lastExited>=0);
  assert.ok(Math.abs(j.waiting+j.enteredTotal-j.offeredTotal)<1e-6,j.id);
 }
 assertCellConservation(state);
}

test('all 26 directional ordinary AS have demand and actual local entry/exit; AK and AD have no fictitious local ramps',()=>{
 let count=0;
 for(const path of paths){
  const demand=path.startsWith('A48')?1800:2600,configs=normalJunctionTraffic(routes[path],exits,demand);
  count+=configs.length;assert.equal(configs.length,path.startsWith('A48')?3:10);
  let state=initialiseCells(routes[path],demand);
  for(let t=0;t<60;t++){state=advanceCells(state,routes[path],[],demand,exits);checkLocal(state);}
  assert.equal(state.junctions.length,configs.length);
  assert.ok(state.junctions.every(j=>j.lastEntered>0&&j.lastExited>0&&j.waiting<.001));
  assert.equal(cellSpeedBands(state).length,0,'balanced local trips must not fabricate a free-flow queue');
  assert.ok(Math.abs(state.cells.at(-1).flowVph-demand)<.01);
  const localOffered=state.junctions.reduce((n,j)=>n+j.offeredTotal,0);
  assert.ok(Math.abs(state.offeredTotal-demand-localOffered)<1e-6,'60 boundary minutes plus all ordinary AS arrivals');
  assert.equal(state.divertedTotal,0);assert.equal(state.rejoinedTotal,0,'ordinary entries are not detour returners');
  const rows=junctionMovements(path,routes[path],exits,[],0,[],state.junctions);
  assert.ok(rows.filter(r=>!r.exit.isInterchange).every(r=>r.outVph>0&&r.inVph>0&&r.diversionOutVph===0&&r.returningInVph===0));
  assert.ok(rows.filter(r=>r.exit.isInterchange).every(r=>r.outVph===0&&r.inVph===0));
 }
 assert.equal(count,26);
 for(const key of Object.keys(routes).filter(k=>k.startsWith('ramp-')))assert.deepEqual(normalJunctionTraffic(routes[key],exits,1500),[]);
});
test('changing the demand profile changes local arrivals too, and zero demand creates no vehicles',()=>{
 for(const path of paths){
  const high=normalJunctionTraffic(routes[path],exits,3000),low=normalJunctionTraffic(routes[path],exits,600);
  assert.ok(high.every((j,i)=>Math.abs(j.entryVph-low[i].entryVph*5)<1e-7));
  let zero=initialiseCells(routes[path],0);
  for(let t=0;t<4;t++)zero=advanceCells(zero,routes[path],[],0,exits);
  assert.equal(cellInventory(zero),0);assert.equal(zero.offeredTotal,0);
 }
});
test('ordinary on-ramp arrivals wait at a closed entry and are conserved through reopening',()=>{
 for(const [path,a,b] of [['A3-frankfurt','38','40'],['A48-dernbach','11','12']]){
  const event=closed(path,a,b),demand=2400;
  let state=initialiseCells(routes[path],demand);
  for(let t=0;t<20;t++){state=advanceCells(state,routes[path],[event],demand,exits);checkLocal(state);}
  const queue=state.junctions.find(j=>j.ref===a);
  assert.ok(queue.waiting>10);assert.equal(queue.enteredTotal,0);
  const oldOffered=queue.offeredTotal;
  state=advanceCells(state,routes[path],[],600,exits);
  const opened=state.junctions.find(j=>j.ref===a);
  assert.ok(opened.lastEntered>0);assert.ok(opened.offeredTotal>oldOffered);checkLocal(state);
  for(let t=0;t<80;t++){state=advanceCells(state,routes[path],[],600,exits);checkLocal(state);}
  assert.ok(state.junctions.find(j=>j.ref===a).waiting<.01,'waiting ramp cars must eventually join, not disappear');
 }
});
test('no ordinary entry can inject cars inside an administratively closed stretch',()=>{
 const path='A3-frankfurt',event=closed(path,'37','38',8000),at=positionM(routes[path],event.point);
 let state=initialiseCells(routes[path],2400);
 for(let t=0;t<8;t++)state=advanceCells(state,routes[path],[event],2400,exits);
 const gate=closureGate(routes[path],event,exits).metre;
 const within=state.junctions.filter(j=>j.metre>=gate-25&&j.metre<=at+event.settings.lengthM);
 assert.ok(within.length>=2);
 assert.ok(within.every(j=>j.enteredTotal===0&&j.waiting>0));
 assert.ok(state.junctions.filter(j=>j.metre>at+event.settings.lengthM).every(j=>j.enteredTotal>0));
 checkLocal(state);
});
test('normal departures and mandatory diversion share the one off-ramp capacity and stay separately counted',()=>{
 const path='A3-frankfurt',event=closed(path,'38','40'),demands={...defaultDemands(),[path]:5000};
 let cells={[path]:initialiseCells(routes[path],5000)},entries=prepare(event);
 const initial=cellInventory(cells[path]);
 for(let t=0;t<35;t++){
  const next=advanceRoutedNetwork(cells,routes,[event],demands,exits,entries);cells=next.cells;entries=next.detours;
  const row=cells[path].junctions.find(j=>j.ref==='38'),diverted=entries.filter(d=>d.config.geometry.sourceExitRef==='38').reduce((n,d)=>n+d.state.lastDeparture,0);
  assert.ok(row.lastExited>0&&diverted>0);
  assert.ok((row.lastExited+diverted)*60<=1200+1e-6);
  checkLocal(cells[path]);
  const inventory=cellInventory(cells[path])+entries.reduce((n,d)=>n+detourVehicles(d.state),0);
  const outside=entries.reduce((n,d)=>n+(d.state.exitedNetworkTotal??0),0);
  assert.ok(Math.abs(inventory+cells[path].exitedTotal+outside-initial-cells[path].offeredTotal)<1e-5);
 }
 const real=entries.map(d=>({path,fromM:d.config.fromM,toM:d.config.toM,eventId:event.id,desiredPercent:d.desiredPercent,
  outVph:d.state.lastDeparture*60,inVph:d.state.lastRejoined*60,vehiclesOnDetour:detourVehicles(d.state),waitingAtReentry:d.state.waitingMerge}));
 const shown=junctionMovements(path,routes[path],exits,[event],null,real,cells[path].junctions).find(r=>r.exit.ref==='38');
 assert.ok(shown.normalOutVph>0&&shown.diversionOutVph>0);
 assert.equal(shown.outVph,shown.normalOutVph+shown.diversionOutVph);
 assert.equal(shown.inVph,shown.normalInVph+shown.returningInVph);
 assert.equal(shown.desiredPercent,100);
});
test('local entrants and detour returners share receiving space and entrance capacity',()=>{
 const path='A3-frankfurt',route=routes[path],as=anchor(path,'40');
 const demand={id:path+':local:40',ref:'40',metre:as.metre,entryVph:1800,exitPercent:0,entryCapacityVph:900,exitCapacityVph:1200};
 const port={id:'return',fromM:null,toM:as.metre,interestPercent:0,exitCapacityVph:0,returnVehicles:100};
 const state=advanceCells(initialiseCells(route,0),route,[],0,exits,[port],[demand]);
 const joined=state.lastTransfers[0].joinVpm,ordinary=state.junctions[0];
 assert.ok(joined>0&&ordinary.lastEntered>0);
 assert.ok((joined+ordinary.lastEntered)*60<=900+1e-6);
 assert.ok(ordinary.waiting>0);checkLocal(state);
});
test('stopping new demand keeps the existing on-ramp inventory',()=>{
 const path='A3-frankfurt',event=closed(path,'38','40');
 let state=initialiseCells(routes[path],2200);
 for(let t=0;t<10;t++)state=advanceCells(state,routes[path],[event],2200,exits);
 const offered=state.junctions.reduce((n,j)=>n+j.offeredTotal,0);
 state=advanceCells(state,routes[path],[],0,exits,[],[]);
 assert.ok(state.junctions.some(j=>j.enteredTotal>0));
 assert.equal(state.junctions.reduce((n,j)=>n+j.offeredTotal,0),offered);checkLocal(state);
});
test('the mobile AS UI labels normal flows, additional diversion, returners and entrance waiting',()=>{
 const app=readFileSync('src/app.ts','utf8'),html=readFileSync('index.html','utf8');
 assert.match(app,/normalOutVph/);assert.match(app,/normalInVph/);assert.match(app,/diversionOutVph/);assert.match(app,/returningInVph/);
 assert.match(app,/warten auf der Auffahrt/);assert.match(html,/ab 45 Minuten/i);
 assert.doesNotMatch(app,/normale Ein-\/Ausfahrten noch nicht/);
});
