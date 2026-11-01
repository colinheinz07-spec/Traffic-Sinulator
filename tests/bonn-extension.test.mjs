import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {networkData} from '../dist/geodata.js';
import {extensionRoutes,extensionJunctions} from '../dist/network-extensions.js';
import {makeCorridors} from '../dist/spatial.js';
import {buildExtensionConnections} from '../dist/extension-connections.js';
import {extensionDetours} from '../dist/extension-detours.js';
import {demandAtClock,defaultDemands} from '../dist/traffic.js';
import {junctionRoute,MOTORWAY_PATHS} from '../dist/network-presentation.js';
const routes=makeCorridors(networkData.roads,networkData.ramps);
const exits=[...networkData.exits,...extensionJunctions];
test('A59 reaches Bonn-Ost in both directions and the complete A562 crosses the Rhine',()=>{
 for(const key of ['extra-a59-bonn','extra-a59-koeln']){
  const r=routes[key];assert.ok(r.lengthM>25000&&r.lengthM<28000,key);
  assert.ok(r.points.some(p=>p[0]<50.73));assert.ok(MOTORWAY_PATHS.includes(key));
 }
 for(const key of ['extra-a562-bonn','extra-a562-bonn-ost']){
  const r=routes[key],feature=extensionRoutes.find(r=>r.id===key);
  assert.ok(r.lengthM>3000&&r.lengthM<4000,key);
  assert.ok(Math.min(...r.points.map(p=>p[1]))<7.133&&Math.max(...r.points.map(p=>p[1]))>7.158);
  assert.equal(feature.lanes,2);assert.ok(feature.laneSegments.every(s=>s.lanes<=2));
 }
 for(const [road,refs] of [['A59',['40','41','42','43']],['A562',['2','3','4','5']]])for(const ref of refs){
  const j=exits.find(j=>j.road===road&&j.ref===ref);assert.ok(j,road+':'+ref);
  assert.equal(Object.keys(j.directional).length,2,road+':'+ref+' has directional anchors');
  assert.ok(junctionRoute(j,'A3-koeln'));
 }
});
test('A562 geometry contains only retained directed OSM motorway edges',async()=>{
 const data=JSON.parse(await readFile(new URL('../data/bonn-a59-a562-osm.json',import.meta.url),'utf8'));
 const edges=new Set();
 for(const way of data.elements.filter(e=>e.type==='way'&&e.tags?.highway==='motorway')){
  const ps=way.geometry.map(p=>[p.lat,p.lon]);if(way.tags.oneway==='-1')ps.reverse();
  for(let i=1;i<ps.length;i++)edges.add(JSON.stringify([ps[i-1],ps[i]]));
 }
 for(const key of ['extra-a562-bonn','extra-a562-bonn-ost']){
  const points=routes[key].points;for(let i=1;i<points.length;i++)assert.ok(edges.has(JSON.stringify([points[i-1],points[i]])),key+' edge '+i);
 }
});
test('Bonn-Ost turns connect exact carriageways and Bonn junctions have usable detours',()=>{
 const links=buildExtensionConnections(routes);
 for(const [from,to] of [['extra-a59-bonn','extra-a562-bonn'],['extra-a562-bonn-ost','extra-a59-koeln']]){
  const link=links.find(c=>c.from===from&&c.to===to);assert.ok(link,from+' to '+to);
  const ramp=routes[link.rampId];assert.ok(routes[from].points.some(p=>String(p)===String(ramp.points[0])));
  assert.ok(routes[to].points.some(p=>String(p)===String(ramp.points.at(-1))));
 }
 for(const [path,ref] of [['extra-a59-bonn','41'],['extra-a59-bonn','42'],['extra-a562-bonn','4'],['extra-a562-bonn-ost','3']])
  assert.ok(extensionDetours.some(d=>d.path===path&&d.fromRef===ref&&d.points.length>2&&d.freeMinutes>0),path+':'+ref);
});
test('A562 has directional commuting and quieter weekend demand',()=>{
 const base=defaultDemands(),morning=demandAtClock(base,new Date(2026,10,2,7,30)),night=demandAtClock(base,new Date(2026,10,2,2)),weekend=demandAtClock(base,new Date(2026,10,1,7,30));
 for(const key of ['extra-a562-bonn','extra-a562-bonn-ost']){
  assert.ok(morning[key]>night[key]*3);assert.ok(morning[key]>weekend[key]);assert.ok(Number.isFinite(morning[key]));
 }
});
