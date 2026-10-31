import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';import {makeCorridors,positionM} from '../dist/spatial.js';
import {normalJunctionTraffic} from '../dist/junction-traffic.js';import {junctionAccess} from '../dist/road-controls.js';
import {siegburgContext} from '../dist/siegburg-context.js';import {regionalDetours} from '../dist/regional-detours.js';
import {validEvent} from '../dist/events.js';
const routes=makeCorridors(networkData.roads,networkData.ramps);
test('A3 has continuous directional coverage to Heumar and beyond Bad Camberg exits',()=>{
 for(const path of ['A3-koeln','A3-frankfurt']){
  const route=routes[path];assert.ok(route.points.some(p=>p[0]>50.919));assert.ok(route.points.some(p=>p[0]<50.295));
  for(const ref of ['28','29','31','44']){const e=networkData.exits.find(e=>e.road==='A3'&&e.ref===ref);assert.ok(e?.directional?.[path]);assert.notEqual(positionM(route,e.directional[path].position,2),null)}
 }
});
test('partial junctions have their real entry/exit direction without phantom off-ramps',()=>{
 for(const ref of ['30a','30b']){
  const e=networkData.exits.find(e=>e.road==='A3'&&e.ref===ref);assert.ok(e.access);
  for(const path of ['A3-koeln','A3-frankfurt']){
   const row=normalJunctionTraffic(routes[path],networkData.exits,2000).find(j=>j.ref===ref);assert.ok(row);
   assert.equal(row.exitPercent===0,!e.access[path].exit);assert.equal(row.entryVph===0,!e.access[path].entry);
  }
 }
});
test('all eight A3/A560 interchange movements and both A560 carriageways use only original OSM vertices',()=>{
 const source=JSON.parse(readFileSync('data/a3-heumar-camberg-osm.json','utf8'));
 const points=new Set(source.elements.filter(e=>e.type==='way').flatMap(w=>(w.geometry??[]).map(p=>p.lat+','+p.lon)));
 const connections=JSON.parse(readFileSync('data/siegburg-connections.json','utf8')).connections;
 assert.equal(connections.length,8);assert.equal(new Set(connections.map(c=>c.from+'>'+c.to)).size,8);
 for(const f of siegburgContext)for(const p of f.points)assert.ok(points.has(p.join(',')),'fabricated context vertex');
 assert.ok(siegburgContext.some(f=>f.kind==='motorway'&&f.points.at(-1)[1]>f.points[0][1]));
 assert.ok(siegburgContext.some(f=>f.kind==='motorway'&&f.points.at(-1)[1]<f.points[0][1]));
 for(const route of regionalDetours){assert.ok(route.wayIds.length>0);for(const p of route.points)assert.ok(points.has(p.join(',')),'fabricated regional street vertex')}
});
test('events in both new map ends validate within the actual supported bounds',()=>{
 for(const ref of ['29','44']){
  const e=networkData.exits.find(e=>e.road==='A3'&&e.ref===ref);
  assert.equal(validEvent({id:'new-'+ref,kind:'closure',pathKey:'A3-frankfurt',point:e.directional['A3-frankfurt'].position,laneCount:3,closedLanes:[0,1,2],createdAt:'2026-10-31T10:00:00Z',settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}}),true);
 }
});
