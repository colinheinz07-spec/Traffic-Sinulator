import test from 'node:test';
import assert from 'node:assert/strict';
import {motorwayLaneSplit,roadLaneInfo,normalThroughLanes} from '../dist/lane-info.js';
import {networkData} from '../dist/geodata.js';

const make=(ref)=>({
 id:'fake',wayId:999999,road:'A7-nord',lanes:3,km:.15,posKm:1,
 points:[[50,7],[50.001,7]],
 tags:{ref:'A 7',lanes:'3','destination:ref:lanes':ref}
});
test('AD/AK may divide three motorway lanes into two towards one motorway and one to another',()=>{
 const road=make('A 7|A 7|A 27');
 const split=motorwayLaneSplit(road);
 assert.equal(split.total,3);
 assert.equal(split.dedicated.A7,2);
 assert.equal(split.dedicated.A27,1);
 assert.equal(split.shared,0);
 assert.equal(normalThroughLanes(road),3);
 assert.match(roadLaneInfo(road).label,/2 × A7/);
 assert.match(roadLaneInfo(road).label,/1 × A27/);
});
test('a normal motorway AS with local B-road destination is not mistaken for AD/AK',()=>{
 const road=make('A 7|A 7|B 75');
 assert.equal(motorwayLaneSplit(road),null);
 assert.doesNotMatch(roadLaneInfo(road).label,/AD\/AK/);
});
test('shared destination lanes count once, even when both A3 and A4 are allowed',()=>{
 const road=make('A 3;A 4|A 3;A 4|A 4');
 const split=motorwayLaneSplit(road);
 assert.equal(split.total,3);
 assert.equal(split.shared,2);
 assert.equal(split.dedicated.A4,1);
 assert.equal(split.dedicated.A3,undefined);
});
test('real audited A3/A4 Heumar lanes receive an interchange split label',()=>{
 const road=networkData.roads.find(r=>r.wayId===258488768);
 assert.ok(road);
 const split=motorwayLaneSplit(road);
 assert.ok(split&&split.total>=4);
 assert.ok(split.dedicated.A4>=1);
 assert.match(roadLaneInfo(road).label,/AD\/AK-Verzweigung/);
});
