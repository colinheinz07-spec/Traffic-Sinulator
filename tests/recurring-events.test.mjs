import test from 'node:test';
import assert from 'node:assert/strict';
import {validDailyRecurrence,dailyRecurrenceBounds,dailyOccurrenceAt,shiftCalendarDate} from '../dist/recurring-events.js';
import {effectiveEventAt,eventScheduleStatus,validEvent,decodeEvents} from '../dist/events.js';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {initialiseCells,advanceCells,cellInventory} from '../dist/traffic-cells.js';
const routes=makeCorridors(networkData.roads,networkData.ramps),path='A3-koeln',route=routes[path];
const repeat=(overrides={})=>({kind:'daily',firstDate:'2026-10-23',lastDate:'2026-11-05',startTime:'19:00',endTime:'05:00',
 weekdays:[0,1,2,3,4,5,6],timeZone:'Europe/Berlin',...overrides});
function event(recurrence=repeat()){
 const at=route.lengthM*.5;
 return {id:'night-work',kind:'roadworks',pathKey:path,point:routeSlice(route,at,at+2)[0],
  laneCount:3,closedLanes:[0,1],createdAt:'2026-10-23T10:00:00Z',settings:{lengthM:500,speedKmh:40,shoulder:'normal'},
  schedule:{...dailyRecurrenceBounds(recurrence),phases:[],recurrence}};
}
const ts=value=>Date.parse(value);
test('two weeks of 19–05 works repeat for 14 nights and are inactive every daytime',()=>{
 const e=event();assert.equal(validEvent(e),true);
 assert.equal(e.schedule.startAt,'2026-10-23T17:00:00.000Z');assert.equal(e.schedule.endAt,'2026-11-06T04:00:00.000Z');
 let starts=0;
 for(let i=0;i<14;i++){
  const date=shiftCalendarDate('2026-10-23',i),bounds=dailyRecurrenceBounds(repeat({firstDate:date,lastDate:date}));
  const start=ts(bounds.startAt),end=ts(bounds.endAt);
  assert.equal(effectiveEventAt(e,start-1),null);assert.deepEqual(effectiveEventAt(e,start).closedLanes,[0,1]);starts++;
  assert.ok(effectiveEventAt(e,end-1));assert.equal(effectiveEventAt(e,end),null);
  assert.equal(effectiveEventAt(e,ts(date+'T11:00:00Z')),null);
 }
 assert.equal(starts,14);assert.equal(effectiveEventAt(e,ts('2026-10-22T20:00:00+02:00')),null);
 assert.ok(effectiveEventAt(e,ts('2026-11-06T04:59:00+01:00')));
 assert.equal(effectiveEventAt(e,ts('2026-11-06T19:00:00+01:00')),null);
});
test('weekday selection belongs to the start date, so Friday night continues on Saturday',()=>{
 const e=event(repeat({weekdays:[1,2,3,4,5]}));assert.equal(validEvent(e),true);
 assert.ok(effectiveEventAt(e,ts('2026-10-24T04:59:00+02:00')));
 assert.equal(effectiveEventAt(e,ts('2026-10-24T05:00:00+02:00')),null);
 assert.equal(effectiveEventAt(e,ts('2026-10-24T20:00:00+02:00')),null);
 assert.equal(effectiveEventAt(e,ts('2026-10-25T03:00:00+01:00')),null);
 assert.ok(effectiveEventAt(e,ts('2026-10-26T19:00:00+01:00')));
});
test('calendar repetition follows the October clock change and the full last overnight window',()=>{
 const e=event(),r=e.schedule.recurrence;
 const window=dailyOccurrenceAt(r,ts('2026-10-25T02:30:00+02:00'));
 assert.equal(window.startDate,'2026-10-24');assert.equal((window.endMs-window.startMs)/3600000,11);
 assert.ok(dailyOccurrenceAt(r,ts('2026-10-25T02:30:00+01:00')));
 assert.equal(dailyOccurrenceAt(r,ts('2026-10-25T05:00:00+01:00')),null);
 const spring=repeat({firstDate:'2026-03-28',lastDate:'2026-03-28'}),bounds=dailyRecurrenceBounds(spring);
 assert.equal((ts(bounds.endAt)-ts(bounds.startAt))/3600000,9);
});
test('an ambiguous 02:30 end does not create a second activation after the clock falls back',()=>{
 const r=repeat({firstDate:'2026-10-24',lastDate:'2026-10-24',endTime:'02:30'});
 assert.ok(dailyOccurrenceAt(r,ts('2026-10-25T02:45:00+02:00')));
 assert.ok(dailyOccurrenceAt(r,ts('2026-10-25T02:15:00+01:00')));
 assert.equal(dailyOccurrenceAt(r,ts('2026-10-25T02:30:00+01:00')),null);
});
test('recurrence survives saving, replay and editing; daytime gets its own inactive status',()=>{
 const e=event(),before=JSON.stringify(e);
 assert.equal(eventScheduleStatus(e,ts('2026-10-23T18:59:00+02:00')),'planned');
 assert.equal(eventScheduleStatus(e,ts('2026-10-23T19:00:00+02:00')),'active');
 assert.equal(eventScheduleStatus(e,ts('2026-10-24T08:00:00+02:00')),'between');
 assert.equal(eventScheduleStatus(e,ts('2026-11-06T05:00:00+01:00')),'finished');
 assert.deepEqual(decodeEvents(JSON.stringify([e])),[e]);
 assert.ok(effectiveEventAt(e,ts('2026-11-01T23:00:00+01:00')));
 assert.ok(effectiveEventAt(e,ts('2026-10-23T23:00:00+02:00')));assert.equal(JSON.stringify(e),before);
});
test('malformed dates, times, empty weekday ranges and mixed phase/recurrence programs are rejected',()=>{
 for(const changes of [{lastDate:'2026-10-22'},{firstDate:'2026-02-30'},{startTime:'25:00'},
  {startTime:'05:00'},{weekdays:[]},{weekdays:[1,1]},{weekdays:[7]},{timeZone:'Not/A_Zone'}])assert.equal(validDailyRecurrence(repeat(changes)),false);
 assert.equal(dailyRecurrenceBounds(repeat({firstDate:'2026-10-24',lastDate:'2026-10-25',weekdays:[1]})),null);
 const e=event();assert.equal(validEvent({...e,schedule:{...e.schedule,endAt:'2026-11-05T04:00:00Z'}}),false);
 assert.equal(validEvent({...e,schedule:{...e.schedule,phases:[{startAt:'2026-10-24T19:00:00Z',kind:'closure',closedLanes:[0,1,2],speedKmh:0,shoulder:'blocked'}]}}),false);
});
test('when a nightly closure ends, the existing queue remains and drains through the reopened road',()=>{
 const e={...event(),kind:'closure',closedLanes:[0,1,2],settings:{lengthM:200,speedKmh:0,shoulder:'blocked'}};
 let state=initialiseCells(route,3200);
 for(let i=0;i<30;i++)state=advanceCells(state,route,[effectiveEventAt(e,ts('2026-10-24T04:30:00+02:00')+i*60000)],3200,networkData.exits);
 const before=cellInventory(state),beforeExit=state.exitedTotal,active=effectiveEventAt(e,ts('2026-10-24T05:00:00+02:00'));
 assert.equal(active,null);state=advanceCells(state,route,[],900,networkData.exits);
 assert.ok(cellInventory(state)>before*.9,'ending a night must not delete its vehicles');
 for(let i=0;i<60;i++)state=advanceCells(state,route,[],900,networkData.exits);
 assert.ok(state.exitedTotal>beforeExit+500);assert.ok(cellInventory(state)<before);
});
