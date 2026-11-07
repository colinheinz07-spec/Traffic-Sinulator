import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extensionRoutes,extensionRoute,EXTENSION_IDS,extensionRampBoundaryPoints} from '../dist/network-extensions.js';
import {networkData} from '../dist/geodata.js';
import {verifiedOsmAdditionalRoutes,verifiedOsmStreetBoundaries} from '../dist/01_Strassennetz/osm-zusatzrampen.js';
import {NETWORK_ROUTE_KEYS} from '../dist/network-catalog.js';
import {makeCorridors} from '../dist/spatial.js';
import {buildExtensionConnections} from '../dist/extension-connections.js';
import {defaultDemand} from '../dist/traffic.js';

const extra=verifiedOsmAdditionalRoutes;
const byId=id=>extra.find(r=>r.wayIds[0]===id&&!r.id.endsWith('-back'));
const contains=(lat,lon,range=.018)=>extra.filter(r=>r.points.some(p=>Math.abs(p[0]-lat)<range&&Math.abs(p[1]-lon)<range));
test('136 actual OSM motorway_link ways are available as 143 navigable directed corridors',()=>{
 assert.equal(new Set(extra.flatMap(x=>x.wayIds)).size,136);
 assert.equal(extra.length,143);
 assert.equal(new Set(extra.map(x=>x.id)).size,extra.length);
 assert.equal(extensionRoutes.length,711+extra.length);
 assert.equal(EXTENSION_IDS.length,extensionRoutes.length);
 const allKeys=new Set(NETWORK_ROUTE_KEYS);
 const corridors=makeCorridors(networkData.roads,networkData.ramps);
 for(const f of extra){
  assert.ok(allKeys.has(f.id),f.id+' missing from route catalogue');
  assert.equal(extensionRoute(f.id),f);
  assert.equal(f.kind,'ramp');
  assert.equal(f.demandVph,0,'No phantom standalone vehicles '+f.id);
  assert.equal(defaultDemand(f.id),0);
  assert.ok(f.points.length>1);
  assert.ok(f.lanes>=1&&f.lanes<=4);
  assert.ok(corridors[f.id].lengthM>1);
  assert.equal(f.laneSegments.length,1);
 }
});
test('Siebengebirge, Kreuz Köln-Süd and Kreuz Bonn-Nord get their originally separate OSM waylines',()=>{
 for(const id of [407505963,407505964,407505965,407505966])assert.ok(byId(id),'Siebengebirge '+id);
 for(const id of [4400131,4400133,128417958,4400126,4400135,4400142,20662828,235824477])
  assert.ok(byId(id),'Köln-Süd '+id);
 for(const id of [4356485,4356494,5939833,8016754,22979399,115494341,210683520])
  assert.ok(byId(id),'Bonn-Nord '+id);
 assert.ok(contains(50.675,7.294,.021).length>=4);
 assert.ok(contains(50.884,6.968,.020).length>=8);
 assert.ok(contains(50.747,7.077,.024).length>=13);
});
test('Idstein, Niedernhausen and Wiesbaden preserve 10 newly verified one-way OSM connectors',()=>{
 for(const id of [388594671,278106759,27005343,384052261,23328071,384052268,5200961,384052273,8205921,384055828]){
  const ramp=byId(id);
  assert.ok(ramp,'missing motorway_link '+id);
  assert.ok(ramp.points.length>=2);
  assert.equal(ramp.demandVph,0,'no invented ramp vehicles');
 }
 const idstein=extra.filter(r=>[388594671,278106759].includes(r.wayIds[0]));
 assert.equal(idstein.length,2);
 assert.ok(idstein.every(r=>r.points.some(p=>p[0]>50.20&&p[0]<50.22&&p[1]>8.24&&p[1]<8.26)));
});
test('two-way OSM links provide reversed directional routes on ONE geometry, not invented parallel roads',()=>{
 const original=extra.filter(x=>x.id.startsWith('extra-osm-link-')&&!x.id.endsWith('-back'));
 const reverses=extra.filter(x=>x.id.endsWith('-back'));
 assert.equal(reverses.length,7);
 for(const r of reverses){
  const main=original.find(x=>x.id===r.id.slice(0,-5));
  assert.ok(main,r.id);
  assert.deepEqual(r.points,main.points.slice().reverse());
  assert.equal(r.wayIds[0],main.wayIds[0]);
 }
});
test('street boundaries and exact OSM motorway connections are real segment endpoints',()=>{
 assert.ok(verifiedOsmStreetBoundaries.length>=55);
 const used=new Set(extra.flatMap(x=>x.points.map(p=>p.join(','))));
 for(const p of verifiedOsmStreetBoundaries)assert.ok(used.has(p.join(',')));
 const routes=makeCorridors(networkData.roads,networkData.ramps);
 const links=buildExtensionConnections(routes);
 const local=links.filter(x=>x.rampId.startsWith('extra-osm-link-'));
 assert.ok(local.length>=12,'verified motorway endpoints available to network solver');
 assert.ok(local.some(x=>x.from!==x.rampId));
 assert.ok(local.some(x=>x.to!==x.rampId));
 const bound=new Set(extensionRampBoundaryPoints.map(p=>p.join(',')));
 for(const p of verifiedOsmStreetBoundaries)assert.ok(bound.has(p.join(',')));
});
test('no service area-only slip roads, closed/private ramps or duplicate imported OSM ways added',()=>{
 const existing=new Set([...networkData.roads.map(r=>r.wayId),...networkData.ramps.flatMap(x=>x.wayIds),
   ...extensionRoutes.filter(x=>!x.id.startsWith('extra-osm-link-')).flatMap(x=>x.wayIds)]);
 for(const f of extra)for(const id of f.wayIds)assert.ok(!existing.has(id),'duplicate OSM way '+id);
 for(const id of [27005183,326138777,407517104])assert.equal(byId(id),undefined);
 const doc=readFileSync('scripts/build_osm_additional_ramps.py','utf8');
 assert.match(doc,/motorway_link/);
 assert.match(doc,/known/);
 assert.match(doc,/w\["nodes"\]/);
 assert.doesNotMatch(doc,/nearestPolyline|snapTo|random/);
});
