import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice,emptySpatial,advanceSpatial} from '../dist/spatial.js';
import {buildRampConnections} from '../dist/interchange.js';
import {defaultDemands} from '../dist/traffic.js';
import {diversionJunctions} from '../dist/diversions.js';
import {initialiseCells,advanceCells} from '../dist/traffic-cells.js';
import {interchangeJourneys} from '../dist/interchange-journeys.js';
const routes=makeCorridors(networkData.roads,networkData.ramps),exits=networkData.exits;
const links=buildRampConnections(networkData.ramps,routes),demands=defaultDemands();
const path='A48-koblenz',route=routes[path];
const end=diversionJunctions(path,exits,route).find(j=>j.ref==='12').metre;
const closure={id:'closed-a48',kind:'closure',pathKey:path,point:routeSlice(route,end/2,end/2+1)[0],
 laneCount:2,closedLanes:[0,1],createdAt:'2026-10-31T12:00:00Z',settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}};
test('Dernbach–Höhr closure rejects both A3 ramp demands at entry for the entire closure',()=>{
 let state=emptySpatial();
 for(let t=0;t<8;t++)state=advanceSpatial(state,[closure],demands,60,routes,links,[],exits);
 for(const link of links.filter(l=>l.to===path))
  assert.ok(!Object.values(state.queues).some(q=>q.pathKey===link.rampId),'closed ramp must not accumulate vehicles: '+link.rampId);
});
test('existing ramp queues and vehicles inside the closed A48 arm drain forward',()=>{
 const queues={};
 for(const link of links.filter(l=>l.to===path))queues['closed-merge:'+link.rampId]={pathKey:link.rampId,
  point:routes[link.rampId].points.at(-1),vehicles:80,lanes:1,capacityVph:0,active:true};
 const state=advanceSpatial({minute:0,queues},[closure],demands,10,routes,links,[],exits);
 for(const link of links.filter(l=>l.to===path))assert.ok(!Object.values(state.queues).some(q=>q.pathKey===link.rampId));
 let grid=initialiseCells(route,1400);
 const inside=g=>g.cells.filter(c=>c.toM<end).reduce((n,c)=>n+c.vehicles,0),before=inside(grid);
 for(let t=0;t<15;t++)grid=advanceCells(grid,route,[closure],1400,exits);
 assert.ok(inside(grid)<before*.1);
});
test('an A3 closure cannot protect a turn into a simultaneously closed A48 arm',()=>{
 const link=links.find(l=>l.from==='A3-frankfurt'&&l.to===path),source=routes[link.from];
 const next=diversionJunctions(link.from,exits,source).find(j=>j.metre>link.rampEntryM&&!j.isInterchange);
 const at=(link.rampEntryM+next.metre)/2;
 const a3={...closure,id:'closed-a3',pathKey:link.from,point:routeSlice(source,at,at+1)[0],laneCount:3,closedLanes:[0,1,2]};
 const plans=interchangeJourneys([closure,a3],routes,exits,{},links);
 assert.ok(!plans.some(p=>p.journey?.kind==='protected'&&p.targetPath===path));
 assert.ok(plans.some(p=>p.journey?.kind==='closure-bypass'&&p.targetPath===path));
});
