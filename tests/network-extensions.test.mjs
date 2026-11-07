import test from 'node:test';
import assert from 'node:assert/strict';
import {extensionRoutes,EXTENSION_IDS} from '../dist/network-extensions.js';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,advanceSpatial,emptySpatial,jamsAt} from '../dist/spatial.js';
import {NETWORK_PATHS,defaultDemands,baselineCapacity,demandAtClock} from '../dist/traffic.js';
import {extensionCandidates,hitLabel} from '../dist/selection.js';
import {eventFromHit,decodeEvents} from '../dist/events.js';
import {buildExtensionConnections} from '../dist/extension-connections.js';
import {trafficView} from '../dist/traffic-view.js';
import {worldGeometry} from '../dist/map-geometry.js';
import {physicalOwnerAt} from '../dist/physical-paths.js';
const routes=makeCorridors(networkData.roads,networkData.ramps);
test('both A560 directions, all eight Siegburg turns and Heumar paths have unique selectable exact geometry',()=>{
 assert.equal(EXTENSION_IDS.length,new Set(EXTENSION_IDS).size);
 assert.equal(extensionRoutes.filter(r=>r.zone==='AK Bonn/Siegburg'&&r.kind==='ramp').length,8);
 assert.equal(extensionRoutes.filter(r=>r.kind==='motorway').length,16);
 assert.ok(extensionRoutes.some(r=>r.zone==='AD Köln-Heumar'));
 for(const feature of extensionRoutes){
  const point=feature.points[Math.floor(feature.points.length/2)],scale=100000;
  const hits=extensionCandidates([point[1]*scale,point[0]*scale],p=>[p[1]*scale,p[0]*scale],1);
  const hit=hits.find(h=>h.key===feature.id);
  const owner=physicalOwnerAt(feature.id,point);if(owner){assert.ok(!hit,feature.id+' legacy alias must defer to '+owner.key);continue;}
  assert.ok(hit,feature.id);assert.equal(hitLabel(hit),feature.name);
  const event=eventFromHit(hit,'accident',feature.lanes,Array.from({length:feature.lanes},(_,i)=>i),feature.id,'2026-11-01T08:00:00Z');
  assert.deepEqual(decodeEvents(JSON.stringify([event]))[0],event);
  assert.ok(routes[feature.id].lengthM>0&&baselineCapacity(feature.id)>0);
  assert.ok(feature.demandVph<baselineCapacity(feature.id));
 }
});
test('each added path can form a real event queue and release it using the same displayed traffic state',()=>{
 const demands=defaultDemands();
 for(const feature of extensionRoutes){
  const point=feature.points[Math.floor(feature.points.length/2)];
  const event={id:'queue-'+feature.id,pathKey:feature.id,kind:'accident',point,laneCount:feature.lanes,
   closedLanes:Array.from({length:feature.lanes},(_,i)=>i),createdAt:'2026-11-01T08:00:00Z',settings:{lengthM:50,speedKmh:0,shoulder:'blocked'}};
  // New OSM geometry has no independent demand; test event physics with
  // an explicit traffic scenario, not fabricated default traffic.
  const scenario=feature.demandVph>0?demands:{...demands,[feature.id]:Math.min(850,feature.lanes*400)};
  let state=advanceSpatial(emptySpatial(),[event],scenario,8,routes,[],[],[],undefined,NETWORK_PATHS);
  const before=state.queues[event.id]?.vehicles??0;assert.ok(before>0,feature.id);
  const view=trafficView(jamsAt(state,[event],routes),{},routes,[event],[],state.minute);
  assert.ok(view.reports[feature.id].ownVehicles>0&&view.bands.has(feature.id));
  state=advanceSpatial(state,[],scenario,20,routes,[],[],[],undefined,NETWORK_PATHS);
  assert.ok((state.queues[event.id]?.vehicles??0)<before,feature.id+' clears');
 }
});
test('new path demand remains finite across weekday/weekend profiles and exact turn endpoints connect to A3/A560',()=>{
 for(const date of ['2026-11-01T09:00:00Z','2026-11-02T07:00:00Z']){
  const demands=demandAtClock(defaultDemands(),new Date(date));
  for(const key of EXTENSION_IDS)assert.ok(Number.isFinite(demands[key])&&demands[key]>=0,key);
 }
 const links=buildExtensionConnections(routes);
 for(const link of links.filter(l=>l.rampId.startsWith('extra-siegburg-'))){
  const [source,target]=link.rampId.slice('extra-siegburg-'.length).split('-to-');
  assert.equal(link.from,source.startsWith('A560')?'extra-'+source.toLowerCase():source);
  assert.equal(link.to,target.startsWith('A560')?'extra-'+target.toLowerCase():target);
 }
 assert.equal(links.filter(l=>l.rampId.startsWith('extra-siegburg-')).length,8);
 assert.ok(links.some(l=>l.rampId.startsWith('extra-heumar-')));
 for(const link of links)assert.ok(Number.isFinite(link.rampEntryM)&&Number.isFinite(link.downstreamMergeM));
});
test('world road geometry is reused across camera redraws and retains exact bounds',()=>{
 const points=extensionRoutes[0].points,first=worldGeometry(points),second=worldGeometry(points);
 assert.equal(first,second);assert.ok(first.maxX>first.minX&&first.maxY>first.minY);
});
test('extended A3 incidents can prepare cross-motorway local routes to Bad Camberg',async()=>{
 const {bundledTargets,bundledDetourGeometry}=await import('../dist/bundled-detours.js');
 const from=bundledTargets('A48-dernbach',networkData.exits,routes['A48-dernbach']).find(e=>e.ref==='12');
 const to=bundledTargets('A3-frankfurt',networkData.exits,routes['A3-frankfurt']).find(e=>e.ref==='44');
 const geometry=bundledDetourGeometry('test-hohr-camberg','A48-dernbach',from,to,networkData.exits);
 assert.ok(geometry.lengthKm>0&&geometry.points.length>2);
});
test('the incident detail planner excludes half junctions that have no exit in the selected direction',async()=>{
 const {planDiversion}=await import('../dist/diversions.js');
 const route=routes['A3-frankfurt'];
 const event={id:'half-junction',kind:'accident',pathKey:route.key,point:route.points.at(-10),laneCount:3,
  closedLanes:[0,1],createdAt:'2026-11-01T08:00:00Z',settings:{lengthM:100,speedKmh:40,shoulder:'normal'}};
 const plan=planDiversion(event,route,networkData.exits,90);
 assert.ok(plan);assert.ok(!plan.candidateExits.some(c=>c.exit.ref==='30b'));
});
test('an A560 queue reaching an exact ramp merge creates ramp backpressure and clears after release',()=>{
 const links=buildExtensionConnections(routes),link=links.find(l=>l.from==='A3-frankfurt'&&l.to==='extra-a560-hennef');
 const route=routes[link.to],at=Math.min(route.lengthM-5,link.downstreamMergeM+800);
 const event={id:'a560-block',kind:'accident',pathKey:link.to,point:routeSliceForTest(route,at),laneCount:2,closedLanes:[0,1],
  createdAt:'2026-11-01T08:00:00Z',settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}};
 const demand={...defaultDemands(),[link.to]:2800};
 let state=advanceSpatial(emptySpatial(),[event],demand,60,routes,links,[],[],undefined,NETWORK_PATHS);
 const before=Object.values(state.queues).filter(q=>q.pathKey===link.rampId).reduce((n,q)=>n+q.vehicles,0);
 assert.ok(before>0,'target queue must block the connected ramp');
 for(let i=0;i<8;i++)state=advanceSpatial(state,[],demand,60,routes,links,[],[],undefined,NETWORK_PATHS);
 const after=Object.values(state.queues).filter(q=>q.pathKey===link.rampId).reduce((n,q)=>n+q.vehicles,0);
 assert.ok(after<before*.1,'released A560 supply drains old ramp stock');
});
function routeSliceForTest(route,metre){
 for(let i=1;i<route.metres.length;i++)if(route.metres[i]>=metre){const t=(metre-route.metres[i-1])/(route.metres[i]-route.metres[i-1]);
  return route.points[i-1].map((v,k)=>v+(route.points[i][k]-v)*t);}
 return route.points.at(-1);
}
