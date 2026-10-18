import test from 'node:test';
import assert from 'node:assert/strict';
import {mapCandidates,chooseMapHits,closestJunction,lanePositions,hitLabel,airDistanceMetres} from '../dist/selection.js';
import {networkData} from '../dist/geodata.js';
import {mercator,nearestPolyline} from '../dist/core.js';

const road=(id,way,lat)=>({id:String(way),wayId:way,road:id,lanes:3,km:.2,posKm:1,points:[[lat,7.0],[lat,7.004]],tags:{ref:'A 3'}});
const p=(geo)=>[geo[1]*10000,geo[0]*10000];
test('one hit per directional roadway, not one per OSM piece',()=>{
 const a=road('A3-koeln',1,50.000);const a2=road('A3-koeln',2,50.0001);const b=road('A3-frankfurt',3,50.0005);
 const hits=mapCandidates([a,a2,b],[],p([50.00002,7.002]),p,20);
 assert.deepEqual(hits.map(x=>x.key),['A3-koeln','A3-frankfurt']);
 assert.equal(hits[0].road.wayId,1);
 assert.ok(hits[0].point[1]>=7.0&&hits[0].point[1]<=7.004);
});
test('adjacent opposite carriageways produce explicit choice, distant others do not',()=>{
 const a=road('A3-koeln',1,50);const b=road('A3-frankfurt',2,50.0004);
 const near=chooseMapHits(mapCandidates([a,b],[],p([50.0002,7.002]),p,18));
 assert.equal(near.length,2);
 assert.deepEqual(new Set(near.map(h=>h.key)),new Set(['A3-koeln','A3-frankfurt']));
 const far=road('A3-frankfurt',4,50.0012);
 assert.equal(chooseMapHits(mapCandidates([a,far],[],p([50,7.002]),p,18)).length,1);
 assert.equal(chooseMapHits([]).length,0);
});
test('ramps are independent selectable paths and not assigned to mainline direction',()=>{
 const ramp=networkData.ramps[0];const middle=ramp.points[Math.floor(ramp.points.length/2)];
 const hits=mapCandidates([],networkData.ramps,p(middle),p,18);
 assert.equal(hits[0].kind,'ramp');assert.equal(hits[0].ramp.id,ramp.id);
 assert.match(hitLabel(hits[0]),/A3|A48/);
});
test('junction lookup uses matching A3/A48, and marks straight-line distance',()=>{
 const a=road('A3-koeln',8,50);const point=[50.4,7.9];
 const hit={kind:'road',road:a,point,distance:0,fraction:.2,key:a.road};
 const nearest=closestJunction(hit,networkData.exits);
 assert.equal(nearest.exit.road,'A3');assert.ok(nearest.distanceKm>=0);
 assert.equal(airDistanceMetres(point,point),0);
 assert.equal(closestJunction({kind:'ramp',ramp:networkData.ramps[0],point,distance:0,fraction:0,key:'x'},networkData.exits),null);
});
test('symbolic lane positions are ordinal, not invented turning rules',()=>{
 assert.deepEqual(lanePositions(1),['Fahrstreifen']);
 assert.deepEqual(lanePositions(2),['Rechts','Links']);
 assert.deepEqual(lanePositions(3),['Rechts','Mitte','Links']);
 assert.equal(lanePositions(4).length,4);
 assert.deepEqual(lanePositions(0),[]);
});
test('SPCK view exposes clear direction chooser and junction information',async()=>{
 const html=await(await import('node:fs/promises')).readFile('index.html','utf8');
 for(const id of ['selection-chooser','selection-options','selected-direction','selected-junction','selected-lane-names'])assert.ok(html.includes(`id="${id}"`),id);
 const source=await(await import('node:fs/promises')).readFile('src/app.ts','utf8');
 assert.match(source,/chooseMapHits/);assert.match(source,/rampBadges/);assert.doesNotMatch(source,/\beventKind\b/);
});
