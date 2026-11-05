import test from 'node:test';
import assert from 'node:assert/strict';
import {MOTORWAY_PATHS,MOTORWAY_GROUPS,junctionDirectory,junctionRoute,trafficOverviewPaths} from '../dist/network-presentation.js';
import {networkData} from '../dist/geodata.js';
import {extensionJunctions,extensionRoutes} from '../dist/network-extensions.js';
import {networkRoad} from '../dist/network-road.js';
const exits=[...networkData.exits,...extensionJunctions];
test('every modelled motorway has two permanent directions in the same overview and registry',()=>{
 assert.equal(MOTORWAY_PATHS.length,20);
 // Dynamic discovery must preserve both directions without relying on a
 // historical presentation order or hardcoded motorway list.
 assert.deepEqual(
  MOTORWAY_GROUPS.map(g=>g.road).sort(),
  [...new Set(MOTORWAY_PATHS.map(networkRoad))].sort()
 );
 assert.ok(MOTORWAY_GROUPS.every(g=>g.paths.length===2));
 assert.deepEqual(MOTORWAY_GROUPS.flatMap(g=>g.paths).sort(),[...MOTORWAY_PATHS].sort());
 const rows=trafficOverviewPaths('A3-koeln',new Set(),new Set());
 for(const path of MOTORWAY_PATHS)assert.ok(rows.includes(path));
 const ramp=extensionRoutes.find(r=>r.kind==='ramp').id;
 assert.ok(trafficOverviewPaths(ramp,new Set(),new Set()).includes(ramp));
 assert.ok(trafficOverviewPaths('A3-koeln',new Set([ramp]),new Set()).includes(ramp));
 assert.ok(trafficOverviewPaths('A3-koeln',new Set(),new Set([ramp])).includes(ramp));
});
test('the same junction directory includes every A3/A48/A59/A560 junction once, sorted by number',()=>{
 const groups=junctionDirectory(exits);assert.equal(groups.flatMap(g=>g.junctions).length,exits.length);
 for(const group of groups){
  assert.ok(group.junctions.length>0);
  assert.equal(new Set(group.junctions.map(j=>j.ref)).size,group.junctions.length);
  assert.ok(group.junctions.every(j=>j.road===group.road));
  for(let i=1;i<group.junctions.length;i++)assert.ok(group.junctions[i-1].ref.localeCompare(group.junctions[i].ref,'de',{numeric:true})<=0);
 }
});
test('opening any AS chooses its own motorway and a real direction, preserving the chosen direction when available',()=>{
 for(const exit of exits){
  const path=junctionRoute(exit,'extra-a560-hennef');assert.ok(path);assert.equal(networkRoad(path),exit.sharedRoad??exit.road);
  if(exit.directional)assert.ok(exit.directional[path]);
  for(const candidate of MOTORWAY_PATHS.filter(k=>networkRoad(k)===(exit.sharedRoad??exit.road)&&(!exit.directional||exit.directional[k])))assert.equal(junctionRoute(exit,candidate),candidate);
 }
});
