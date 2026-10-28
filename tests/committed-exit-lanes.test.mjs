import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {initialiseCells,advanceCells,cellInventory,cellSpeedBands,assertCellConservation} from '../dist/traffic-cells.js';
import {diversionJunctions} from '../dist/diversions.js';
import {buildRampConnections} from '../dist/interchange.js';
import {journeyTrafficShare} from '../dist/interchange-journeys.js';
import {defaultDemands} from '../dist/traffic.js';
import {automaticDiversions} from '../dist/auto-diversions.js';
import {advanceRoutedNetwork,remainingInterchangeDemands} from '../dist/routed-traffic.js';
import {emptyDetour,detourVehicles} from '../dist/detour-flow.js';
import {bundledDetourGeometry,isNetworkDestination} from '../dist/bundled-detours.js';

const routes=makeCorridors(networkData.roads,networkData.ramps),{exits}=networkData,links=buildRampConnections(networkData.ramps,routes);
const paths=Object.keys(routes).filter(p=>!p.startsWith('ramp-')),base=defaultDemands();
const junction=(path,ref)=>diversionJunctions(path,exits,routes[path]).find(j=>j.ref===ref);
function closure(rampOnly=false){
 const path=rampOnly?'ramp-a48-to-frankfurt':'A3-frankfurt';
 const link=links.find(l=>l.rampId==='ramp-a48-to-frankfurt');
 const at=rampOnly?routes[path].lengthM*.3:(link.downstreamMergeM+junction(path,'40').metre)/2;
 const lanes=rampOnly?2:3;
 return {id:'destination-closed',kind:'closure',pathKey:path,point:routeSlice(routes[path],at,at+1)[0],laneCount:lanes,
  closedLanes:Array.from({length:lanes},(_,i)=>i),createdAt:'2026-10-27T19:00:00Z',settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}};
}
function prepare(cells,event){return automaticDiversions([event],routes,exits,cells,links).map(o=>{
 const config={id:o.key,path:o.path,targetPath:o.targetPath,fromM:o.from.metre,toM:o.to.metre,
  eventId:o.event?.id??o.causeId??o.key,sourceEndM:o.sourceEndM,targetEntryM:o.targetEntryM,movementId:o.movementId,journey:o.journey,
  exitsNetwork:isNetworkDestination(o.to),geometry:o.geometry??bundledDetourGeometry(o.key,o.path,o.from,o.to,exits)};
 return {config,state:emptyDetour(config)};
});}
test('an alternate motorway journey uses the configured turn budget, not half of a larger A48 stream',()=>{
 // Keep the overbooked-source regression independent of editable UI defaults.
 const profile={...base,'ramp-a48-to-frankfurt':700,'ramp-a48-to-koeln':700};
 const cells=Object.fromEntries(paths.map(p=>[p,initialiseCells(routes[p],profile[p])])),entries=prepare(cells,closure());
 const via=entries.find(e=>e.config.journey?.kind==='via');assert.ok(via);
 assert.equal(journeyTrafficShare(via.config,profile),700/2400);
 assert.equal(journeyTrafficShare(via.config,{...profile,'ramp-a48-to-frankfurt':0}),0);
 assert.equal(journeyTrafficShare(via.config,{...profile,'A48-dernbach':0}),0);
 assert.equal(journeyTrafficShare(via.config,{...profile,'A48-dernbach':800,'ramp-a48-to-frankfurt':300,'ramp-a48-to-koeln':500}),.375);
 assert.equal(journeyTrafficShare(via.config,{...profile,'A48-dernbach':1000}),.5,'overbooked turn settings cannot allocate more than the real source');
});

test('a blocked committed off-ramp queue occupies one lane while ordinary Cologne traffic still passes',()=>{
 const path='A3-koeln',route=routes[path],as=junction(path,'38'),token='selected-Frankfurt',id='continuation';
 let grid=initialiseCells(route,4200);
 for(const c of grid.cells)if(c.toM<as.metre&&c.fromM>as.metre-2000){
  const queued=125*(c.toM-c.fromM)/1000;c.vehicles+=queued;c.routedVehicles={[token]:queued};c.densityVehKm=c.vehicles/(grid.cellM/1000);
 }
 grid.initialVehicles=cellInventory(grid);const initialTags=grid.cells.reduce((n,c)=>n+(c.routedVehicles?.[token]??0),0);
 const port={id,fromM:as.metre,toM:null,interestPercent:100,vehicleClass:token,exitCapacityVph:0,returnVehicles:0};
 const downstream=grid.cells.findIndex(c=>c.fromM>as.metre+600);let minThrough=Infinity;
 for(let minute=0;minute<30;minute++){
  grid=advanceCells(grid,route,[],4200,exits,[port]);assertCellConservation(grid);
  const ramp=grid.junctions.find(j=>j.ref==='38');
  assert.equal(ramp.entryAvoidancePercent,0,'these local Cologne trips are not the committed Frankfurt cohort');
  assert.ok(ramp.lastEntered>0,'a stale continuation cannot suppress normal entry');
  const waiting=grid.cells.reduce((n,c)=>n+(c.routedVehicles?.[token]??0),0)+(ramp.exitQueue.detours[id]??0);
  assert.ok(Math.abs(waiting-initialTags)<1e-6,'blocked exit cars remain in real cell or ramp inventory');
  assert.ok(grid.cells.every(c=>(c.routedVehicles?.[token]??0)<=130*grid.cellM/1000+1e-5));
  assert.ok(grid.cells.filter(c=>c.fromM>as.metre+300).every(c=>(c.routedVehicles?.[token]??0)<1e-6));
  if(minute>10)minThrough=Math.min(minThrough,grid.cells[downstream].flowVph);
 }
 assert.ok(minThrough>3000,'a stopped exit cohort must not impose its near-zero service on all through lanes');
 const before=grid.divertedTotal;
 for(let minute=0;minute<100;minute++)grid=advanceCells(grid,route,[],4200,exits,[{...port,exitCapacityVph:1800}]);
 const remaining=grid.cells.reduce((n,c)=>n+(c.routedVehicles?.[token]??0),0)+grid.junctions.reduce((n,j)=>n+(j.exitQueue?.detours[id]??0),0);
 assert.ok(remaining<1e-6);assert.ok(Math.abs(grid.divertedTotal-before-initialTags)<1e-5);
 assert.equal(cellSpeedBands(grid).length,0,'reopening restores the ordinary free-flow state');assertCellConservation(grid);
});

for(const rampOnly of [true,false])test(`${rampOnly?'Frankfurt ramp':'Frankfurt arm'} closure: a small A48 cohort never captures ordinary A3 traffic and finishes after release`,()=>{
 const demands={...base,'A48-dernbach':800,'ramp-a48-to-frankfurt':300,'ramp-a48-to-koeln':500};
 let grids=Object.fromEntries(paths.map(p=>[p,initialiseCells(routes[p],demands[p])])),entries=prepare(grids,closure(rampOnly));
 const event=closure(rampOnly),via=entries.find(e=>e.config.journey?.kind==='via'),continuation=entries.find(e=>e.config.journey?.kind==='continuation');
 const token=via.config.journey.token,initial=Object.values(grids).reduce((n,g)=>n+cellInventory(g),0);
 let peakKm=0,peakAfter=0;
 for(let minute=0;minute<240;minute++){
  const events=minute<60?[event]:[];
  const next=advanceRoutedNetwork(grids,routes,events,demands,exits,entries);grids=next.cells;entries=next.detours;
  const source=entries.find(e=>e.config.id===via.config.id),target=entries.find(e=>e.config.id===continuation.config.id),grid=grids['A3-koeln'];
  const owned=grid.cells.reduce((n,c)=>n+(c.routedVehicles?.[token]??0),0)+grid.junctions.reduce((n,j)=>n+(j.exitQueue?.detours[continuation.config.id]??0),0);
  assert.ok(Math.abs(source.state.returnedTotal-target.state.admittedTotal-owned)<1e-5,'only returned A48 cars may take this continuation');
  assert.ok(grid.junctions.find(j=>j.ref==='38').lastEntered>0);
  const total=Object.values(grids).reduce((n,g)=>n+cellInventory(g)+g.exitedTotal-g.offeredTotal,0)+
   entries.reduce((n,e)=>n+detourVehicles(e.state)+(e.state.exitedNetworkTotal??0),0);
  assert.ok(Math.abs(total-initial)<1e-5,'one A3/A48/side-road vehicle ledger');
  const km=cellSpeedBands(grid).reduce((n,b)=>n+b.toM-b.fromM,0)/1000;
  if(minute<60)peakKm=Math.max(peakKm,km);else peakAfter=Math.max(peakAfter,km);
  if(minute===59)assert.equal(remainingInterchangeDemands(demands,entries,events)['ramp-a48-to-frankfurt'],0,
   'a fully rerouted turn is not duplicated in the legacy ramp solver');
 }
 assert.ok(peakKm<3&&peakAfter<4,'a small selected A48 stream cannot collapse the whole Cologne carriageway');
 const completed=entries.find(e=>e.config.id===continuation.config.id),source=entries.find(e=>e.config.id===via.config.id);
 assert.ok(completed.state.returnedTotal>50);assert.ok(detourVehicles(source.state)<1e-5&&detourVehicles(completed.state)<1e-5);
 assert.ok(grids['A3-koeln'].cells.every(c=>(c.routedVehicles?.[token]??0)<1e-5));
 assert.equal(cellSpeedBands(grids['A3-koeln']).length,0);
});
