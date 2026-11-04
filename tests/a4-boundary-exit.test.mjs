import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extensionDetours} from '../dist/extension-detours.js';
import {extensionJunctions} from '../dist/network-extensions.js';

test('A4 Köln-Eifeltor exit 11b leaves only via directed OSM ramp until mapped boundary',()=>{
 const exit=extensionJunctions.find(e=>e.road==='A4'&&e.ref==='11b');
 assert.ok(exit,'OSM junction missing');
 const record=extensionDetours.find(e=>e.path==='extra-a4-olpe'&&e.fromRef==='11b');
 assert.ok(record,'a legal exit must not be silently removed');
 assert.equal(record.toRef,'end','do not invent an unverified motorway re-entry');
 assert.equal(record.unmappedBoundary,true,'mark a ramp ending outside mapped local-road coverage');
 const ways=JSON.parse(readFileSync('data/a4-koeln-west-osm.json','utf8')).elements
  .filter(e=>e.type==='way'&&e.tags?.highway==='motorway_link');
 const edgeSet=new Set(ways.flatMap(w=>{
  const ps=w.geometry.map(p=>[Number(p.lat.toFixed(7)),Number(p.lon.toFixed(7))]);
  if(w.tags.oneway==='-1')ps.reverse();
  return ps.slice(1).map((p,i)=>JSON.stringify([ps[i],p]));
 }));
 assert.ok(record.points.length>3);
 for(let i=1;i<record.points.length;i++)
  assert.ok(edgeSet.has(JSON.stringify([record.points[i-1],record.points[i]])),
   'invented A4 exit link at segment '+i);
});
