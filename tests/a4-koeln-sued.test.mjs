import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {extensionRoutes,extensionJunctions} from '../dist/network-extensions.js';
import {makeCorridors} from '../dist/spatial.js';
import {buildExtensionConnections} from '../dist/extension-connections.js';
import {junctionRampBindings} from '../dist/junction-ramp-bindings.js';
import {demandAtClock,defaultDemands} from '../dist/traffic.js';
import {networkRoad} from '../dist/network-road.js';
const routes=makeCorridors(networkData.roads,networkData.ramps);
const exits=[...networkData.exits,...extensionJunctions];
const feature=id=>extensionRoutes.find(f=>f.id===id);

test('A4 extends in both OSM-directed carriageways from Gremberg across Rodenkirchen bridge to AK Köln-Süd',()=>{
 for(const id of ['extra-a4-aachen','extra-a4-olpe']){
  const f=feature(id),route=routes[id];assert.ok(f);
  assert.ok(route.lengthM>8000,id+' missing extended motorway geometry');
  assert.ok(f.points.some(p=>p[1]<6.964&&p[0]<50.90),id+' does not reach the southwestern interchange');
  assert.ok(f.points.some(p=>p[1]>7.03),id+' lost the existing Heumar connection');
  assert.ok(f.laneSegments.some(s=>s.lanes===3),id+' lost existing normal three-lane carriageway');
 }
 assert.ok(feature('extra-a4-aachen').points.at(-1)[1]<6.964);
 assert.ok(feature('extra-a4-olpe').points[0][1]<6.964);
});

test('A555 connects both directions to AK Köln-Süd and Rodenkirchen without fictitious straight segments',()=>{
 // Extended A555 edges are verified against both actual OSM source snapshots.
 const elements=['data/a4-koeln-sued-osm.json','data/a555-a565-bonn-osm.json']
  .flatMap(file=>JSON.parse(readFileSync(file,'utf8')).elements);
 const edges=new Set(elements.filter(e=>e.type==='way'&&e.tags?.highway==='motorway')
  .flatMap(w=>{const pts=w.geometry.map(p=>[p.lat,p.lon]);
   if(w.tags.oneway==='-1')pts.reverse();
   return pts.slice(1).map((p,i)=>JSON.stringify([pts[i],p]));}));
 for(const id of ['extra-a555-bonn','extra-a555-koeln']){
  const f=feature(id);assert.ok(f&&f.points.length>8);
  assert.ok(routes[id].lengthM>14000&&routes[id].lengthM<26000);
  assert.equal(networkRoad(id),'A555');
  for(let i=1;i<f.points.length;i++)assert.ok(edges.has(JSON.stringify([f.points[i-1],f.points[i]])),id+' missing exact OSM way edge '+i);
 }
});

test('AS Köln-Poll 13, AK Köln-Süd 12 and A555 AK 2/AS Rodenkirchen 3 are directional',()=>{
 for(const [road,ref,keys] of [
  ['A4','12',['extra-a4-aachen','extra-a4-olpe']],
  ['A4','13',['extra-a4-aachen','extra-a4-olpe']],
  ['A555','2',['extra-a555-bonn','extra-a555-koeln']],
  ['A555','3',['extra-a555-bonn','extra-a555-koeln']]
 ]){
  const j=exits.find(x=>x.road===road&&x.ref===ref);assert.ok(j,road+' '+ref);
  for(const key of keys){
   assert.ok(j.directional?.[key],road+'/'+ref+' '+key);
   assert.ok(routes[key].points.some(p=>JSON.stringify(p)===JSON.stringify(j.directional[key].position)));
  }
 }
});

test('verified south Cologne ramp branches are selectable; actual connector links feed other motorway lanes',()=>{
 const links=buildExtensionConnections(routes),near=extensionRoutes.filter(f=>f.kind==='ramp'&&f.zone?.includes('Köln-Süd'));
 assert.ok(near.length>=2);
 const turns=links.filter(l=>l.from.startsWith('extra-a4-')&&l.to.startsWith('extra-a555-')||
  l.to.startsWith('extra-a4-')&&l.from.startsWith('extra-a555-'));
 assert.ok(turns.length>=2,'A4-A555 direct links do not have shared exact endpoint nodes');
 assert.ok(near.some(f=>f.points.some(p=>p[0]>50.88&&p[0]<50.898&&p[1]<6.985)));
});

test('new A555 directions use ring rush-hour profiles; weekends are quieter',()=>{
 const now=new Date(2026,10,2,7,30),sunday=new Date(2026,10,1,7,30);
 const wd=demandAtClock(defaultDemands(),now),we=demandAtClock(defaultDemands(),sunday);
 for(const path of ['extra-a555-bonn','extra-a555-koeln'])
  assert.ok(wd[path]>we[path]&&wd[path]>0,path+' profile');
});
