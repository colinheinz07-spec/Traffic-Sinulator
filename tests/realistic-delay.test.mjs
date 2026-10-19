import test from 'node:test';
import assert from 'node:assert/strict';
import {routeReport} from '../dist/network-report.js';
import {advanceTraffic,emptyTraffic,defaultDemands,trafficEstimate,eventCapacity} from '../dist/traffic.js';

const rampOverflow={
 id:'ramp-jam',rampId:'ramp-a48-to-koeln',source:'A48-dernbach',
 target:'A3-koeln',sourceAnchorM:1800,fromM:700,toM:1800,lengthM:1100,
 queuedVehiclesOnMotorway:110,excessBeyondMapM:0,color:'standstill',delayMin:null
};
const mainlineQueue={
 id:'spill:ramp-a48-to-koeln',pathKey:'A48-dernbach',
 queueVehicles:40,visibleQueueM:140,capacityVph:2100,
 delayMin:3,color:'slow',released:false
};

test('off-ramp standstill does not become an unbounded through-motorway delay',()=>{
 const result=routeReport('A48-dernbach',[mainlineQueue],[rampOverflow],[]);
 assert.equal(result.ownVehicles,40);
 assert.equal(result.sharedRampVehicles,110);
 assert.equal(result.queueVehicles,150);
 assert.equal(result.delayMin,3,'the real feeder queue delays through traffic');
 assert.equal(result.exitDelayMin,null,'the separate fully blocked exit stays indeterminate');
 assert.equal(result.countedQueueIds.length,1,'ramp vehicles are not counted as own feeder vehicles');
});

test('without a real feeder queue the through motorway has no invented delay',()=>{
 const result=routeReport('A48-dernbach',[],[rampOverflow],[]);
 assert.equal(result.delayMin,0);
 assert.equal(result.exitDelayMin,null);
 assert.equal(result.sharedRampVehicles,110);
});

test('a work zone creates no queue below capacity and no arbitrary delay surcharge',()=>{
 const event={
  id:'worksite',kind:'roadworks',pathKey:'A3-koeln',
  closedLanes:[0],laneCount:3,createdAt:'2026-10-19T00:00:00Z',
  point:[50.5,7.8],settings:{lengthM:500,speedKmh:80,shoulder:'normal'}
 };
 const noOverload={...defaultDemands(),'A3-koeln':2500};
 const free=advanceTraffic(emptyTraffic(),[event],noOverload,30);
 assert.equal(free.vehiclesWaiting['A3-koeln'],0);
 const high={...noOverload,'A3-koeln':3400};
 assert.ok(eventCapacity(event)<high['A3-koeln']);
 const loaded=advanceTraffic(emptyTraffic(),[event],high,30);
 const delay=trafficEstimate(loaded,'A3-koeln',[event],high['A3-koeln']).delayMin;
 assert.ok(delay>0&&delay<10,'moderate one-lane worksite delay: '+delay);
 const accident={...event,id:'accident',kind:'accident'};
 const incident=advanceTraffic(emptyTraffic(),[accident],high,30);
 const accidentDelay=trafficEstimate(incident,'A3-koeln',[accident],high['A3-koeln']).delayMin;
 assert.ok(accidentDelay>delay,'same obstruction under an accident disrupts more');
});
