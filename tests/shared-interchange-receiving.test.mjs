import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,emptySpatial,advanceSpatial} from '../dist/spatial.js';
import {initialiseCells} from '../dist/traffic-cells.js';
import {rampReceiving,downstreamReceiving,sharedNetworkReceiving} from '../dist/network-receiving.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
const target='A3-frankfurt',metre=1500;
const rampA='ramp-a48-to-frankfurt',rampB='ramp-a48-to-koeln';
const feeds=[
 {from:'A48-dernbach',to:target,mergeM:metre},
 {from:'A48-koblenz',to:target,mergeM:metre}
];
const ramps=[
 {rampId:rampA,to:target,downstreamMergeM:metre},
 {rampId:rampB,to:target,downstreamMergeM:metre}
];
function congested(){
 const state=initialiseCells(routes[target],1200);
 const cell=state.cells[Math.floor(metre/state.cellM)];
 cell.densityVehKm=(cell.jamDensityVehKm??390)-10;
 cell.speedKmh=0;return state;
}
const sum=o=>Object.values(o).reduce((n,v)=>n+v,0);
test('two motorways and two ramps share ONE congested receiving face at a motorway junction',()=>{
 const grid=congested(),snapshot=JSON.stringify(grid),active={
  'A48-dernbach':2400,'A48-koblenz':1600,
  [rampA]:1400,[rampB]:1000
 };
 const limits=sharedNetworkReceiving({[target]:grid},ramps,feeds,active);
 assert.equal(Object.keys(limits.motorways).length,2);
 assert.equal(Object.keys(limits.ramps).length,2);
 const allocated=sum(limits.ramps)+sum(limits.motorways);
 assert.ok(Math.abs(allocated-220)<1e-6,'one CTM face must supply 220 veh/h, not 4× 220');
 assert.ok(Object.values(limits.ramps).every(x=>x>0));
 assert.ok(Object.values(limits.motorways).every(x=>x>0));
 assert.deepEqual(sharedNetworkReceiving({[target]:grid},
  [...ramps,ramps[0]],[...feeds,feeds[0]],active),limits,
  'duplicate ramp and motorway links must not receive another supply share');
 assert.equal(JSON.stringify(grid),snapshot,'measuring receiving cannot mutate traffic stock');
});
test('mainline-only feeder mergers also pool instead of multiplying downstream capacity',()=>{
 const grid=congested();
 const result=downstreamReceiving({[target]:grid},feeds,{
  'A48-dernbach':2000,'A48-koblenz':1000
 });
 assert.equal(Math.round(sum(result)),220);
 assert.ok(result['A48-dernbach']>result['A48-koblenz']);
 assert.ok(result['A48-dernbach']<220);
});
test('an idle ramp has no capacity entitlement until it has a queued inventory',()=>{
 const grid=congested(),active={'A48-dernbach':1800,[rampA]:1000,[rampB]:0};
 const empty=sharedNetworkReceiving({[target]:grid},ramps,feeds.slice(0,1),active);
 assert.equal(empty.ramps[rampB],0);
 const retained=sharedNetworkReceiving({[target]:grid},ramps,feeds.slice(0,1),active,{[rampB]:12});
 assert.ok(retained.ramps[rampB]>0);
 assert.ok(sum(retained.ramps)+sum(retained.motorways)<=220+1e-6);
});
test('independent receiving cells do not accidentally share one global budget',()=>{
 const grid=congested();
 const other=grid.cells[Math.floor(3500/grid.cellM)];
 other.densityVehKm=(other.jamDensityVehKm??390)-10;other.speedKmh=0;
 const signals=sharedNetworkReceiving({[target]:grid},[
  ramps[0],{...ramps[1],downstreamMergeM:3500}
 ],[],{[rampA]:1000,[rampB]:1000});
 assert.ok(Math.abs(signals.ramps[rampA]-220)<1e-6);
 assert.ok(Math.abs(signals.ramps[rampB]-220)<1e-6);
});
test('free-flow target never creates a phantom queue on either motorway or ramp',()=>{
 const cell=initialiseCells(routes[target],800);
 assert.deepEqual(sharedNetworkReceiving({[target]:cell},ramps,feeds),{ramps:{},motorways:{}});
});
test('closed receiving cell shuts every entering ramp and motorway arm, not unrelated paths',()=>{
 const grid=initialiseCells(routes[target],800);
 grid.closures=[{face:15,fromM:1500,toM:1700,exitRef:null,eventId:'closed',diverting:false}];
 const result=sharedNetworkReceiving({[target]:grid},ramps,feeds);
 assert.ok(Object.values(result.ramps).every(v=>v===0));
 assert.ok(Object.values(result.motorways).every(v=>v===0));
 assert.deepEqual(result,sharedNetworkReceiving({[target]:grid},ramps,feeds));
});
test('a queued ramp can discharge its allocated share after new arrivals stop',()=>{
 const grid=congested();
 const link={rampId:rampA,from:'A48-dernbach',to:target,rampEntryM:200,
  downstreamMergeM:metre,sourceGapM:0,mergeGapM:0};
 const demand={ 'A3-frankfurt':4200,'A48-dernbach':1800,[rampA]:1200 };
 const capped=advanceSpatial(emptySpatial(),[],demand,1,routes,[link],[],[],undefined,[rampA],{[rampA]:0});
 const stock=capped.queues['merge:'+rampA]?.vehicles??0;
 assert.ok(stock>10,'the blocked ramp must contain the offered, conserved vehicles');
 const noNew={...demand,[rampA]:0};
 const available=rampReceiving({[target]:grid},[link],{[rampA]:0},{[rampA]:stock});
 assert.ok(available[rampA]>0);
 const released=advanceSpatial(capped,[],noNew,1,routes,[link],[],[],undefined,[rampA],available);
 const after=released.queues['merge:'+rampA]?.vehicles??0;
 assert.ok(after<stock,'already waiting cars discharge even with no new arrivals');
 assert.ok(after>=0,'stock cannot go negative');
});
