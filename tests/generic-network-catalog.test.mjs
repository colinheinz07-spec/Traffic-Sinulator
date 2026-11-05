import test from 'node:test';
import assert from 'node:assert/strict';
import {ROUTE_CATALOG,MOTORWAY_REFS,MOTORWAY_ROUTE_KEYS,routeDescriptor,
 motorwayRef,validateRouteCatalog} from '../dist/network-catalog.js';
import {networkRoad} from '../dist/network-road.js';
import {NETWORK_PATHS,baselineCapacity,defaultDemand} from '../dist/traffic.js';
import {networkData} from '../dist/geodata.js';
import {extensionRoutes} from '../dist/network-extensions.js';

test('all imported motorways and ramps join a single generic path catalog',()=>{
 assert.deepEqual(validateRouteCatalog(),[]);
 assert.equal(new Set(NETWORK_PATHS).size,NETWORK_PATHS.length);
 assert.equal(ROUTE_CATALOG.length,NETWORK_PATHS.length);
 for(const route of extensionRoutes){
  const meta=routeDescriptor(route.id);
  assert.equal(meta?.kind,route.kind,route.id);
  assert.equal(meta?.lanes,route.lanes,route.id);
  assert.equal(defaultDemand(route.id),meta?.demandVph,route.id);
  assert.equal(baselineCapacity(route.id),route.lanes*(route.kind==='ramp'?1500:2100),route.id);
 }
 for(const road of networkData.roads)assert.ok(MOTORWAY_ROUTE_KEYS.includes(road.road));
 for(const ramp of networkData.ramps)assert.equal(routeDescriptor(ramp.id)?.kind,'ramp');
});
test('road-number recognition is not hardcoded to the existing network',()=>{
 assert.equal(motorwayRef('A 61 Richtung Venlo'),'A61');
 assert.equal(motorwayRef('A100 Ring'),'A100');
 assert.equal(motorwayRef('B 9'),null);
 assert.equal(networkRoad('extra-a59-koeln'),'A59');
 assert.ok(MOTORWAY_REFS.includes('A3'));
 assert.ok(MOTORWAY_REFS.includes('A48'));
 const fake={key:'extra-a61-nord',motorway:'A61',kind:'motorway',lanes:2,
  freeKmh:130,demandVph:1800,label:'A61 Richtung Venlo',source:'extension'};
 assert.deepEqual(validateRouteCatalog([...ROUTE_CATALOG,fake]),[]);
 assert.deepEqual(validateRouteCatalog([...ROUTE_CATALOG,fake,fake]),['Doppelte/fehlende Routen-ID: extra-a61-nord']);
});
