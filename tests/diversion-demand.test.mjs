import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {initialiseCells,advanceCells,cellInventory,cellSpeedBands,assertCellConservation} from '../dist/traffic-cells.js';
import {freeSpeedKmh} from '../dist/traffic-physics.js';
import {speedDelayInCells} from '../dist/speed-delay.js';
import {diversionJunctions,potentialDiversionPercent} from '../dist/diversions.js';
import {automaticDiversions} from '../dist/auto-diversions.js';
import {bundledDetourGeometry,isNetworkDestination} from '../dist/bundled-detours.js';
import {emptyDetour,advanceDetour,detourVehicles} from '../dist/detour-flow.js';
import {advanceRoutedPath,detourReadyToReturn} from '../dist/routed-traffic.js';
import {routedDiversionChoice,voluntaryDiversionPercent} from '../dist/diversion-policy.js';
import {defaultDemands} from '../dist/traffic.js';

const routes=makeCorridors(networkData.roads,networkData.ramps),exits=networkData.exits;
const junction=(path,ref)=>diversionJunctions(path,exits,routes[path]).find(j=>j.ref===ref);
function prepare(event){return automaticDiversions([event],routes,exits,{}).map(p=>{
 const config={id:p.key,path:p.path,fromM:p.from.metre,toM:p.to.metre,eventId:event.id,
  geometry:bundledDetourGeometry(p.key,p.path,p.from,p.to,exits),exitsNetwork:isNetworkDestination(p.to)};
 return {config,state:emptyDetour(config)};
});}

test('delay gradually increases willingness while most drivers still stay at moderate delay',()=>{
 for(const [delay,percent] of [[44.9,0],[45,2],[60,10],[90,30],[120,60],[150,85],[180,100]])
  assert.equal(potentialDiversionPercent(delay,false),percent);
 for(const extra of [0,5,15]){
  const choices=[45,60,90,120,150,180].map(delay=>voluntaryDiversionPercent(delay,extra));
  assert.ok(choices.every((p,i)=>i===0||p>choices[i-1]));
  assert.ok(choices[0]>0&&choices[0]<=2);
  assert.ok(choices[1]<50&&choices[2]<50,'the majority stays at one hour and at ninety minutes');
  assert.ok(choices[3]<100,'two hours must not already mean everybody leaves');
 }
 assert.equal(voluntaryDiversionPercent(180,0),100);
 assert.ok(voluntaryDiversionPercent(180,150)<voluntaryDiversionPercent(180,5),
  'an overloaded bypass remains a cost in the route decision');
});

for(const [path,ref,nextRef] of [['A3-frankfurt','40','41'],['A3-koeln','40','38'],
 ['A48-dernbach','11','12'],['A48-koblenz','12','11']]){
 for(const kind of ['accident','roadworks','breakdown']){
  test(`${path} ${kind}: 45 minutes recruits the AS even with three kilometres of free approach`,()=>{
   const route=routes[path],from=junction(path,ref),to=junction(path,nextRef),at=from.metre+4500;
   assert.ok(to.metre>at+100);
   const laneCount=path.startsWith('A48')?2:3;
   const event={id:'remote-tail-'+path,kind,pathKey:path,point:routeSlice(route,at,at+1)[0],laneCount,
    closedLanes:Array.from({length:laneCount-1},(_,i)=>i),createdAt:'2026-10-25T10:00:00Z',
    settings:{lengthM:100,speedKmh:40,shoulder:'normal'}};
   const entries=prepare(event);
   for(const delay of [44.9,45,60,90,120,180]){
    const grid=initialiseCells(route,2000),tail=from.metre+3000;
    const queued=grid.cells.filter(c=>c.toM>tail&&c.fromM<at);
    const km=queued.length*grid.cellM/1000,speed=60*km/(delay+60*km/freeSpeedKmh(path));
    for(const c of queued){c.densityVehKm=80;c.vehicles=80*grid.cellM/1000;c.speedKmh=speed;c.flowVph=speed*80;}
    grid.initialVehicles=cellInventory(grid);
    assert.ok(queued[0].fromM-from.metre>2900);
    assert.ok(grid.cells.filter(c=>c.fromM>=from.metre&&c.toM<tail-grid.cellM).every(c=>c.speedKmh===130));
    const visible=speedDelayInCells(grid);assert.ok(Math.abs(visible.delayMin-delay)<1e-6);
    const choices=entries.map(e=>({entry:e,...routedDiversionChoice(e,entries,{[path]:grid},routes,[event],exits,defaultDemands())}));
    const used=choices.filter(c=>c.percent>0);
    if(delay<45)assert.equal(used.length,0);
    else{
     const selected=used.find(c=>c.entry.config.geometry.sourceExitRef===ref);
     assert.ok(selected&&selected.percent>0&&!selected.mandatory);
     assert.ok(used.every(c=>!c.mandatory));
     if(delay<=90)assert.ok(used.every(c=>c.percent<50));
     if(delay===45){
      const actual=advanceRoutedPath(grid,route,[event],2000,exits,entries);
      const source=actual.detours.find(e=>e.config.geometry.sourceExitRef===ref);
      assert.ok(source.state.lastDeparture>0&&source.state.lastDeparture<2,'a few drivers actually leave before reaching the jam');
      assertCellConservation(actual.cells);
     }
    }
   }
  });
 }
}

test('2000 vehicles per hour wanting an exit overload a 650/h side road and back up on the motorway',()=>{
 const path='A3-frankfurt',route=routes[path],from=junction(path,'42'),to=junction(path,'43');
 const base=bundledDetourGeometry('exit-overload',path,from,to,exits);
 function simulate(capacity){
  const config={id:base.id,path,fromM:from.metre,toM:to.metre,eventId:'severe-queue',
   geometry:{...base,roadCapacityVph:capacity}};
  let state=initialiseCells(route,2000),side=emptyDetour(config),peakRoadQueue=0,peakDeparture=0;
  for(let minute=0;minute<120;minute++){
   const storage=Math.max(80,base.lengthKm*90),before=state;
   // A supplied 100% exit intention models the user's extreme-delay case.
   // The road and ramp still have their own physical capacities.
   state=advanceCells(state,route,[],2000,[],[{id:config.id,fromM:config.fromM,toM:config.toM,
    interestPercent:100,exitCapacityVph:Math.min(1200,Math.max(0,storage-detourVehicles(side))*60),
    returnVehicles:detourReadyToReturn(side,minute)}],[]);
   const actual=state.lastTransfers[0];
   const flow=advanceDetour(side,config,minute,actual.leaveVpm*60,100,actual.joinVpm*60);
   assert.ok(Math.abs(flow.entered-actual.leaveVpm)<1e-6&&Math.abs(flow.rejoined-actual.joinVpm)<1e-6);
   side=flow.state;peakRoadQueue=Math.max(peakRoadQueue,side.waitingRoad);peakDeparture=Math.max(peakDeparture,side.lastDeparture*60);
   assert.ok(side.lastDeparture*60<=1200+1e-6,'wanting 2000/h cannot fabricate an actual exit rate above the ramp capacity');
   assert.ok(Math.abs(cellInventory(state)+detourVehicles(side)+state.exitedTotal-state.initialVehicles-state.offeredTotal)<1e-5);
   assert.ok(state.offeredTotal>before.offeredTotal);assertCellConservation(state);
  }
  const motorwayQueueM=cellSpeedBands(state).filter(b=>b.fromM<from.metre).reduce((n,b)=>n+b.toM-b.fromM,0);
  return {state,side,peakRoadQueue,peakDeparture,motorwayQueueM};
 }
 const slow=simulate(650),fast=simulate(2400);
 assert.ok(slow.peakDeparture>1100,'cars initially use the ramp until the slower side road fills');
 assert.ok(slow.peakRoadQueue>100,'the side road must store a real waiting inventory');
 assert.ok(slow.motorwayQueueM>3000,'the unsatisfied exit demand must create a substantial motorway queue');
 assert.ok(slow.motorwayQueueM>fast.motorwayQueueM+500,'less side-road capacity must worsen the motorway spillback');
 assert.ok(cellInventory(slow.state)>cellInventory(fast.state)+200);
 assert.ok(slow.side.lastDeparture*60<=650+1e-5,'a full side road ultimately limits motorway departure to its service');
 assert.ok(slow.side.returnedTotal>100,'diverted vehicles really rejoin after their trip');
});
