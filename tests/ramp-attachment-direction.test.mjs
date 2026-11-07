import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {extensionRoutes} from '../dist/network-extensions.js';
import {makeCorridors} from '../dist/spatial.js';
import {buildExtensionConnections} from '../dist/extension-connections.js';
import {motorwayEndpointIndex} from '../dist/network-topology.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);

test('Köln-Heumar: a ramp attaches to the continuing A3, not the terminating A4 corridor',()=>{
 const id='extra-heumar-132614489',ramp=extensionRoutes.find(r=>r.id===id);
 assert.ok(ramp,'verified OSM connector missing');
 const endpoint=ramp.points.at(-1);
 const index=motorwayEndpointIndex(routes,['extra-a4-olpe','A3-koeln']);
 const hits=index.at(endpoint);
 assert.ok(hits.some(h=>h.key==='extra-a4-olpe'),'ambiguous endpoint must include A4');
 assert.ok(hits.some(h=>h.key==='A3-koeln'),'ambiguous endpoint must include A3');
 const a4=hits.find(h=>h.key==='extra-a4-olpe');
 assert.ok(routes['extra-a4-olpe'].lengthM-a4.metre<10,'A4 ends at this fork');
 const link=buildExtensionConnections(routes).find(l=>l.rampId===id);
 assert.ok(link,'connector must remain in the network');
 assert.equal(link.to,'A3-koeln','vehicles must not be sent into an already terminating A4 segment');
 assert.ok(routes[link.to].lengthM-link.downstreamMergeM>10,'merge must have downstream receiving roadway');
});
