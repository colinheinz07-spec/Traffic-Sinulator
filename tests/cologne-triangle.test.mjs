import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {extensionRoutes,extensionJunctions} from '../dist/network-extensions.js';
import {makeCorridors,positionM,routeSlice} from '../dist/spatial.js';
import {defaultDemands,NETWORK_PATHS} from '../dist/traffic.js';
import {initialiseCells,advanceCells,assertCellConservation} from '../dist/traffic-cells.js';
import {extensionCandidates} from '../dist/selection.js';
import {eventFromHit,decodeEvents} from '../dist/events.js';
import {junctionRoute,MOTORWAY_GROUPS} from '../dist/network-presentation.js';
import {roadLaneInfo} from '../dist/lane-info.js';
import {readFileSync} from 'node:fs';
const routes=makeCorridors(networkData.roads,networkData.ramps),exits=[...networkData.exits,...extensionJunctions],demands=defaultDemands();
const added=['extra-a4-aachen','extra-a4-olpe','extra-a559-gremberg','extra-a559-porz'];
test('A3/A4 reaches through Köln-Ost in both directions with real anchors and segment-specific through lanes',()=>{
 const j=networkData.exits.find(e=>e.road==='A3'&&e.ref==='27');assert.ok(j);
 for(const key of ['A3-koeln','A3-frankfurt']){
  assert.ok(routes[key].points.some(p=>p[0]>=50.9605));assert.notEqual(positionM(routes[key],j.directional[key].position,.1),null);
  const northern=networkData.roads.filter(r=>r.road===key&&r.normalLaneCount!==undefined);assert.ok(northern.length>5);
  assert.ok(northern.some(r=>roadLaneInfo(r).count===4));
 }
 const alias=extensionJunctions.find(e=>e.road==='A4'&&e.ref==='16');assert.equal(alias.sharedRoad,'A3');assert.equal(junctionRoute(alias,'A3-koeln'),'A3-koeln');
});
test('Gremberg, Gremberghoven and Porz have directional junction anchors on the new motorway sides',()=>{
 for(const [road,ref] of [['A4','14'],['A4','15'],['A559','1'],['A559','2'],['A559','3']]){
  const j=extensionJunctions.find(e=>e.road===road&&e.ref===ref);assert.ok(j,road+' '+ref);
  assert.equal(Object.keys(j.directional).length,2);
  for(const [key,d] of Object.entries(j.directional))assert.notEqual(positionM(routes[key],d.position,.1),null);
 }
 for(const road of ['A4','A559'])assert.equal(MOTORWAY_GROUPS.find(g=>g.road===road).paths.length,2);
});
test('new A4 geometry joins the existing Heumar corridor without duplicating its shared edges',()=>{
 const edge=(a,b)=>[a.join(','),b.join(',')].sort().join('|');
 const existing=new Set(['A3-koeln','A3-frankfurt','extra-a59-koeln','extra-a59-bonn'].flatMap(k=>routes[k].points.slice(1).map((p,i)=>edge(routes[k].points[i],p))));
 for(const key of ['extra-a4-aachen','extra-a4-olpe']){
  const r=routes[key];assert.ok(r.lengthM>15000&&r.lengthM<27000);
  for(let i=1;i<r.points.length;i++)assert.ok(!existing.has(edge(r.points[i-1],r.points[i])),key+' shared edge');
  const at=key.endsWith('aachen')?r.points[0]:r.points.at(-1);
  assert.ok(['A3-koeln','A3-frankfurt','extra-a59-koeln','extra-a59-bonn'].some(k=>positionM(routes[k],at,.1)!==null));
 }
 for(const key of ['extra-a559-gremberg','extra-a559-porz'])assert.ok(routes[key].lengthM>3000&&routes[key].lengthM<6000);
});
test('all four new directions are selectable, persist events and conserve traffic during blockage and release',()=>{
 for(const key of added){
  const feature=extensionRoutes.find(r=>r.id===key),point=feature.points[Math.floor(feature.points.length/2)],scale=100000;
  const hit=extensionCandidates([point[1]*scale,point[0]*scale],p=>[p[1]*scale,p[0]*scale],.1).find(h=>h.key===key);assert.ok(hit);
  const event=eventFromHit(hit,'accident',feature.lanes,Array.from({length:feature.lanes},(_,i)=>i),'test-'+key,'2026-11-01T08:00:00Z');
  assert.equal(decodeEvents(JSON.stringify([event]))[0].pathKey,key);assert.ok(NETWORK_PATHS.includes(key));
  let grid=initialiseCells(routes[key],demands[key]);for(let i=0;i<15;i++){grid=advanceCells(grid,routes[key],[event],demands[key],exits);assertCellConservation(grid);}
  assert.ok(grid.cells.some(c=>c.speedKmh<10));
  for(let i=0;i<25;i++){grid=advanceCells(grid,routes[key],[],demands[key],exits);assertCellConservation(grid);}
  assert.ok(grid.cells.every(c=>Number.isFinite(c.speedKmh)));
 }
});
test('legacy Heumar fragment IDs remain usable for stored events',()=>{
 const previous=JSON.parse(readFileSync('data/legacy-extension-paths.json','utf8'));
 for(const r of previous)assert.ok(extensionRoutes.some(f=>f.id===r.id),r.id);
});
