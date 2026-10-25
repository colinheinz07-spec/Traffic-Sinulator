import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {DIRECTIONS} from '../dist/core.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {initialiseCells,advanceCells,cellSpeedBands,cellInventory,assertCellConservation} from '../dist/traffic-cells.js';
import {eventCapacity} from '../dist/traffic.js';

const routes=makeCorridors(networkData.roads,networkData.ramps),{exits}=networkData;
function event(path,at,closedLanes,speedKmh=80){
 const route=routes[path],laneCount=path.startsWith('A48')?2:3;
 return {id:'release-'+path,kind:'accident',pathKey:path,point:routeSlice(route,at,at+1)[0],laneCount,
  closedLanes,createdAt:'2026-10-25T09:00:00Z',settings:{lengthM:100,speedKmh,shoulder:'normal'}};
}
function footprint(state){
 const groups=[];
 for(const band of cellSpeedBands(state)){
  const last=groups.at(-1);
  if(last&&band.fromM<=last.toM+.1)last.toM=band.toM;
  else groups.push({fromM:band.fromM,toM:band.toM});
 }
 return {groups:groups.length,metres:groups.reduce((n,g)=>n+g.toM-g.fromM,0)};
}

for(const path of DIRECTIONS)test(`${path}: a distant incident cannot replay braking inside an unrelated queue`,()=>{
 const route=routes[path],lanes=path.startsWith('A48')?2:3;
 for(const minute of [1,70,330,1381]){
  const grid=initialiseCells(route,1600);
  for(const c of grid.cells)if(c.fromM>route.lengthM*.12&&c.toM<route.lengthM*.2){
   const density=lanes===3?180:160;
   c.densityVehKm=density;c.vehicles=density*grid.cellM/1000;c.speedKmh=5;c.flowVph=density*5;
  }
  grid.initialVehicles=cellInventory(grid);grid.minute=minute;
  const remote=event(path,route.lengthM*.85,[0]);
  const free=advanceCells(grid,route,[],1600,[],[],[]);
  const limited=advanceCells(grid,route,[remote],1600,[],[],[]);
  const upstream=s=>s.cells.filter(c=>c.toM<route.lengthM*.4).map(c=>[c.vehicles,c.flowVph,c.speedKmh,c.densityVehKm]);
  assert.deepEqual(upstream(limited),upstream(free),
   'a remote capacity change must reach traffic through adjacent fluxes, never a scripted per-cell signal');
  assertCellConservation(free);assertCellConservation(limited);
 }
});

for(const path of ['A3-koeln','A3-frankfurt'])for(const speed of [40,80]){
 test(`${path}: zero to two open lanes at ${speed} km/h clears without multiplying separated queues`,()=>{
  const route=routes[path],at=route.lengthM*.58,blocked=event(path,at,[0,1,2],0);
  let state=initialiseCells(route,3200);
  for(let i=0;i<45;i++)state=advanceCells(state,route,[blocked],3200,exits);
  const before=cellInventory(state),initial=footprint(state),released={...blocked,closedLanes:[0],settings:{...blocked.settings,speedKmh:speed}};
  assert.ok(initial.metres>7000,'start with the fully blocked queue from the report');
  assert.ok(eventCapacity(released,1800)>1800);
  let peakGroups=0,clearMinute=null;
  for(let i=0;i<300;i++){
   state=advanceCells(state,route,[released],1800,exits);assertCellConservation(state);
   const now=footprint(state);peakGroups=Math.max(peakGroups,now.groups);
   if(now.metres===0&&clearMinute===null)clearMinute=i;
   if(clearMinute!==null)assert.equal(now.metres,0,'a drained underloaded road must stay clear');
  }
  assert.ok(peakGroups<=2,'one released bottleneck must not create a chain of detached brake queues');
  assert.ok(clearMinute!==null&&clearMinute<240);
  assert.ok(cellInventory(state)<before-1000);
 });
}

test('reopening during continued overload may grow the real queue, but cannot create a train of detached queues',()=>{
 const path='A3-koeln',route=routes[path],blocked=event(path,route.lengthM*.58,[0,1,2],0);
 let state=initialiseCells(route,3200);
 for(let i=0;i<45;i++)state=advanceCells(state,route,[blocked],3200,exits);
 const before=cellInventory(state),beforeLength=footprint(state).metres,released={...blocked,closedLanes:[0],settings:{...blocked.settings,speedKmh:80}};
 assert.ok(eventCapacity(released,3600)<3600);
 for(let i=0;i<240;i++){
  state=advanceCells(state,route,[released],3600,exits);assertCellConservation(state);
  assert.ok(footprint(state).groups<=2);
 }
 assert.ok(cellInventory(state)>before+1000,'retain genuine excess arrivals instead of hiding them');
 assert.ok(footprint(state).metres>beforeLength+5000);
});

for(const path of ['A48-dernbach','A48-koblenz'])test(`${path}: a released lane drains the blocked queue without remote brake copies`,()=>{
 const route=routes[path],blocked=event(path,route.lengthM*.58,[0,1],0);
 let state=initialiseCells(route,2000);
 for(let i=0;i<45;i++)state=advanceCells(state,route,[blocked],2000,exits);
 const before=cellInventory(state),released={...blocked,closedLanes:[0],settings:{...blocked.settings,speedKmh:80}};
 assert.ok(eventCapacity(released,900)>900);
 for(let i=0;i<300;i++){
  state=advanceCells(state,route,[released],900,exits);assertCellConservation(state);
  assert.ok(footprint(state).groups<=2);
 }
 assert.equal(footprint(state).metres,0);
 assert.ok(cellInventory(state)<before-500);
});

test('late simulation time does not make a freed bottleneck emit fresh upstream restrictions',()=>{
 const path='A3-koeln',route=routes[path],blocked=event(path,route.lengthM*.58,[0,1,2],0);
 let state=initialiseCells(route,3200);state.minute=1300;
 for(let i=0;i<45;i++)state=advanceCells(state,route,[blocked],3200,exits);
 const released={...blocked,closedLanes:[0],settings:{...blocked.settings,speedKmh:80}};
 for(let i=0;i<300;i++){
  state=advanceCells(state,route,[released],1800,exits);assertCellConservation(state);
  assert.ok(footprint(state).groups<=2);
 }
 assert.equal(footprint(state).metres,0);
});

test('two open lanes absorb departure pauses better than one while preserving real discharge changes',()=>{
 const path='A3-koeln',route=routes[path],blocked=event(path,route.lengthM*.58,[0,1,2],0);
 let initial=initialiseCells(route,3200);
 for(let i=0;i<45;i++)initial=advanceCells(initial,route,[blocked],3200,exits);
 const variation=[];
 for(const closedLanes of [[0,1],[0]]){
  const released={...blocked,closedLanes,settings:{...blocked.settings,speedKmh:80}};
  let state=initial;const flows=[];
  for(let i=0;i<70;i++){
   state=advanceCells(state,route,[released],3600,exits);assertCellConservation(state);
   if(i>=10)flows.push(state.dischargeVph);
  }
  const mean=flows.reduce((n,f)=>n+f,0)/flows.length;
  const deviation=Math.sqrt(flows.reduce((n,f)=>n+(f-mean)**2,0)/flows.length);
  variation.push(deviation/mean);
  assert.ok(Math.max(...flows)>Math.min(...flows)+30,'changes remain in actual transferred vehicles');
 }
 assert.ok(variation[1]<variation[0]/2,'parallel lanes must damp the normalized service fluctuations');
});
