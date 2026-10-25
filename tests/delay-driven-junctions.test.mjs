import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {diversionJunctions} from '../dist/diversions.js';
import {automaticDiversions} from '../dist/auto-diversions.js';
import {bundledDetourGeometry,isNetworkDestination} from '../dist/bundled-detours.js';
import {emptyDetour} from '../dist/detour-flow.js';
import {routedDiversionChoice} from '../dist/diversion-policy.js';
import {normalJunctionTraffic} from '../dist/junction-traffic.js';
import {initialiseCells,advanceCells,cellInventory,assertCellConservation} from '../dist/traffic-cells.js';
import {advanceRoutedPath} from '../dist/routed-traffic.js';
import {speedDelayInCells} from '../dist/speed-delay.js';

const routes=makeCorridors(networkData.roads,networkData.ramps),exits=networkData.exits;
const junction=(path,ref)=>diversionJunctions(path,exits,routes[path]).find(j=>j.ref===ref);
function prepare(event){return automaticDiversions([event],routes,exits,{}).map(p=>{
 const config={id:p.key,path:p.path,fromM:p.from.metre,toM:p.to.metre,eventId:event.id,
  geometry:bundledDetourGeometry(p.key,p.path,p.from,p.to,exits),exitsNetwork:isNetworkDestination(p.to)};
 return {config,state:emptyDetour(config)};
});}
function queue(route,tail,head,delay){
 const grid=initialiseCells(route,2000),selected=grid.cells.filter(c=>c.toM>tail&&c.fromM<head);
 const km=selected.length*grid.cellM/1000,speed=60*km/(delay+60*km/130);
 for(const c of selected){c.densityVehKm=90;c.vehicles=90*grid.cellM/1000;c.speedKmh=speed;c.flowVph=speed*90;}
 grid.initialVehicles=cellInventory(grid);return grid;
}

for(const [path,earlierRef,nearRef] of [['A3-koeln','40','38'],['A3-frankfurt','41','42'],
 ['A48-dernbach','11','12'],['A48-koblenz','12','11']]){
 for(const kind of ['accident','roadworks','breakdown']){
  test(`${path} ${kind}: delay triggers earlier exits and reduces entries before the queue reaches the next AS`,()=>{
   const route=routes[path],earlier=junction(path,earlierRef),near=junction(path,nearRef),at=near.metre+1000;
   const laneCount=path.startsWith('A48')?2:3;
   const event={id:'delay-only-'+path,kind,pathKey:path,point:routeSlice(route,at,at+1)[0],laneCount,
    closedLanes:Array.from({length:laneCount-1},(_,i)=>i),createdAt:'2026-10-25T09:00:00Z',
    settings:{lengthM:100,speedKmh:40,shoulder:'normal'}};
   const entries=prepare(event),entry=entries.find(e=>e.config.geometry.sourceExitRef===earlierRef);
   assert.ok(entry);
   const baseline=normalJunctionTraffic(route,exits,2000).find(j=>j.ref===earlierRef);
   const percentages=[];
   for(const delay of [44.9,45,60,90]){
    const pair=[];
    // Cross the intervening AS by 200 m while holding time loss fixed.
    // This must never switch the earlier AS from zero to a large share.
    for(const offset of [200,-200]){
     const grid=queue(route,near.metre+offset,at,delay);
     assert.ok(near.metre-earlier.metre>2000,'the earlier AS is kilometres before the queue');
     assert.ok(Math.abs(speedDelayInCells(grid).delayMin-delay)<1e-6);
     const choice=routedDiversionChoice(entry,entries,{[path]:grid},routes,[event],exits,{[path]:2000});
     pair.push(choice.percent);
     if(delay<45)assert.equal(choice.percent,0);
     else assert.ok(choice.percent>0&&choice.percent<50,'some drivers already divert; most stay');
     assert.equal(choice.mandatory,false);
     const next=advanceRoutedPath(grid,route,[event],2000,exits,entries);
     const actual=next.detours.find(e=>e.config.id===entry.config.id);
     const local=next.cells.junctions.find(j=>j.ref===earlierRef);
     assert.equal(actual.desiredPercent,choice.percent);
     if(delay>=45)assert.ok(actual.state.lastDeparture>0,'real vehicles leave without a tail-distance trigger');
     assert.ok(Math.abs(local.entryVph-baseline.entryVph*(1-choice.percent/100))<1e-6,
      'new local entry demand must follow the same avoidance decision');
     assert.ok(Math.abs(local.lastEntered*60-local.entryVph)<1e-6,'the free approach really receives the reduced rate');
     assertCellConservation(next.cells);
    }
    assert.equal(pair[0],pair[1],'moving the tail across the next AS must not change this exit decision');
    percentages.push(pair[0]);
   }
   assert.ok(percentages[1]<percentages[2]&&percentages[2]<percentages[3]);
  });
 }
}

test('entrance avoidance follows the requested share, even when the side road cannot admit more cars',()=>{
 const path='A3-koeln',route=routes[path],as=junction(path,'40');
 const demand=normalJunctionTraffic(route,exits,2000).find(j=>j.ref==='40');
 for(const percent of [0,2,30,60,100]){
  const state=advanceCells(initialiseCells(route,2000),route,[],2000,exits,[{
   id:'full-bypass',fromM:as.metre,toM:as.metre+2000,interestPercent:percent,exitCapacityVph:0,returnVehicles:0
  }],[demand]);
  const local=state.junctions[0];
  assert.equal(state.lastTransfers[0].leaveVpm,0);
  assert.ok(Math.abs(local.entryVph-demand.entryVph*(1-percent/100))<1e-6);
  assert.ok(Math.abs(local.lastEntered*60-local.entryVph)<1e-6);
  assertCellConservation(state);
 }
});

test('avoiding new entry never deletes an existing on-ramp queue or inhibits returners beyond the incident',()=>{
 const path='A3-frankfurt',route=routes[path],as=junction(path,'40');
 const demand=normalJunctionTraffic(route,exits,2000).find(j=>j.ref==='40');
 const grid=initialiseCells(route,2000);
 grid.junctions=[{...demand,waiting:10,offeredTotal:10,enteredTotal:0,exitedTotal:0,lastEntered:0,lastExited:0}];
 grid.offeredTotal=10;
 const state=advanceCells(grid,route,[],2000,exits,[{
  id:'avoid',fromM:as.metre,toM:as.metre+2000,interestPercent:100,exitCapacityVph:1200,returnVehicles:5
 }],[demand]);
 assert.equal(state.junctions[0].entryVph,0);
 assert.equal(state.junctions[0].offeredTotal,10);
 assert.ok(state.junctions[0].lastEntered>0);
 assert.ok(Math.abs(state.junctions[0].waiting+state.junctions[0].enteredTotal-10)<1e-6);
 assert.ok(state.lastTransfers[0].joinVpm>0,'returning cars still rejoin beyond the jam');
 assertCellConservation(state);
});

for(const [nearRef,earlierRef,interveningRef] of [['38','41','40'],['40','42','41']]){
 test(`A3 Köln: live roadworks after AS ${nearRef} trigger AS ${earlierRef} while AS ${interveningRef} is still free`,()=>{
  const path='A3-koeln',route=routes[path],at=junction(path,nearRef).metre+350,demand=3400;
  const event={id:'live-screenshot-'+nearRef,kind:'roadworks',pathKey:path,point:routeSlice(route,at,at+1)[0],
   laneCount:3,closedLanes:[0,1],createdAt:'2026-10-25T09:00:00Z',
   settings:{lengthM:100,speedKmh:40,shoulder:'normal'}};
  let state=initialiseCells(route,demand),entries=prepare(event),first=null;
  const baseline=normalJunctionTraffic(route,exits,demand).find(j=>j.ref===earlierRef);
  for(let minute=0;minute<180;minute++){
   const previous=state,next=advanceRoutedPath(state,route,[event],demand,exits,entries);
   state=next.cells;entries=next.detours;
   const entry=entries.find(e=>e.config.geometry.sourceExitRef===earlierRef);
   const local=state.junctions.find(j=>j.ref===earlierRef);
   assert.ok(Math.abs(local.entryVph-baseline.entryVph*(1-entry.desiredPercent/100))<1e-6);
   if(first===null&&entry.state.lastDeparture>0){
    first=state.minute;
    const between=junction(path,interveningRef).metre;
    const cell=previous.cells.find(c=>c.fromM<=between&&c.toM>between);
    assert.ok(cell.speedKmh>65,'an intervening free AS must not veto this departure');
    assert.ok(entry.desiredPercent>0&&entry.desiredPercent<5,'the first departures are gradual');
    assert.ok(local.lastEntered*60<baseline.entryVph,'real new entries fall at the same time');
   }
   assertCellConservation(state);
  }
  assert.notEqual(first,null,'vehicles must actually use the earlier exit');
 });
}
