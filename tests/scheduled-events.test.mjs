import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {eventFromHit,validEvent,decodeEvents,effectiveEventsAt,effectiveEventAt,
 eventScheduleStatus,eventSummary} from '../dist/events.js';
import {makeCorridors,routeSlice,emptySpatial,advanceSpatial,jamsAt} from '../dist/spatial.js';
import {defaultDemands} from '../dist/traffic.js';

const path='A3-koeln',routes=makeCorridors(networkData.roads,networkData.ramps);
const route=routes[path],road=networkData.roads.find(r=>r.road===path);
const point=routeSlice(route,route.lengthM*.5,route.lengthM*.5+3)[0];
const hit={kind:'road',road,key:path,point,distance:0,fraction:.5};
const at=(hour,min=0)=>Date.parse(`2026-10-21T${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}:00Z`);
const create=()=>{
 const base=eventFromHit(hit,'roadworks',3,[0],'scheduled','2026-10-21T12:00:00Z',
  {lengthM:500,speedKmh:80,shoulder:'normal'});
 return {...base,schedule:{
  startAt:'2026-10-21T20:00:00Z',endAt:'2026-10-22T05:00:00Z',
  phases:[
   {startAt:'2026-10-21T22:00:00Z',kind:'closure',closedLanes:[0,1,2],speedKmh:0,shoulder:'blocked'},
   {startAt:'2026-10-22T01:00:00Z',kind:'roadworks',closedLanes:[0,1],speedKmh:60,shoulder:'normal'}
  ]
 }};
};
test('planned construction remains invisible until start, changes lanes and fully expires at end',()=>{
 const e=create();
 assert.equal(validEvent(e),true);
 assert.equal(effectiveEventAt(e,at(19,59)),null);
 assert.equal(eventScheduleStatus(e,at(19,59)),'planned');
 assert.deepEqual(effectiveEventAt(e,at(20))?.closedLanes,[0]);
 assert.equal(effectiveEventAt(e,at(20))?.kind,'roadworks');
 const full=effectiveEventAt(e,at(22));
 assert.equal(full?.kind,'closure');
 assert.deepEqual(full?.closedLanes,[0,1,2]);
 assert.equal(full?.settings.speedKmh,0);
 const partial=effectiveEventAt(e,at(1)+86400000);
 assert.equal(partial?.kind,'roadworks');
 assert.deepEqual(partial?.closedLanes,[0,1]);
 assert.equal(partial?.settings.speedKmh,60);
 const end=Date.parse(e.schedule.endAt);
 assert.equal(effectiveEventAt(e,end-60000)?.kind,'roadworks');
 assert.equal(effectiveEventAt(e,end),null);
 assert.equal(eventScheduleStatus(e,end),'finished');
 assert.deepEqual(effectiveEventsAt([e],end),[]);
});
test('rewinding the simulation restores earlier phases without altering persisted event',()=>{
 const event=create(),before=JSON.stringify(event);
 assert.equal(effectiveEventAt(event,at(22))?.kind,'closure');
 assert.deepEqual(effectiveEventAt(event,at(20))?.closedLanes,[0]);
 assert.equal(JSON.stringify(event),before);
 assert.deepEqual(decodeEvents(JSON.stringify([event]))[0],event);
});
test('legacy untimed events remain active; invalid phase windows and lane programs rejected',()=>{
 const untimed=eventFromHit(hit,'roadworks',3,[0],'original','2026-10-21T12:00:00Z');
 assert.strictEqual(effectiveEventAt(untimed,at(3)),untimed);
 assert.equal(validEvent(untimed),true);
 const event=create();
 const variants=[
  {...event,schedule:{...event.schedule,endAt:event.schedule.startAt}},
  {...event,schedule:{...event.schedule,phases:[{...event.schedule.phases[0],startAt:event.schedule.startAt}]}},
  {...event,schedule:{...event.schedule,phases:[{...event.schedule.phases[0],closedLanes:[0],kind:'closure'}]}},
  {...event,schedule:{...event.schedule,phases:[{...event.schedule.phases[0],kind:'roadworks',speedKmh:0,closedLanes:[0]}]}},
  {...event,kind:'accident'},
  {...event,schedule:{...event.schedule,phases:Array.from({length:7},(_,i)=>({...event.schedule.phases[0],startAt:new Date(at(20,i+1)).toISOString()}))}}
 ];
 for(const bad of variants)assert.equal(validEvent(bad),false,'invalid scheduled event accepted');
});
test('a scheduled closure is removed from traffic solver at the deadline, but the queue can drain normally',()=>{
 const e=create(),d={...defaultDemands(),[path]:2900};
 let state=emptySpatial();
 for(let minute=0;minute<110;minute++){
  const time=at(21)+minute*60000,active=effectiveEventsAt([e],time);
  state=advanceSpatial(state,active,d,1,routes);
 }
 const before=state.queues[e.id]?.vehicles??0;
 assert.ok(before>0,'closure created waiting vehicles');
 const after=advanceSpatial(state,effectiveEventsAt([e],Date.parse(e.schedule.endAt)),d,1,routes);
 assert.equal(effectiveEventsAt([e],Date.parse(e.schedule.endAt)).length,0);
 assert.ok((after.queues[e.id]?.vehicles??0)<before,
  'expired restriction stops limiting capacity but queue drains rather than teleporting');
});
test('UI has one clock above map, iOS selection defense and date-range event editor',()=>{
 const html=readFileSync('index.html','utf8'),src=readFileSync('src/app.ts','utf8');
 const clock=html.indexOf('id="traffic-clock"'),map=html.indexOf('class="map-shell"');
 assert.ok(clock>=0&&clock<map,'clock must sit above the map');
 assert.equal((html.match(/id="traffic-clock"/g)||[]).length,1);
 for(const id of ['event-scheduled','event-start-date','event-start-time','event-end-date','event-end-time','event-schedule-mode','event-repeat-from','event-repeat-through','event-repeat-start-time','event-repeat-end-time','event-add-phase','event-phases'])
  assert.ok(html.includes(`id="${id}"`),'missing '+id);
 assert.match(html,/-webkit-touch-callout:none/);
 assert.match(src,/mapRegion\.addEventListener\(type,event=>event\.preventDefault\(\)\)/);
 assert.match(src,/const timeline=activeEvents\(\)/);
 assert.match(src,/scheduleForm\.read\(\)/);
});
