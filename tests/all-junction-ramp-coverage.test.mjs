import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {extensionJunctions,extensionRoutes} from '../dist/network-extensions.js';
import {verifiedRampGapRoutes} from '../dist/01_Strassennetz/osm-rampenluecken.js';

const report=JSON.parse(readFileSync('data/ramp-gap-repair-audit.json','utf8'));
const exits=[...networkData.exits,...extensionJunctions];
test('every numbered junction participates in the motorway_link source coverage audit',()=>{
 assert.equal(report.nationwide.junctionsAudited,exits.length,
  'all AS, AD and AK must be scanned, not only Idstein/Limburg/Montabaur');
 assert.equal(report.nationwide.connectedStillUncoveredWays,0,
  'a source-connected motorway ramp is still missing from the generated network');
 assert.ok(report.nationwide.eligibleUncoveredWays>=report.nationwide.connectedMissingWays);
 assert.equal(report.nationwide.routesImported,verifiedRampGapRoutes.length);
 const ids=new Set(extensionRoutes.map(x=>x.id));
 assert.ok(verifiedRampGapRoutes.every(x=>ids.has(x.id)));
});

test('unresolved OSM ways remain explicit in the diagnostic report, never fake snapped onto the network',()=>{
 const pending=report.nationwide.unresolvedOsmWayDetails;
 assert.ok(Array.isArray(pending),'the full-AS diagnostic report must contain unresolved original ways');
 assert.equal(pending.length,
  report.nationwide.eligibleUncoveredWays-report.nationwide.connectedMissingWays);
 const total=Object.values(report.nationwide.unresolvedByJunction).reduce((a,b)=>a+b,0);
 assert.equal(total,pending.length);
 assert.ok(pending.every(x=>Number.isInteger(x.wayId)&&x.wayId>0&&
  Array.isArray(x.centre)&&x.centre.length===2&&x.metres>0));
 const listed=new Set(pending.map(x=>x.wayId));
 assert.equal(listed.size,pending.length);
});
