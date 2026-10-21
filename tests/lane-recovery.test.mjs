import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {eventFromHit,updatedEvent,eventSummary} from '../dist/events.js';
import {defaultDemands,laneDemandShares,defaultHeavyShare,eventCapacity} from '../dist/traffic.js';
import {makeCorridors,routeSlice,emptySpatial,advanceSpatial,jamsAt} from '../dist/spatial.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
const demand=defaultDemands(),key='A3-koeln';
const anchor=routes[key].lengthM*.67,point=routeSlice(routes[key],anchor,anchor+2)[0];
const road=networkData.roads.find(r=>r.road===key);
const hit={kind:'road',road,key,point,distance:0,fraction:.67};
const event=(lane,id='works')=>eventFromHit(hit,'roadworks',3,[lane],id,'2026-10-21T06:00:00Z',
 {lengthM:500,speedKmh:80,shoulder:'normal'});

test('right-to-left truck lane distribution is normalized and configurable',()=>{
 const low=laneDemandShares(3,.05),high=laneDemandShares(3,.40);
 assert.ok(Math.abs(low.reduce((a,b)=>a+b,0)-1)<1e-10);
 assert.ok(Math.abs(high.reduce((a,b)=>a+b,0)-1)<1e-10);
 assert.ok(high[0]>low[0],'right lane should take more traffic as freight share rises');
 assert.ok(high[2]<low[2],'left lane should take less traffic as freight share rises');
 assert.ok(high[0]>high[1]&&high[1]>high[2]);
 assert.ok(defaultHeavyShare('A3-koeln')>defaultHeavyShare('A48-dernbach'));
 assert.throws(()=>laneDemandShares(3,-.2));
});

test('at identical demand, right lane closure lowers discharge more than left closure',()=>{
 const right=event(0),middle=event(1),left=event(2);
 const rightCap=eventCapacity(right,4200),middleCap=eventCapacity(middle,4200),leftCap=eventCapacity(left,4200);
 assert.ok(rightCap<middleCap && middleCap<leftCap,`right/middle/left capacities ${rightCap}/${middleCap}/${leftCap}`);
 assert.ok(rightCap>2400,'do not invent near-closure from one blocked right lane');
 assert.ok(leftCap<5400,'a closed left lane is never free of consequences');
 assert.match(eventSummary(right),/Betroffen: rechts/);
 assert.match(eventSummary(middle),/Betroffen: mittig/);
 assert.match(eventSummary(left),/Betroffen: links/);
});

test('heavy vehicles and congestion affect closure friction but do not force a queue at low inflow',()=>{
 const right=event(0);
 const withTrucks=eventCapacity(right,4300,.45);
 const fewTrucks=eventCapacity(right,4300,.03);
 assert.ok(withTrucks<fewTrucks,'more diverted heavy goods vehicles make right-lane closure more restrictive');
 const low={...demand,[key]:1200};
 const state=advanceSpatial(emptySpatial(),[right],low,60,routes);
 assert.equal(state.queues[right.id],undefined,'low-demand lane closure must not force a traffic jam');
});

test('with high demand, right-lane closure creates a larger queue than left closure',()=>{
 const high={...demand,[key]:4200};
 const right=event(0,'right'),left=event(2,'left');
 const rightState=advanceSpatial(emptySpatial(),[right],high,20,routes);
 const leftState=advanceSpatial(emptySpatial(),[left],high,20,routes);
 const a=rightState.queues.right.vehicles,b=leftState.queues.left.vehicles;
 assert.ok(a>b+30,`right closure should create more congestion than left: ${a} vs ${b}`);
 assert.ok(jamsAt(rightState,[right],routes)[0].delayMin>jamsAt(leftState,[left],routes)[0].delayMin);
});

test('after reopening two of three lanes, discharge ramps gradually rather than jumping to steady capacity',()=>{
 const closure=eventFromHit(hit,'closure',3,[0,1,2],'reopen','2026-10-21T06:00:00Z',
  {lengthM:500,speedKmh:0,shoulder:'blocked'});
 const low={...demand,[key]:1200};
 let state=advanceSpatial(emptySpatial(),[closure],low,35,routes);
 const initiallyQueued=state.queues.reopen.vehicles;
 assert.ok(initiallyQueued>600,'closure must first accumulate stored vehicles');
 const reopened=updatedEvent(closure,'roadworks',[2],{lengthM:500,speedKmh:80,shoulder:'normal'});
 const full=eventCapacity(reopened,low[key]);
 const first=advanceSpatial(state,[reopened],low,1,routes);
 const firstState=first.queues.reopen;
 assert.ok(firstState.capacityVph>0&&firstState.capacityVph<full,'reopening should start below sustainable discharge');
 assert.ok(firstState.vehicles<initiallyQueued,'stored queue must begin to drain');
 assert.equal(firstState.recoveryTick,0);
 let after=first;
 for(let minute=0;minute<7;minute++)after=advanceSpatial(after,[reopened],low,1,routes);
 assert.ok(after.queues.reopen.capacityVph>=full-1,'capacity must recover within 7 model minutes');
 assert.ok(after.queues.reopen.vehicles<firstState.vehicles);
 let final=after;
 for(let minute=0;minute<70;minute++)final=advanceSpatial(final,[reopened],low,1,routes);
 assert.equal(final.queues.reopen,undefined,'queue must disappear if inflow stays below reopened capacity');
});

test('reopening two lanes under sustained overload does NOT instantly dissolve queue',()=>{
 const closure=eventFromHit(hit,'closure',3,[0,1,2],'saturated','2026-10-21T06:00:00Z',
  {lengthM:500,speedKmh:0,shoulder:'blocked'});
 const high={...demand,[key]:4200};
 const blocked=advanceSpatial(emptySpatial(),[closure],high,20,routes);
 const reopened=updatedEvent(closure,'roadworks',[2],{lengthM:500,speedKmh:80,shoulder:'normal'});
 const after=advanceSpatial(blocked,[reopened],high,15,routes);
 assert.ok(after.queues.saturated.vehicles>blocked.queues.saturated.vehicles,
  'the queue must keep growing when demand exceeds two-lane discharge');
 assert.ok(after.queues.saturated.capacityVph>0);
 const fullyBlockedAgain=advanceSpatial(after,[closure],high,1,routes);
 assert.equal(fullyBlockedAgain.queues.saturated.capacityVph,0);
});

test('recovery is deterministic and never produces negative queued vehicles',()=>{
 const closure=eventFromHit(hit,'closure',3,[0,1,2],'seed','2026-10-21T06:00:00Z',
  {lengthM:200,speedKmh:0,shoulder:'blocked'});
 const queued=advanceSpatial(emptySpatial(),[closure],{...demand,[key]:2000},30,routes);
 const opened=updatedEvent(closure,'roadworks',[0],{lengthM:200,speedKmh:80,shoulder:'normal'});
 assert.deepEqual(advanceSpatial(queued,[opened],{...demand,[key]:1200},10,routes),
                  advanceSpatial(queued,[opened],{...demand,[key]:1200},10,routes));
 assert.ok(queued.queues.seed.vehicles>0);
});
