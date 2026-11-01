import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {extensionJunctions,extensionRoute} from '../dist/network-extensions.js';
import {buildExtensionConnections} from '../dist/extension-connections.js';
import {makeCorridors,routeSlice,closureGate,advanceSpatial} from '../dist/spatial.js';
import {defaultDemands} from '../dist/traffic.js';
const routes=makeCorridors(networkData.roads,networkData.ramps);
const exits=[...networkData.exits,...extensionJunctions];
const links=buildExtensionConnections(routes),demands=defaultDemands();
test('all mapped extension ramps reject closed-arm arrivals and drain existing ramp queues',()=>{
 let checked=0;
 for(const link of links){
  if(link.to===link.rampId||extensionRoute(link.to)?.kind==='ramp')continue;
  const target=routes[link.to],at=Math.min(target.lengthM-1,link.downstreamMergeM+1);
  const event={id:'closed-target',kind:'closure',pathKey:link.to,
   point:routeSlice(target,at,at+1)[0],laneCount:3,closedLanes:[0,1,2],
   createdAt:'2026-11-01T12:00:00Z',settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}};
  const gate=closureGate(target,event,exits,[event]);
  if(!gate||link.downstreamMergeM<gate.metre-1||link.downstreamMergeM>=gate.endM-1)continue;
  checked++;
  const ramp=routes[link.rampId],id='merge:'+link.rampId;
  const queues={[id]:{pathKey:link.rampId,point:ramp.points.at(-1),vehicles:50,lanes:1,capacityVph:0,active:true}};
  const next=advanceSpatial({minute:0,queues},[event],demands,20,routes,[link],[],exits,[],[link.rampId]);
  assert.ok(!Object.values(next.queues).some(q=>q.pathKey===link.rampId),link.rampId+' must drain without new closed-arm demand');
 }
 assert.ok(checked>20,'must cover the connected network, checked '+checked);
});
