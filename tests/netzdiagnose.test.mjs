import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {extensionJunctions} from '../dist/network-extensions.js';
import {makeCorridors} from '../dist/spatial.js';
import {directionNetworkAudit,validateNetworkAudit} from '../dist/01_Strassennetz/netzdiagnose.js';
import {diversionJunctions} from '../dist/diversions.js';
import {junctionRampBindings} from '../dist/junction-ramp-bindings.js';
import {buildExtensionConnections} from '../dist/extension-connections.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
const exits=[...networkData.exits,...extensionJunctions];
const paths=['A3-koeln','A3-frankfurt','A48-dernbach','A48-koblenz',
 'extra-a59-koeln','extra-a59-bonn','extra-a560-bonn','extra-a4-aachen',
 'extra-a559-gremberg','extra-a555-bonn','extra-a565-siegburg'];

test('audit uses real direction-specific OSM AS anchors and does not silently fabricate junctions',()=>{
 for(const path of paths){
  const audit=directionNetworkAudit(path,routes,exits);
  const anchors=diversionJunctions(path,exits,routes[path]);
  assert.ok(audit.routeExists,path);
  assert.ok(audit.lengthKm>0,path);
  assert.equal(audit.ordinaryJunctions,anchors.filter(j=>!j.isInterchange).length,path);
  assert.equal(audit.interchanges,anchors.filter(j=>j.isInterchange).length,path);
  assert.deepEqual(audit.accesses.map(j=>j.ref),
   anchors.filter(j=>!j.isInterchange).map(j=>j.ref),path);
  assert.deepEqual(validateNetworkAudit(audit),[],path);
  assert.equal(audit.accesses.some(j=>j.name.startsWith('AK ')||j.name.startsWith('AD ')),false);
  assert.equal(audit.unboundAccesses,audit.accesses.reduce((n,j)=>
   n+Number(j.entry==='review')+Number(j.exit==='review'),0));
 }
});
test('physical ramp bindings in the audit are the same identifiers the queue solver uses',()=>{
 const path='A3-koeln',audit=directionNetworkAudit(path,routes,exits);
 const montabaur=audit.accesses.find(j=>j.ref==='40');
 assert.ok(montabaur);
 assert.equal(montabaur.entry,'bound');
 assert.equal(montabaur.exit,'bound');
 const bindings=junctionRampBindings(routes[path],exits).filter(b=>b.ref==='40');
 for(const b of bindings){
  const actual=b.segments.map(s=>s.ramp.id);
  const listed=b.kind==='entry'?montabaur.entryRamps:montabaur.exitRamps;
  for(const id of actual)assert.ok(listed.includes(id),id);
 }
});
test('a ramp is not a local AS and its directed OSM connections are not guessed',()=>{
 const links=buildExtensionConnections(routes);
 const row=links.find(x=>x.rampId.startsWith('extra-siegburg-'));
 assert.ok(row);
 const audit=directionNetworkAudit(row.rampId,routes,exits);
 assert.equal(audit.road,null);
 assert.equal(audit.ordinaryJunctions,0);
 assert.ok(audit.exactMainlineLinks>=1);
 assert.deepEqual(validateNetworkAudit(audit),[]);
});
test('a genuinely unknown route is reported as a structural error, not mapped to a nearby motorway',()=>{
 const audit=directionNetworkAudit('unbekannte-strasse',routes,exits);
 assert.equal(audit.routeExists,false);
 assert.ok(validateNetworkAudit(audit).some(x=>x.includes('Geometrie fehlt')));
 assert.equal(audit.exactMainlineLinks,0);
 assert.equal(audit.ordinaryJunctions,0);
});
test('network check is a read-only view and is available in the mobile interface',()=>{
 const before=routes['A3-koeln'].lengthM, first=exits[0].name;
 const snap=directionNetworkAudit('A3-koeln',routes,exits);
 assert.ok(snap.accesses.length>=8);
 assert.equal(routes['A3-koeln'].lengthM,before);
 assert.equal(exits[0].name,first);
 const html=readFileSync('index.html','utf8');
 const app=readFileSync('src/app.ts','utf8');
 assert.match(html,/id="network-audit-panel"/);
 assert.match(html,/id="network-audit-list"/);
 assert.match(app,/renderNetworkAudit\(key,spatialCorridors,exits\)/);
 assert.match(app,/network-audit-panel.*addEventListener\('toggle'/);
 assert.doesNotMatch(readFileSync('src/01_Strassennetz/netzdiagnose.ts','utf8'),
  /Math\.random|\.push\(\{.*kind:'ramp'/);
});
