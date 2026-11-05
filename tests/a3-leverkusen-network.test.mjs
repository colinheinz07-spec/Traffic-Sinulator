import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {extensionRoutes,extensionJunctions} from '../dist/network-extensions.js';
import {makeCorridors,metres} from '../dist/spatial.js';
import {buildExtensionConnections} from '../dist/extension-connections.js';
import {junctionRampBindings} from '../dist/junction-ramp-bindings.js';
const core=makeCorridors(networkData.roads,networkData.ramps);
const ways=JSON.parse(readFileSync('data/a3-leverkusen-osm.json','utf8')).elements.filter(e=>e.type==='way');
const edges=new Set();
const key=p=>p[0].toFixed(7)+','+p[1].toFixed(7);
for(const w of ways)if(w.geometry?.length){
 const ps=w.geometry.map(p=>[p.lat,p.lon]);if(w.tags.oneway==='-1')ps.reverse();
 for(let i=1;i<ps.length;i++)edges.add(key(ps[i-1])+'>'+key(ps[i]));
}
test('A3 mainlines extend to AK Leverkusen with four genuine directional A3 junction anchors',()=>{
 const refs=['23','24','25','26'];
 for(const path of ['A3-koeln','A3-frankfurt']){
  const p=core[path];assert.ok(p.points.some(x=>x[0]>51.037));
  for(const ref of refs){
   const raw=networkData.exits.find(j=>j.road==='A3'&&j.ref===ref);
   assert.ok(raw?.directional?.[path]?.nodeId>0,ref+' '+path);
   assert.ok(p.points.some(x=>key(x)===key(raw.directional[path].position)));
  }
 }
});
test('both A1 Leverkusen carriageways and AK turn paths use only original directed OSM edges',()=>{
 const ids=['extra-a1-leverkusen-dortmund','extra-a1-leverkusen-koeln'];
 for(const id of ids){const r=extensionRoutes.find(x=>x.id===id);assert.ok(r&&r.kind==='motorway'&&core[id].lengthM>5000);}
 const turns=extensionRoutes.filter(x=>x.id.startsWith('extra-leverkusen-turn-'));
 assert.ok(turns.length>=4,'at least four A3/A1 turns must be proven');
 for(const feature of [...extensionRoutes.filter(x=>ids.includes(x.id)),...turns]){
  for(let i=1;i<feature.points.length;i++)
   assert.ok(edges.has(key(feature.points[i-1])+'>'+key(feature.points[i])),feature.id+' edge '+i);
  assert.ok(feature.laneSegments.every(s=>s.toM>s.fromM&&s.lanes>=1));
 }
 const joins=buildExtensionConnections(core);
 for(const turn of turns){
  const row=joins.find(j=>j.rampId===turn.id);
  assert.ok(row,row?.rampId??turn.id);
  assert.ok(['A3-koeln','A3-frankfurt',...ids].includes(row.from));
  assert.ok(['A3-koeln','A3-frankfurt',...ids].includes(row.to));
  assert.ok(row.from.startsWith('A3-')!==row.to.startsWith('A3-'));
 }
 assert.ok(extensionJunctions.some(e=>e.road==='A1'&&e.ref==='98'));
});

test('each new regular A3 Leverkusen AS has real entry and exit ramp chains on both carriageways',()=>{
 const exits=[...networkData.exits,...extensionJunctions];
 for(const direction of ['A3-koeln','A3-frankfurt']){
  const bindings=junctionRampBindings(core[direction],exits);
  for(const ref of ['24','25','26']){
   const matching=bindings.filter(b=>b.ref===ref);
   assert.ok(matching.some(b=>b.kind==='exit'),direction+' AS'+ref+' must have an OSM exit ramp');
   assert.ok(matching.some(b=>b.kind==='entry'),direction+' AS'+ref+' must have an OSM entry ramp');
   for(const b of matching){
    assert.ok(b.lengthM>10&&b.lanes>=1);
    for(const segment of b.segments)assert.ok(segment.ramp.points.length>1);
   }
  }
 }
});
