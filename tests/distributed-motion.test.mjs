import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {initialiseCells,advanceCells,cellInventory,cellSpeedBands,platoonServiceFactor} from '../dist/traffic-cells.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
test('a physical platoon peak bound retains the requested mean service instead of cutting every release',()=>{
 for(const ceiling of [1.05,1.10,1.17,1.30]){
  let sum=0,count=0;
  for(let t=0;t<600;t+=.025){
   const factor=platoonServiceFactor('bounded-parallel-service',t,ceiling);
   assert.ok(factor>=0&&factor<=ceiling+1e-10);sum+=factor;count++;
  }
  assert.ok(Math.abs(sum/count-1)<.004,'bounded cycles must retain their mean: '+sum/count);
 }
});

for(const path of ['A3-frankfurt','A3-koeln'])for(const recovery of [false,true])
 test(`${path}: ${recovery?'a reopened queue clears':'a two-lane queue moves'} with genuine release phases deep inside it`,()=>{
  const route=routes[path],at=route.lengthM*.7,demand=recovery?3000:4100;
  const event={id:'distributed-'+path,kind:'accident',pathKey:path,laneCount:3,closedLanes:[0],
   point:routeSlice(route,at,at+1)[0],createdAt:'2026-10-29T08:00:00Z',
   settings:{lengthM:100,speedKmh:60,shoulder:'normal'}};
  let state=initialiseCells(route,demand);
  if(recovery)for(let t=0;t<45;t++)state=advanceCells(state,route,[{
   ...event,closedLanes:[0,1,2],settings:{...event.settings,speedKmh:0}
  }],demand,networkData.exits);
  const before=cellInventory(state),visited=new Set();let movingSamples=0,distinctSnapshots=0,peak=0;
  for(let t=0;t<180;t++){
   state=advanceCells(state,route,[event],demand,networkData.exits);
   assert.ok(Math.abs(cellInventory(state)+state.exitedTotal-state.initialVehicles-state.offeredTotal)<1e-6);
   const bands=cellSpeedBands(state),first=bands[0],last=bands.at(-1);
   peak=Math.max(peak,bands.reduce((n,b)=>n+b.toM-b.fromM,0));
   const head=state.cells.find(c=>c.travelDetector?.active);
   assert.ok(Math.abs(head.minuteFlowVph-state.dischargeVph)<1e-6,'the minute count remains actual discharged vehicles');
   if(Math.abs(head.flowVph-head.minuteFlowVph)>100)distinctSnapshots++;
   if(t<30||!first||!last)continue;
   for(const c of state.cells)if(c.fromM>first.fromM+500&&c.toM<last.toM-500&&c.toM<at-1000&&
    c.speedKmh>30&&c.speedKmh<=65&&c.densityVehKm>=(c.criticalDensityVehKm??0)*1.10){
    movingSamples++;visited.add(Math.floor((at-c.toM)/1000));
    assert.ok(Math.abs(c.flowVph-c.speedKmh*c.densityVehKm)<1e-6,'orange uses actual local discharge and density');
   }
  }
  assert.ok(movingSamples>100,'moving phases must extend beyond the head and braking approach: '+movingSamples);
  assert.ok(visited.size>=(recovery?6:3),'release phases reach several kilometres inside the queue: '+[...visited]);
  assert.ok(distinctSnapshots>20,'map observations must not collapse back to whole-minute averages');
  assert.ok(peak<13000,'one reopened head must not manufacture a long train of brake queues');
  if(recovery){
   assert.ok(cellInventory(state)<before-1000,'clearing means discharging the original inventory');
   assert.equal(cellSpeedBands(state).length,0,'no lingering orange band after the queue has drained');
  }
 });
