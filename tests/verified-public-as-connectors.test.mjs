import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {publicAccessConnectors} from '../dist/01_Strassennetz/osm-anschlussstrassen.js';
import {NETWORK_ROUTE_KEYS} from '../dist/network-catalog.js';

const sources=[
 'a3-heumar-camberg-osm.json','a3-wiesbaden-osm.json',
 'a4-koeln-sued-osm.json','a4-koeln-west-osm.json',
 'a555-a565-bonn-osm.json','bonn-a59-a562-osm.json',
 'a59-a560-osm.json','cologne-triangle-osm.json'
];
const key=p=>[p[0],p[1]].join(',');
const pair=(a,b)=>[key(a),key(b)].sort().join('|');

test('short public OSM links complete the map between actual motorway ramps at many junctions',()=>{
 assert.ok(publicAccessConnectors.length>=290,'expected public-street connector segments');
 const areas=new Set(publicAccessConnectors.map(x=>x.name));
 assert.ok(areas.size>=30, 'solution must be network-wide, not a one-exit overlay');
 for(const name of ['A4 AS 13 Köln-Poll','A3 AS 45 Idstein','A3 AS 31 Lohmar','A559 AS 2 Köln-Gremberghoven']){
  assert.ok(areas.has(name),'unrepaired access between the motorway ramps: '+name);
 }
 assert.ok(publicAccessConnectors.every(x=>x.id.startsWith('access-osm-')&&x.points.length>1));
});
test('every drawn AS connector edge is an exact consecutive edge of a public OSM way',()=>{
 const needed=new Set(publicAccessConnectors.map(c=>c.sourceWayId));
 const original=new Map();
 for(const file of sources){
  const data=JSON.parse(readFileSync('data/'+file,'utf8'));
  for(const way of data.elements){
   if(way.type==='way'&&needed.has(way.id)){
    const old=original.get(way.id);
    if(!old||way.geometry?.length>old.geometry?.length)original.set(way.id,way);
   }
  }
 }
 const publicKinds=new Set(['trunk','trunk_link','primary','primary_link','secondary','secondary_link',
  'tertiary','tertiary_link','residential','unclassified','living_street']);
 const banned=new Set(['no','private']);
 const occupied=new Set();
 for(const connector of publicAccessConnectors){
  const way=original.get(connector.sourceWayId);
  assert.ok(way,'missing source street '+connector.sourceWayId);
  assert.ok(publicKinds.has(way.tags.highway),'not a real public AS road '+way.id);
  for(const access of ['access','motor_vehicle','motorcar'])
   assert.ok(!banned.has(way.tags[access]),'private/closed access cannot be drawn '+way.id);
  const edges=new Set();
  for(let i=1;i<way.geometry.length;i++){
   const a=[way.geometry[i-1].lat,way.geometry[i-1].lon],b=[way.geometry[i].lat,way.geometry[i].lon];
   edges.add(pair(a,b));
  }
  for(let i=1;i<connector.points.length;i++){
   const edge=pair(connector.points[i-1],connector.points[i]);
   assert.ok(edges.has(edge),'fabricated non-OSM edge '+way.id+':'+edge);
   assert.ok(!occupied.has(edge),'same physical street painted more than once: '+edge);
   occupied.add(edge);
  }
 }
});
test('real local access road display never generates standalone motorway traffic',()=>{
 const model=new Set(NETWORK_ROUTE_KEYS);
 assert.ok(publicAccessConnectors.every(x=>!model.has(x.id)),
  'a real public street was silently turned into a simulated motorway link');
 const app=readFileSync('src/app.ts','utf8');
 const html=readFileSync('index.html','utf8');
 assert.match(app,/for\(const access of publicAccessConnectors\)/);
 assert.match(app,/#1b9f81/);
 assert.match(html,/AS-Verbindungsstraße \(OSM; noch ohne eigene Stauphysik\)/);
});

test('OSM junction street connectors regenerate deterministically from pinned snapshots',()=>{
 const result=spawnSync(process.execPath,['scripts/build_public_access_connectors.mjs','--check'],{
  encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024
 });
 assert.equal(result.status,0,result.stderr||result.error?.message||result.stdout);
});
