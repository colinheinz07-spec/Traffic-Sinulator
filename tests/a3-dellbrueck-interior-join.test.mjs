import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extensionRoutes,extensionRampBoundaryPoints} from '../dist/network-extensions.js';
import {NETWORK_ROUTE_KEYS} from '../dist/network-catalog.js';
import {defaultDemand} from '../dist/traffic.js';

test('B506 to A3 Dellbrueck: the missing real one-way OSM slip joins an interior ramp node',()=>{
 const snapshot=JSON.parse(readFileSync('data/a3-leverkusen-osm.json','utf8'));
 const way=snapshot.elements.find(w=>w.type==='way'&&w.id===26802112);
 assert.ok(way?.geometry?.length>=2);
 assert.equal(way.tags.highway,'motorway_link');
 assert.equal(way.tags.oneway,'yes');
 const slip=extensionRoutes.find(r=>r.id==='extra-a3-lev-ramp-26802112');
 const collector=extensionRoutes.find(r=>r.id==='extra-a3-lev-ramp-9620185');
 assert.ok(slip&&collector,'both real OSM ramp fragments must be modelled');
 assert.equal(slip.kind,'ramp');
 assert.equal(slip.demandVph,0,'no phantom standalone traffic on raw link fragment');
 assert.equal(defaultDemand(slip.id),0);
 assert.ok(NETWORK_ROUTE_KEYS.includes(slip.id));
 assert.deepEqual(slip.points,way.geometry.map(p=>[p.lat,p.lon]),
  'never interpolate, snap or invent a shortcut');
 const arrival=slip.points.at(-1);
 const index=collector.points.findIndex(p=>p[0]===arrival[0]&&p[1]===arrival[1]);
 assert.ok(index>0&&index<collector.points.length-1,
  'this connection is an OSM interior vertex, not an endpoint');
 assert.ok(extensionRampBoundaryPoints.some(p=>p[0]===slip.points[0][0]&&p[1]===slip.points[0][1]),
  'street-side end is registered for physical local ramp access');
});
