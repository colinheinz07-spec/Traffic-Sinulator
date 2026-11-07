import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extensionRoutes} from '../dist/network-extensions.js';

test('service-area-only ramps are not displayed as public motorway exits',()=>{
 const ids=new Set(extensionRoutes.map(x=>x.id));
 for(const id of ['extra-heumar-27005183','extra-heumar-326138777','extra-heumar-407517104'])
  assert.equal(ids.has(id),false,id+' is not an Autobahnanschlussstelle');
});
test('rest-area cleanup must never remove existing Bonn, Köln or other major autobahn corridors',()=>{
 const ids=new Set(extensionRoutes.filter(x=>x.kind==='motorway').map(x=>x.id));
 for(const key of ['extra-a4-aachen','extra-a4-olpe','extra-a59-koeln','extra-a59-bonn',
  'extra-a555-bonn','extra-a555-koeln','extra-a565-koblenz','extra-a565-siegburg',
  'extra-a560-bonn','extra-a560-hennef']){
  assert.ok(ids.has(key),key+' must survive graph cleanup');
 }
 const raw=JSON.parse(readFileSync('data/extension-junctions.json','utf8'));
 // Original generator output must remain intact. The 133 additional
 // OSM-verified ways are supplied separately by osm-zusatzrampen.ts.
 assert.deepEqual(new Set(raw.routes.map(r=>r.id)),
  new Set(extensionRoutes.filter(r=>!r.id.startsWith('extra-osm-link-')).map(r=>r.id)));
 assert.ok(extensionRoutes.some(r=>r.id.startsWith('extra-osm-link-')));
});
