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
function section(path,fromRef,toRef,id){
 const junctions=diversionJunctions(path,exits,routes[path]);
 const from=junctions.find(j=>j.ref===fromRef),to=junctions.find(j=>j.ref===toRef);
 assert.ok(from&&to&&from.metre<to.metre);
 const start=from.metre+2,end=to.metre-2;
 return {...closure,id,pathKey:path,point:routeSlice(routes[path],start,start+1)[0],
  laneCount:path.startsWith('A3')?3:2,closedLanes:path.startsWith('A3')?[0,1,2]:[0,1],
  settings:{...closure.settings,lengthM:end-start}};
}
test('21:00 transition: closed A3 approaches cannot supply either A48 ramp when the A48 closure moves to Höhr–Bendorf',()=>{
 const night=[section('A3-koeln','41','38','night-a3-north'),section('A3-frankfurt','38','41','night-a3-south'),
  section('A48-koblenz','12','11','night-a48-west'),section('A48-dernbach','11','12','night-a48-east')];
 let state=advanceSpatial(emptySpatial(),[closure],demands,60,routes,links,[],exits);
 // The application supplies the real CTM mainline queue to the ramp solver.
 // It already reaches Dernbach when the scheduled closure changes at 21:00.
 const anchor=diversionJunctions(path,exits,route).find(j=>j.ref==='12').metre;
 const backflow={id:'ctm-night',pathKey:path,eventKind:'closure',point:routeSlice(route,anchor,anchor+1)[0],
  anchorM:anchor,queueM:anchor+500,visibleQueueM:anchor,queueVehicles:1600,capacityVph:0,
  speedKmh:0,color:'standstill',delayMin:null,released:false,outOfBoundsM:500};
 for(let t=0;t<8;t++)state=advanceSpatial(state,night,demands,60,routes,links,[],exits,[backflow]);
 for(const link of links.filter(l=>l.to===path))
  assert.ok(!Object.values(state.queues).some(q=>q.pathKey===link.rampId),'no invented ramp traffic after 21:00: '+link.rampId);
});
test('an isolated A48 Höhr–Bendorf closure keeps the open A3 approach available',()=>{
 const downstream=section('A48-koblenz','12','11','downstream');
 const ramp=links.find(l=>l.rampId==='ramp-a3-to-a48-from-frankfurt');
 const accident={...closure,id:'ramp-crash',kind:'accident',pathKey:ramp.rampId,
  point:routes[ramp.rampId].points.at(-1),laneCount:1,closedLanes:[0]};
 const state=advanceSpatial(emptySpatial(),[downstream,accident],demands,2,routes,links,[],exits);
 assert.ok(state.queues[accident.id]?.vehicles>0,'an open approach still supplies the ramp');
});
