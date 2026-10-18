import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeEvents,eventFromHit,validEvent,eventSummary,isKnownPath,eventNames,STORAGE_KEY} from '../dist/events.js';
import {networkData} from '../dist/geodata.js';
import {mapCandidates} from '../dist/selection.js';
import {readFileSync} from 'node:fs';
const projection=p=>[p[1]*10000,p[0]*10000];
const road=networkData.roads.find(r=>r.road==='A3-koeln'&&r.lanes===3);
const roadHit=mapCandidates([road],[],projection(road.points[0]),projection,2)[0];
const ramp=networkData.ramps[0];
const rampHit=mapCandidates([],[ramp],projection(ramp.points[0]),projection,2)[0];
const stamp='2026-10-19T01:00:00.000Z';

test('events attach exactly to the selected independent A3/A48 carriageway or AD ramp',()=>{
 const a=eventFromHit(roadHit,'roadworks',3,[0,2],'a',stamp);
 const b=eventFromHit(rampHit,'breakdown',2,[1],'b',stamp);
 assert.equal(a.pathKey,'A3-koeln');assert.equal(a.point[0],roadHit.point[0]);
 assert.equal(b.pathKey,ramp.id);assert.deepEqual(b.closedLanes,[1]);
 assert.ok(isKnownPath(a.pathKey)&&isKnownPath(b.pathKey));
 assert.ok(!isKnownPath('A3-foo'));
});
test('only the explicit full closure event marks the road as formally fully closed',()=>{
 const accident=eventFromHit(roadHit,'accident',3,[2,1,0],'accident',stamp);
 const closure=eventFromHit(roadHit,'closure',3,[],'closure',stamp);
 assert.deepEqual(closure.closedLanes,[0,1,2]);
 assert.deepEqual(accident.closedLanes,[0,1,2]);
 assert.match(eventSummary(accident),/ohne Vollsperrungs-Ereignis/);
 assert.match(eventSummary(closure),/Vollsperrung/);
});
test('a roadworks event may be created without a lane being closed yet',()=>{
 const event=eventFromHit(roadHit,'roadworks',3,[],'c',stamp);
 assert.deepEqual(event.closedLanes,[]);assert.match(eventSummary(event),/Kein Fahrstreifen/);
});
test('invalid lane IDs and impossible lane counts are rejected',()=>{
 assert.throws(()=>eventFromHit(roadHit,'roadworks',3,[3],'x',stamp));
 assert.throws(()=>eventFromHit(roadHit,'accident',0,[0],'x',stamp));
 assert.throws(()=>eventFromHit(roadHit,'breakdown',2,[-1],'x',stamp));
 assert.throws(()=>eventFromHit(roadHit,'accident',2,[0.5],'x',stamp));
});
test('serialized events reload safely, corrupted/unknown records are filtered',()=>{
 const a=eventFromHit(roadHit,'roadworks',3,[0],'x',stamp);
 assert.deepEqual(decodeEvents(JSON.stringify([a])),[a]);
 assert.deepEqual(decodeEvents('{bad json'),[]);
 assert.deepEqual(decodeEvents(JSON.stringify({bad:'shape'})),[]);
 assert.equal(decodeEvents(JSON.stringify([a,a,{...a,id:'new',pathKey:'wrong'}])).length,1);
 assert.equal(validEvent({...a,kind:'invalid'}),false);
});
test('SPCK entrypoint includes only self-defined simulated events and local persistence',()=>{
 const html=readFileSync('index.html','utf8');
 for(const id of ['new-event-button','event-kind','event-lanes','event-save','event-delete','events-list'])assert.ok(html.includes(`id="${id}"`),id);
 const source=readFileSync('src/app.ts','utf8');
 assert.match(source,/localStorage/);assert.match(source,/showExistingEvent/);
 assert.match(source,/mapCandidates/);assert.match(source,/rampBadges/);
 assert.ok(STORAGE_KEY.includes("events"));
});
