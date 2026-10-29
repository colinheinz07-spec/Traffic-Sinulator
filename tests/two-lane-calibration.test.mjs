import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {initialiseCells,advanceCells,assertCellConservation,cellSpeedBands} from '../dist/traffic-cells.js';
import {defaultDemands,demandAtClock,demandAtMinute,eventCapacity} from '../dist/traffic.js';
import {trafficView} from '../dist/traffic-view.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
const eventFor=path=>({id:'realistic-two-open',kind:'accident',pathKey:path,laneCount:3,closedLanes:[0],
 point:routeSlice(routes[path],routes[path].lengthM*.7,routes[path].lengthM*.7+1)[0],
 createdAt:'2026-10-29T08:00:00Z',settings:{lengthM:100,speedKmh:60,shoulder:'normal'}});
const queueKm=grid=>cellSpeedBands(grid).reduce((n,b)=>n+b.toM-b.fromM,0)/1000;

test('default calendar volume is of the regional daily order without lowering the peak-hour inputs',()=>{
 const base=defaultDemands(),totals=[];
 assert.equal(base['A3-frankfurt'],4100);assert.equal(base['A3-koeln'],4200);
 for(let day=0;day<7;day++){
  let total=0;
  for(let minute=0;minute<1440;minute++){
   const demand=demandAtClock(base,new Date(2026,9,26+day,0,minute));
   total+=(demand['A3-frankfurt']+demand['A3-koeln'])/60;
  }
  totals.push(total);
 }
 const mean=totals.reduce((a,b)=>a+b)/7;
 assert.ok(mean>80000&&mean<93000,'synthetic weekly mean must not turn peak-hour references into 103,500 vehicles/day: '+mean);
 assert.ok(totals[0]>totals[5]&&totals[5]>totals[6]);
 const morning=demandAtClock(base,new Date(2026,9,26,8));
 assert.equal(morning['A3-koeln'],base['A3-koeln']);assert.ok(morning['A3-frankfurt']>base['A3-frankfurt']);
 assert.deepEqual(demandAtMinute(base,666,'constant'),base,'constant stress testing is not silently scaled down');
});

for(const path of ['A3-frankfurt','A3-koeln']){
 test(`${path}: sustained reference peak uses both lanes instead of routinely making a double-digit two-hour queue`,()=>{
  const route=routes[path],event=eventFor(path);let grid=initialiseCells(route,4100),sum=0,peak=0;
  for(let minute=0;minute<120;minute++){
   grid=advanceCells(grid,route,[event],4100,networkData.exits);assertCellConservation(grid);
   peak=Math.max(peak,queueKm(grid));if(minute>=30)sum+=grid.dischargeVph;
  }
  assert.ok(sum/90>3650&&sum/90<=4000,'available service remains physical and finite');
  assert.ok(peak>3&&peak<10,'controlled two-hour, two-open-lane case: '+peak);
  assert.ok(grid.offeredTotal>8000,'all original peak arrivals are still offered');
 });

 test(`${path}: two reopened lanes drain the real old stock under 3000/h rather than retaining a long residual queue`,()=>{
  const route=routes[path],event=eventFor(path),blocked={...event,closedLanes:[0,1,2],settings:{...event.settings,speedKmh:0}};
  let grid=initialiseCells(route,3000);
  for(let minute=0;minute<45;minute++)grid=advanceCells(grid,route,[blocked],3000,networkData.exits);
  const before=trafficView([],{[path]:grid},routes,[blocked],[],grid.minute).reports[path].ownVehicles;
  for(let minute=0;minute<180;minute++){
   grid=advanceCells(grid,route,[event],3000,networkData.exits);assertCellConservation(grid);
  }
  const report=trafficView([],{[path]:grid},routes,[event],[],grid.minute).reports[path];
  assert.ok(report.ownVehicles<before*.35,'queue inventory, not only mapped color, must decrease');
  assert.ok(report.queueKm<4.5,'a finite old queue with spare service should largely clear: '+report.queueKm);
  assert.ok(report.delayMin<15);assert.ok(grid.exitedTotal>10000);
 });

 test(`${path}: a weaker incident at the same physical head cannot multiply braking losses`,()=>{
  const route=routes[path],event=eventFor(path),weaker={...event,id:'z-coincident-works',kind:'roadworks'};
  assert.ok(eventCapacity(weaker,3200)>eventCapacity(event,3200));
  const blocked={...event,closedLanes:[0,1,2],settings:{...event.settings,speedKmh:0}};
  let seed=initialiseCells(route,3200);for(let i=0;i<20;i++)seed=advanceCells(seed,route,[blocked],3200);
  let single=seed,multiple=seed;
  for(let minute=0;minute<80;minute++){
   single=advanceCells(single,route,[event],3200);
   multiple=advanceCells(multiple,route,minute%2?[weaker,event]:[event,weaker],3200);
   assertCellConservation(single);assertCellConservation(multiple);
   assert.deepEqual(multiple.cells.map(c=>[c.vehicles,c.speedKmh,c.flowVph]),single.cells.map(c=>[c.vehicles,c.speedKmh,c.flowVph]));
  }
 });
}
