import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {extensionJunctions,extensionRoutes,extensionRampBoundaryPoints} from '../dist/network-extensions.js';
import {makeCorridors} from '../dist/spatial.js';
import {junctionRampBindings} from '../dist/junction-ramp-bindings.js';

test('A4 Köln-Eifeltor exit is physically joined along its >8 genuine OSM ramp segments',()=>{
 const routes=makeCorridors(networkData.roads,networkData.ramps);
 const exits=[...networkData.exits,...extensionJunctions];
 const bindings=junctionRampBindings(routes['extra-a4-aachen'],exits)
  .filter(b=>b.ref==='11b'&&b.kind==='exit');
 const firstWay='extra-koelnwest-link-30760401';
 const complete=bindings.find(b=>b.segments[0]?.ramp.id===firstWay&&b.segments.length>8);
 assert.ok(complete,'A4 11b exit must not be truncated after eight actual OSM ways');
 assert.ok(complete.lengthM>100&&complete.lengthM<4000);
 assert.equal(complete.segments.length,new Set(complete.segments.map(s=>s.ramp.id)).size,
  'the same physical way cannot be repeated in a ramp chain');
 for(let i=1;i<complete.segments.length;i++){
  assert.deepEqual(complete.segments[i-1].ramp.points.at(-1),
   complete.segments[i].ramp.points[0],
   'OSM way chain must meet at one exactly shared endpoint');
 }
 assert.ok(Math.abs(complete.segments.at(-1).toM-complete.lengthM)<.01);
 const importedIds=new Set(extensionRoutes.map(r=>r.id));
 assert.ok(complete.segments.every(s=>importedIds.has(s.ramp.id)),
  'an unverified geometric shortcut was introduced');
 const publicEnds=new Set(extensionRampBoundaryPoints.map(p=>p.join(',')));
 assert.ok(complete.segments.at(-1).ramp.points.some(p=>publicEnds.has(p.join(','))),
  'local ramp must end at a verified public-street boundary');
});
