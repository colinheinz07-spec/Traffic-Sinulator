import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {extensionJunctions} from '../dist/network-extensions.js';
import {makeCorridors,positionM,routeSlice,closureGate} from '../dist/spatial.js';
import {closedNetworkSpans} from '../dist/closure-network.js';
import {exitPosition} from '../dist/core.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
const exits=[...networkData.exits,...extensionJunctions];
const a3=routes['A3-koeln'];
const heumar=exits.find(e=>e.road==='A3'&&e.ref==='28');
const ost=exits.find(e=>e.road==='A3'&&e.ref==='27');

test('A3 towards Koeln: closure from AD Heumar to AK Koeln-Ost never starts at the earlier AS',()=>{
 assert.ok(heumar&&ost,'both directional, mapped motorway junctions must be present');
 assert.ok(heumar.directional?.['A3-koeln']?.nodeId>0,'Heumar must have a verified directional OSM node');
 const from=positionM(a3,exitPosition(heumar,'A3-koeln'),900);
 const until=positionM(a3,exitPosition(ost,'A3-koeln'),900);
 assert.ok(from!==null&&until!==null&&until-from>1200,'junctions must be in driving order');
 const markerM=from+(until-from)*.38;
 const event={
  id:'heumar-to-koeln-ost',kind:'closure',pathKey:'A3-koeln',
  point:routeSlice(a3,markerM,markerM+1)[0],
  closedLanes:[0,1,2],laneCount:3,createdAt:'2026-11-11T12:00:00Z',
  settings:{lengthM:250,speedKmh:0,shoulder:'blocked'}
 };
 const gate=closureGate(a3,event,exits,[event]);
 assert.equal(gate?.exit?.ref,'28','AD Heumar is the last mapped motorway divergence before this closure');
 assert.equal(gate?.endExit?.ref,'27','do not close past AK Koeln-Ost');
 assert.ok(Math.abs(gate.metre-from)<2,'closure must begin at verified Heumar node, not earlier');
 assert.ok(Math.abs(gate.endM-until)<2);
 const spans=closedNetworkSpans([event],routes,exits,[]);
 assert.equal(spans.find(s=>s.pathKey==='A3-koeln')?.fromM,gate.metre);
 assert.equal(spans.find(s=>s.pathKey==='A3-koeln')?.toM,gate.endM);
 assert.ok(!spans.some(s=>s.pathKey==='A3-frankfurt'),'opposite carriageway remains open');
});
