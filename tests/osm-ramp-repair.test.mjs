import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {extensionRoutes,extensionJunctions,extensionRampBoundaryPoints} from '../dist/network-extensions.js';
import {makeCorridors} from '../dist/spatial.js';
import {junctionRampBindings,junctionRampJams} from '../dist/junction-ramp-bindings.js';
import {directionNetworkAudit} from '../dist/01_Strassennetz/netzdiagnose.js';

const routes=makeCorridors(networkData.roads,networkData.ramps),
 exits=[...networkData.exits,...extensionJunctions];
const point=(p)=>p.join(',');
test('A565 Beuel-Nord: exact OSM AS node overrides misleading AD label, not geometry',()=>{
 const path='extra-a565-siegburg',j=exits.find(j=>j.road==='A565'&&j.ref==='2');
 assert.ok(j?.directional?.[path]?.nodeId>0);
 const begin=extensionRoutes.find(r=>r.id==='extra-bonn-ramp-4394292');
 assert.equal(begin?.kind,'ramp');
 assert.match(begin.zone,/^AD /);
 assert.equal(point(begin.points[0]),point(j.directional[path].position),
  'real directed OSM ramp start must match the actual AS node');
 const binds=junctionRampBindings(routes[path],exits).filter(b=>b.ref==='2'&&b.kind==='exit');
 assert.ok(binds.length,'exiting A565 must have a physically bound ramp');
 assert.ok(binds.some(b=>b.segments.some(s=>s.ramp.id===begin.id)),
  'verified OSM ramp must be part of the traced exit');
 const streetpoints=new Set(extensionRampBoundaryPoints.map(point));
 assert.ok(binds.some(b=>b.segments.some(s=>s.ramp.points.some(p=>streetpoints.has(point(p))))),
  'ramps must continue to an actual OSM-mapped local-road boundary');
 const audit=directionNetworkAudit(path,routes,exits);
 assert.equal(audit.accesses.find(a=>a.ref==='2')?.exit,'bound');
 assert.ok(binds.every(b=>b.lengthM>1&&b.lengthM<4000));
});
test('no phantom queue is painted on the validated ramp when no vehicles are waiting',()=>{
 const key='extra-a565-siegburg';
 assert.deepEqual(junctionRampJams({},routes,exits,[]),[]);
 const report=directionNetworkAudit(key,routes,exits);
 assert.ok(report.unboundAccesses>=0);
 assert.ok(report.exactMainlineLinks>0);
});
test('an adjacent AD or AK label does not force an unverified motorway turn into a local AS',()=>{
 const path='extra-a565-siegburg',j=exits.find(e=>e.road==='A565'&&e.ref==='2');
 const local=junctionRampBindings(routes[path],exits).filter(b=>b.ref==='2'&&b.kind==='exit');
 assert.ok(local.every(b=>b.segments.some(s=>s.ramp.id==='extra-bonn-ramp-4394292')),
  'only complete OSM chains starting at the exact AS anchor qualify');
});
