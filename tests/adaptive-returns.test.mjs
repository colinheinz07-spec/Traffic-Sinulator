import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice,closureGate} from '../dist/spatial.js';
import {diversionJunctions} from '../dist/diversions.js';
import {automaticDiversions} from '../dist/auto-diversions.js';
import {bundledDetourGeometry,isNetworkDestination} from '../dist/bundled-detours.js';
import {emptyDetour,detourVehicles} from '../dist/detour-flow.js';
import {routedDiversionChoice} from '../dist/diversion-policy.js';
import {initialiseCells,cellInventory,assertCellConservation} from '../dist/traffic-cells.js';
import {advanceRoutedNetwork} from '../dist/routed-traffic.js';
import {defaultDemands} from '../dist/traffic.js';
const routes=makeCorridors(networkData.roads,networkData.ramps),{exits}=networkData;
const path='A3-koeln',route=routes[path],js=diversionJunctions(path,exits,route).filter(j=>!j.isInterchange);
const from=js.find(j=>j.ref==='38'),to=js.find(j=>j.ref==='37'),at=(from.metre+to.metre)/2;
const event={id:'adaptive-closure',kind:'closure',pathKey:path,point:routeSlice(route,at,at+1)[0],laneCount:3,
 closedLanes:[0,1,2],createdAt:'2026-10-31T08:00:00Z',settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}};
function queued(delay){
 const grid=initialiseCells(route,2000),head=closureGate(route,event,exits).metre;
 const cells=grid.cells.filter(c=>c.toM>head-1800&&c.fromM<head),length=cells.length*grid.cellM/1000;
 const speed=60*length/(delay+length/130*60);
 for(const c of cells){c.vehicles=200*grid.cellM/1000;c.densityVehKm=200;c.speedKmh=speed;c.flowVph=200*speed;c.travelFlowVph=200*speed;}
 grid.initialVehicles=cellInventory(grid);return grid;
}
function prepare(grid){return automaticDiversions([event],routes,exits,{[path]:grid}).map(o=>{
 const config={id:o.key,path:o.path,fromM:o.from.metre,toM:o.to.metre,eventId:o.event?.id??o.causeId,
  alternativeGroup:o.alternativeGroup,targetPath:o.targetPath,movementId:o.movementId,journey:o.journey,
  sourceEndM:o.sourceEndM,targetEntryM:o.targetEntryM,exitsNetwork:isNetworkDestination(o.to),
  geometry:o.geometry??bundledDetourGeometry(o.key,o.path,o.from,o.to,exits)};
 return {config,state:emptyDetour(config),enabled:true};
});}
const choice=(e,all,grid)=>routedDiversionChoice(e,all,{[path]:grid},routes,[event],exits,defaultDemands());
test('severe closure waits provide three feasible return junctions instead of one compulsory merge',()=>{
 const grid=queued(300),entries=prepare(grid),family=entries.filter(e=>Math.abs(e.config.fromM-from.metre)<25);
 assert.equal(family.length,3);
 assert.ok(family.every(e=>e.config.alternativeGroup));
 const choices=family.map(e=>choice(e,entries,grid));
 assert.ok(choices.every(c=>c.percent>0&&c.mandatory));
 assert.ok(Math.abs(choices.reduce((s,c)=>s+c.percent,0)-100)<1e-8,'all routes share ONE 100% decision');
});
test('a congested first return loses new trips to later returns, without deleting its old trips',()=>{
 const grid=queued(300),entries=prepare(grid),family=entries.filter(e=>Math.abs(e.config.fromM-from.metre)<25).sort((a,b)=>a.config.toM-b.config.toM);
 const first=family[0];first.state.waitingMerge=2000;first.state.admittedTotal=2000;
 const before=detourVehicles(first.state),choices=family.map(e=>choice(e,entries,grid));
 assert.ok(choices[0].percent<choices[1].percent&&choices[0].percent<10);
 assert.equal(detourVehicles(first.state),before,'route choice never deletes existing journeys');
});
test('extreme remaining delays allow two earlier exits; a normal one-hour queue stays local',()=>{
 for(const [delay,early] of [[60,false],[300,true]]){
  const grid=queued(delay),entries=prepare(grid);
  const nearest=js.filter(j=>j.metre<from.metre-1800).at(-1);
  const before=js.filter(j=>j.metre<nearest.metre-25).slice(-2);
  for(const j of before){
   const family=entries.filter(e=>Math.abs(e.config.fromM-j.metre)<25);
   assert.ok(family.length>0);
   assert.equal(family.some(e=>choice(e,entries,grid).percent>0),early,'AS '+j.ref+' at '+delay+' minutes');
  }
 }
});
test('distributed return journeys conserve vehicles and share the actual short off-ramp storage',()=>{
 let grid=queued(300),entries=prepare(grid),cells={[path]:grid};
 const balance=(g,es)=>cellInventory(g)+g.exitedTotal-g.offeredTotal+
  es.reduce((n,e)=>n+detourVehicles(e.state)+(e.state.exitedNetworkTotal??0),0);
 const before=balance(grid,entries);
 for(let i=0;i<10;i++){
  const next=advanceRoutedNetwork(cells,routes,[event],defaultDemands(),exits,entries);
  cells=next.cells;entries=next.detours;grid=cells[path];assertCellConservation(grid);
  assert.ok(Math.abs(balance(grid,entries)-before)<1e-5);
  for(const j of grid.junctions)assert.ok((j.exitQueue.normal+Object.values(j.exitQueue.detours).reduce((n,v)=>n+v,0))<=j.exitStorageVehicles+1e-6);
 }
 const used=entries.filter(e=>Math.abs(e.config.fromM-from.metre)<25&&e.state.admittedTotal>0);
 assert.ok(used.length>1,'later returns must carry actual vehicles');
});

test('a continuously fed weekend diversion keeps serving at its ramp terminal instead of filling the side-road ledger',()=>{
 let grid=initialiseCells(route,1800),entries=prepare(grid),cells={[path]:grid};
 const moment=new Date('2026-11-07T09:00:00+01:00');
 let min=Infinity,maxRoadQueue=0;
 for(let i=0;i<180;i++){
  const next=advanceRoutedNetwork(cells,routes,[event],{...defaultDemands(),[path]:1800},exits,entries,{},moment);
  cells=next.cells;entries=next.detours;grid=cells[path];
  const j=grid.junctions.find(j=>j.ref==='38');
  const own=entries.filter(e=>Math.abs(e.config.fromM-from.metre)<25);
  const flow=(j.lastExited+own.reduce((s,e)=>s+e.state.lastDeparture,0))*60;
  if(i>30)min=Math.min(min,flow);
  maxRoadQueue=Math.max(maxRoadQueue,...own.map(e=>e.state.waitingRoad));
 }
 assert.ok(min>800,'a full ramp with a usable receiving network must not collapse to 204/h: '+min);
 assert.ok(maxRoadQueue<1e-5,'the side-road service must keep up with admitted ramp trips: '+maxRoadQueue);
});
