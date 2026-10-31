import {normalLaneOverrides} from '../dist/normal-lanes.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {rampLaneWays,unverifiedRoadWays} from '../dist/lane-profiles.js';
import {rampLaneInfo,roadLaneInfo} from '../dist/lane-info.js';

test('all four AD Dernbach ramps have complete OSM lane-way profiles',()=>{
 assert.equal(networkData.ramps.length,4);
 for(const r of networkData.ramps){
  const profile=rampLaneWays[r.id];
  assert.ok(profile,`No profile: ${r.name}`);
  assert.deepEqual(profile.map(w=>w.wayId),r.wayIds);
  assert.ok(profile.every(w=>w.lanes>0&&w.points.length>=2));
  const first=profile[0], point=first.points[Math.floor(first.points.length/2)];
  const info=rampLaneInfo(r,point);
  assert.equal(info.source,'osm',r.name);
  assert.ok([1,2].includes(info.count),r.name);
 }
});
test('verified OSM ramp widths vary per actual segment and are not hardcoded',()=>{
 const pair=(name)=>networkData.ramps.find(r=>r.id===name);
 assert.deepEqual([...new Set(rampLaneWays['ramp-a3-to-a48-from-frankfurt'].map(x=>x.lanes))],[2]);
 for(const r of networkData.ramps.filter(x=>x.id!=='ramp-a3-to-a48-from-frankfurt'))
  assert.deepEqual([...new Set(rampLaneWays[r.id].map(x=>x.lanes))].sort(),[1,2]);
});
test('outdated way IDs are flagged instead of being mislabeled as OSM-confirmed',()=>{
 assert.equal(unverifiedRoadWays.length,5);
 for(const way of unverifiedRoadWays){
  const road=networkData.roads.find(r=>r.wayId===way);
  assert.ok(road);
  assert.equal(roadLaneInfo(road).source,'stale');
 }
 const verified=networkData.roads.find(r=>!unverifiedRoadWays.includes(r.wayId));
 assert.equal(roadLaneInfo(verified).source,'normal');
});

test('A3 regular through lanes exclude ramps and temporary works across the whole expanded network',()=>{
 for(const road of networkData.roads.filter(r=>r.road.startsWith('A3')))assert.equal(roadLaneInfo(road).count,3);
 const auxiliary=networkData.roads.find(r=>r.road.startsWith('A48')&&normalLaneOverrides[r.wayId]===2&&r.lanes>2);
 assert.ok(auxiliary);assert.equal(roadLaneInfo(auxiliary).count,2);
});
