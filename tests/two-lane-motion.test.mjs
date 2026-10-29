import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {initialiseCells,advanceCells,cellSpeedBands,assertCellConservation} from '../dist/traffic-cells.js';
import {trafficView} from '../dist/traffic-view.js';
import {colorAtSpeed} from '../dist/traffic-physics.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
for(const path of ['A3-koeln','A3-frankfurt'])test(`${path}: free traffic at a 60 km/h two-lane site is not a phantom queue`,()=>{
 const route=routes[path],at=route.lengthM*.7;
 const event={id:'underloaded-60',kind:'roadworks',pathKey:path,laneCount:3,closedLanes:[0],point:routeSlice(route,at,at+1)[0],
  createdAt:'2026-10-29T08:00:00Z',settings:{lengthM:500,speedKmh:60,shoulder:'normal'}};
 let grid=initialiseCells(route,3000);
 for(let minute=0;minute<100;minute++){
  grid=advanceCells(grid,route,[event],3000,networkData.exits);assertCellConservation(grid);
  assert.equal(cellSpeedBands(grid).length,0,'lower free-flow speed alone is not queued stop-and-go');
 }
 const view=trafficView([],{[path]:grid},routes,[event],[],grid.minute);
 assert.equal(view.reports[path].queueKm,0);assert.equal(view.jams.filter(j=>j.pathKey===path).length,0);
 assert.ok(view.bands.get(path).some(b=>b.color==='slow'&&b.source==='restriction'));
 assert.ok(view.delays[path].delayMin<1);
});
for(const path of ['A3-koeln','A3-frankfurt'])test(`${path}: two lanes at 60 retain real orange release phases with bounded mean discharge`,()=>{
 const route=routes[path],at=route.lengthM*.7;
 const event={id:'two-lane-motion',kind:'accident',pathKey:path,laneCount:3,closedLanes:[0],point:routeSlice(route,at,at+1)[0],
  createdAt:'2026-10-29T08:00:00Z',settings:{lengthM:100,speedKmh:60,shoulder:'normal'}};
 let grid=initialiseCells(route,4100),mixed=0,movingInside=0,peak=0,maximumOrange=0;const flows=[],positions=new Set();
 for(let minute=0;minute<150;minute++){
  grid=advanceCells(grid,route,[event],4100,networkData.exits);assertCellConservation(grid);
  if(minute<30)continue;
  const bands=cellSpeedBands(grid),colors=new Set(bands.map(b=>b.color));
  if(colors.has('slow')&&colors.has('jam'))mixed++;
  if(bands.some(b=>b.color==='slow'&&b.toM<at-500))movingInside++;
  maximumOrange=Math.max(maximumOrange,bands.filter(b=>b.color==='slow').reduce((n,b)=>n+b.toM-b.fromM,0));
  positions.add(bands.map(b=>[Math.round(b.fromM),Math.round(b.toM),b.color]).join('|'));
  peak=Math.max(peak,grid.dischargeVph);flows.push(grid.dischargeVph);
  for(const c of grid.cells)assert.ok(Math.abs(c.flowVph-c.speedKmh*c.densityVehKm)<1e-5||c.speedKmh>=(c.limitKmh??130)-1e-6||c.densityVehKm<.05);
  assert.ok(bands.every(b=>b.color===colorAtSpeed(b.speedKmh)));
 }
 const mean=flows.reduce((n,f)=>n+f,0)/flows.length;
 assert.ok(mean>3500&&mean<4000,`sustained two-lane discharge remains finite: ${mean}`);
 assert.ok(peak>3700&&peak<=4500+1e-6,'shorter platoon headways transfer real vehicles, not only orange paint: '+peak);
 assert.ok(mixed>25&&movingInside>5,'orange phases propagate into the congested section: '+[mixed,movingInside]);
 assert.ok(maximumOrange>=200&&positions.size>65,'visible moving pockets, not a single recurring 100m symbol');
});

test('queue mean speed weights real vehicles, preserves local minima and is identical on cards and summaries',()=>{
 const path='A3-frankfurt',grid=initialiseCells(routes[path],1200);
 const first=grid.cells[10],second=grid.cells[11];
 Object.assign(first,{vehicles:10,speedKmh:10,densityVehKm:10/(grid.cellM/1000),flowVph:100/(grid.cellM/1000)});
 Object.assign(second,{vehicles:6,speedKmh:50,densityVehKm:6/(grid.cellM/1000),flowVph:300/(grid.cellM/1000)});
 const view=trafficView([],{[path]:grid},routes,[],[],0),jam=view.jams.find(j=>j.pathKey===path);
 assert.ok(jam);assert.equal(jam.speedKmh,10,'the slowest section still controls its own color');
 const expected=(10*10+6*50)/16;
 assert.ok(Math.abs(jam.meanSpeedKmh-expected)<1e-8);
 assert.ok(Math.abs(view.reports[path].meanSpeedKmh-expected)<1e-8);
 assert.equal(jam.color,'standstill');assert.ok(jam.meanSpeedKmh>jam.speedKmh);
 const before=structuredClone(grid);trafficView([],{[path]:grid},routes,[],[],0);assert.deepEqual(grid,before);
});
