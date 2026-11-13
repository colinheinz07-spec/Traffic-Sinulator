import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {extensionJunctions} from '../dist/network-extensions.js';
import {buildExtensionConnections} from '../dist/extension-connections.js';
import {buildRampConnections} from '../dist/interchange.js';
import {makeCorridors,closureGate,positionM,routeSlice} from '../dist/spatial.js';
import {mainlineMerges} from '../dist/network-receiving.js';
import {closedNetworkSpans} from '../dist/closure-network.js';
import {closureForkDetours} from '../dist/05_Umleitungen/closure-fork-detours.js';
import {initialiseCells,cellInventory} from '../dist/traffic-cells.js';
import {advanceRoutedNetwork} from '../dist/routed-traffic.js';
import {emptyDetour,detourVehicles} from '../dist/detour-flow.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
const exits=[...networkData.exits,...extensionJunctions];
const links=[...buildRampConnections(networkData.ramps,routes),...buildExtensionConnections(routes)];
const merges=mainlineMerges(routes);
const a3=routes['A3-koeln'];
const heumar=exits.find(e=>e.road==='A3'&&e.ref==='28');
const ost=exits.find(e=>e.road==='A3'&&e.ref==='27');
function closure(){
 const from=positionM(a3,heumar.directional['A3-koeln'].position,900);
 const to=positionM(a3,ost.directional['A3-koeln'].position,900);
 assert.ok(from!==null&&to!==null&&to>from);
 return {id:'heumar-test',kind:'closure',pathKey:'A3-koeln',
  point:routeSlice(a3,from+(to-from)*.35,from+(to-from)*.35+1)[0],
  laneCount:3,closedLanes:[0,1,2],createdAt:'2026-11-13T10:00:00Z',
  settings:{lengthM:250,speedKmh:0,shoulder:'blocked'}};
}

test('A3 Heumar to Koeln-Ost full closure blocks all directed A4 on-ramps and A59 final merge',()=>{
 const event=closure(),gate=closureGate(a3,event,exits,[event]);
 assert.equal(gate?.exit?.ref,'28');
 assert.equal(gate?.endExit?.ref,'27');
 const spans=closedNetworkSpans([event],routes,exits,links);
 const blocked=new Set(spans.map(s=>s.pathKey));
 assert.ok(blocked.has('extra-heumar-132614489'),'incoming A4 to closed A3 must be striped');
 assert.ok(blocked.has('extra-a59-koeln'),'A59 terminal merging into closed A3 must be striped');
 assert.ok(!blocked.has('extra-turn-A3-koeln-to-extra-a4-aachen-992497963'),
  'A3 to open A4 branch stays usable');
 assert.ok(!blocked.has('extra-heumar-132614508'),'opposite A3 direction stays usable');
 assert.ok(!blocked.has('extra-a4-aachen'),'unrelated A4 carriageway must remain open');
});
test('mandatory motorway exits at A3, A4 and A59 are derived from existing OSM geometry',()=>{
 const event=closure();
 const alternatives=closureForkDetours([event],routes,exits,links,merges);
 const fromA3=alternatives.find(c=>c.path==='A3-koeln'&&c.targetPath==='extra-a4-aachen');
 const fromA4=alternatives.find(c=>c.path==='extra-a4-olpe'&&c.targetPath==='extra-a559-porz');
 const fromA59=alternatives.find(c=>c.path==='extra-a59-koeln'&&c.targetPath==='extra-a4-olpe');
 assert.ok(fromA3,'A3 must branch to open A4 at Heumar');
 assert.ok(fromA4,'A4 traffic must avoid its barred entrance to A3');
 assert.ok(fromA59,'A59 traffic must be able to divert through open A559/A4 ring');
 for(const config of [fromA3,fromA4,fromA59]){
  assert.equal(config.motorwayBypass,true);
  assert.equal(config.exitIsInterchange,true);
  assert.equal(config.geometry.source,'osm-motorway-ramp');
  assert.ok(config.geometry.points.length>2);
  assert.ok(config.geometry.sections.length>0);
  assert.ok(config.fromM<routes[config.path].lengthM);
  assert.ok(config.toM<routes[config.targetPath].lengthM);
  assert.ok(!alternatives.some(d=>d.id!==config.id&&d.path===config.path&&
    d.targetPath===config.targetPath&&Math.abs(d.fromM-config.fromM)<1));
 }
 assert.deepEqual(closureForkDetours([],routes,exits,links,merges),[]);
});
test('vehicles leaving closed A3 via the open A4 fork are conserved',()=>{
 const event=closure();
 const config=closureForkDetours([event],routes,exits,links,merges)
  .find(c=>c.path==='A3-koeln'&&c.targetPath==='extra-a4-aachen');
 assert.ok(config);
 const keys=['A3-koeln','extra-a4-aachen'];
 let cells=Object.fromEntries(keys.map(k=>[k,initialiseCells(routes[k],k==='A3-koeln'?3800:200)]));
 let detours=[{config,state:emptyDetour(config),enabled:true}];
 const start=keys.reduce((n,k)=>n+cellInventory(cells[k]),0);
 const demand={'A3-koeln':3800,'extra-a4-aachen':200};
 for(let t=0;t<12;t++){
  const next=advanceRoutedNetwork(cells,routes,[event],demand,exits,detours);
  cells=next.cells;detours=next.detours;
  const inventory=keys.reduce((n,k)=>n+cellInventory(cells[k]),0)+detourVehicles(detours[0].state);
  const offered=keys.reduce((n,k)=>n+cells[k].offeredTotal,0);
  const exited=keys.reduce((n,k)=>n+cells[k].exitedTotal,0);
  assert.ok(Math.abs(inventory+exited+(detours[0].state.exitedNetworkTotal??0)-offered-start)<.01);
 }
 assert.ok(detours[0].state.admittedTotal>0,'real cars must leave the blocked A3 arm');
});
