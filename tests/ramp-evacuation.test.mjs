import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {extensionRoutes,extensionJunctions} from '../dist/network-extensions.js';
import {makeCorridors,advanceSpatial,emptySpatial} from '../dist/spatial.js';
import {defaultDemands} from '../dist/traffic.js';
import {buildExtensionConnections} from '../dist/extension-connections.js';
const routes=makeCorridors(networkData.roads,networkData.ramps),links=buildExtensionConnections(routes);
const exits=[...networkData.exits,...extensionJunctions],demands=defaultDemands();
for(const ramp of extensionRoutes.filter(r=>r.kind==='ramp'))test(`${ramp.id}: formal ramp closure prevents new trips and evacuates existing stock`,()=>{
 const point=routes[ramp.id].points[Math.floor(routes[ramp.id].points.length/2)];
 const closure={id:'closed-turn',kind:'closure',pathKey:ramp.id,point,laneCount:ramp.lanes,
 closedLanes:Array.from({length:ramp.lanes},(_,i)=>i),createdAt:'2026-11-01T14:00:00Z',settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}};
 const initial={minute:0,queues:{old:{pathKey:ramp.id,point,vehicles:100,lanes:ramp.lanes,capacityVph:0}}};
 const after=advanceSpatial(initial,[closure],demands,15,routes,links,[],exits,[],[ramp.id]);
 assert.equal(Object.values(after.queues).filter(q=>q.pathKey===ramp.id).reduce((n,q)=>n+q.vehicles,0),0);
 const fresh=advanceSpatial(emptySpatial(),[closure],demands,15,routes,links,[],exits,[],[ramp.id]);
 assert.equal(Object.keys(fresh.queues).length,0);
 const accident={...closure,kind:'accident'};
 const blocked=advanceSpatial(emptySpatial(),[accident],demands,2,routes,links,[],exits,[],[ramp.id]);
 assert.ok(blocked.queues[accident.id]?.vehicles>0,'physical obstruction still queues actual traffic');
});

test('both A560 eastbound turns at Bonn/Siegburg retain usable local bypasses, including an upstream A3 return',async()=>{
 const {planExtensionDetours}=await import('../dist/extension-detours.js');
 const ids=['extra-siegburg-A560-hennef-to-A3-frankfurt','extra-siegburg-A560-hennef-to-A3-koeln'];
 const events=ids.map(id=>({id,kind:'closure',pathKey:id,point:routes[id].points[2],laneCount:1,closedLanes:[0],
 createdAt:'2026-11-01T14:00:00Z',settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}}));
 const plans=planExtensionDetours(events,routes,exits,{},links);
 for(const id of ids)assert.ok(plans.some(p=>p.movementId===id&&p.geometry.roadCapacityVph>0),id);
 const frankfurt=plans.find(p=>p.movementId===ids[0]);
 assert.ok(frankfurt.toM<links.find(l=>l.rampId===ids[0]).downstreamMergeM,'upstream return is valid on the open A3');
});
