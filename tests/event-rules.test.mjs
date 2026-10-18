import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {mapCandidates} from '../dist/selection.js';
import {eventFromHit,updatedEvent,decodeEvents,validEvent,suggestedSpeed,maxLengthM,flowPolicy,eventSummary,defaultSettings} from '../dist/events.js';
import {readFileSync} from 'node:fs';
const project=p=>[p[1]*10000,p[0]*10000];
const road=networkData.roads.find(x=>x.road==='A3-frankfurt'&&x.lanes===3);
const hit=mapCandidates([road],[],project(road.points[0]),project,2)[0];
const ramp=networkData.ramps[0],rhit=mapCandidates([],[ramp],project(ramp.points[0]),project,2)[0];
const stamp='2026-10-19T00:00:00Z';
test('editable accident speed suggestions reflect remaining main lanes and override works',()=>{
 assert.equal(suggestedSpeed('accident',3,[0,1],'normal'),40);
 assert.equal(suggestedSpeed('accident',3,[0],'normal'),60);
 assert.equal(suggestedSpeed('accident',3,[0,1,2],'normal'),0);
 assert.equal(suggestedSpeed('roadworks',3,[0,1],'open'),60);
 const e=eventFromHit(hit,'accident',3,[0,1],'a',stamp,{lengthM:150,speedKmh:30,shoulder:'normal'});
 assert.equal(e.settings.speedKmh,30);
 assert.equal(flowPolicy(e).openTotalLanes,1);
 assert.equal(flowPolicy(e).speedKmh,30);
 const edited=updatedEvent(e,'accident',[0],{lengthM:200,speedKmh:50,shoulder:'normal'});
 assert.equal(edited.settings.speedKmh,50);
 assert.equal(edited.id,e.id);assert.deepEqual(edited.point,e.point);assert.equal(edited.pathKey,e.pathKey);
});
test('200 metre hard limit on accident and breakdown, long roadworks allowed',()=>{
 for(const kind of ['accident','breakdown']){
  assert.equal(maxLengthM(kind),200);
  assert.ok(validEvent(eventFromHit(hit,kind,3,[0],'m'+kind,stamp,{lengthM:200,speedKmh:60,shoulder:'normal'})));
  assert.throws(()=>eventFromHit(hit,kind,3,[0],'long',stamp,{lengthM:201,speedKmh:60,shoulder:'normal'}));
 }
 assert.equal(maxLengthM('roadworks'),20000);
 assert.ok(validEvent(eventFromHit(hit,'roadworks',3,[0],'w',stamp,{lengthM:3000,speedKmh:60,shoulder:'normal'})));
 assert.throws(()=>eventFromHit(hit,'roadworks',3,[],'over',stamp,{lengthM:20001,speedKmh:100,shoulder:'normal'}));
});
test('shoulder opening counts as additional simulated lane, not an existing regular lane',()=>{
 const e=eventFromHit(hit,'roadworks',3,[0,1,2],'shoulder',stamp,{lengthM:600,speedKmh:40,shoulder:'open'});
 const policy=flowPolicy(e);
 assert.equal(policy.openMainLanes,0);assert.equal(policy.openTotalLanes,1);
 assert.equal(policy.canEnter,true);assert.equal(policy.rerouteApproaching,false);
 assert.match(eventSummary(e),/Standstreifen freigegeben/);
 assert.throws(()=>eventFromHit(rhit,'roadworks',2,[0],'ramp',stamp,{lengthM:100,speedKmh:60,shoulder:'open'}),'no made-up shoulders on motorway ramps');
});
test('formal closure blocks NEW entry, flags upstream diversion, clears vehicles already in the segment',()=>{
 const closure=eventFromHit(hit,'closure',3,[0],'closure',stamp,{lengthM:1200,speedKmh:0,shoulder:'blocked'});
 assert.deepEqual(closure.closedLanes,[0,1,2]);
 assert.deepEqual(flowPolicy(closure),{openMainLanes:0,openTotalLanes:0,canEnter:false,occupantsMayLeave:true,rerouteApproaching:true,speedKmh:0});
 const collision=eventFromHit(hit,'accident',3,[0,1,2],'accident',stamp,{lengthM:120,speedKmh:0,shoulder:'normal'});
 assert.equal(flowPolicy(collision).rerouteApproaching,false);
 assert.equal(flowPolicy(collision).occupantsMayLeave,false);
 assert.equal(flowPolicy(collision).canEnter,false);
 assert.throws(()=>updatedEvent(closure,'closure',[],{lengthM:500,speedKmh:40,shoulder:'blocked'}));
 assert.throws(()=>updatedEvent(closure,'closure',[],{lengthM:500,speedKmh:0,shoulder:'open'}));
});
test('0.7 events migrate from same local-storage key without loss',()=>{
 const e=eventFromHit(hit,'roadworks',3,[0],'old',stamp);
 const old={...e};delete old.settings;
 const upgraded=decodeEvents(JSON.stringify([old]));
 assert.equal(upgraded.length,1);assert.equal(upgraded[0].id,'old');assert.equal(upgraded[0].settings.lengthM,500);
 assert.deepEqual(decodeEvents(JSON.stringify([e])),[e]);
 assert.equal(decodeEvents(JSON.stringify([{...e,settings:{lengthM:1,speedKmh:-2,shoulder:'normal'}}])).length,0);
});
test('SPCK form has shoulder selection, length, speeds, editing and mobile scroll',()=>{
 const html=readFileSync('index.html','utf8');const src=readFileSync('src/app.ts','utf8');
 for(const id of ['event-length','event-speed','event-shoulder','event-edit','event-rule-hint'])assert.ok(html.includes(`id="${id}"`));
 assert.match(html,/overflow-y:auto/);assert.match(src,/beginEditEvent/);assert.match(src,/updatedEvent/);
 assert.doesNotMatch(src,/simulateVehicles|drivingCars/);
});
