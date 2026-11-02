import test from 'node:test';
import assert from 'node:assert/strict';
import {eventFromHit,validEvent,DEFAULT_CLEARANCE_MIN} from '../dist/events.js';
import {eventCapacity} from '../dist/traffic.js';
import {initialiseCells,cellSpeedBands,cellQueueSpans} from '../dist/traffic-cells.js';
import {makeCorridors} from '../dist/spatial.js';
import {networkData} from '../dist/geodata.js';
const stamp='2026-11-02T12:00:00Z';
const route=makeCorridors(networkData.roads,networkData.ramps)['A3-frankfurt'];
const base={kind:'road',key:'A3-frankfurt',road:networkData.roads.find(x=>x.road==='A3-frankfurt'),point:route.points[0],distance:0,fraction:0};
test('events validate coordinates across the extended road network',()=>{
 for(const point of [[50.5,7.8],[50.99,6.9],[51.1,7.2],[50.1,8.5]]){
  const e=eventFromHit({...base,point},'roadworks',3,[0],'wide',stamp,{lengthM:100,speedKmh:40,shoulder:'normal'});
  assert.equal(validEvent(e),true,JSON.stringify(point));
 }
 assert.throws(()=>eventFromHit({...base,point:[92,10]},'roadworks',3,[0],'invalid',stamp));
});
test('zero clearance means no guessed reopening; explicit crawl has low service',()=>{
 assert.equal(DEFAULT_CLEARANCE_MIN,0);
 const e=eventFromHit(base,'accident',3,[0,1], 'crawl',stamp,{lengthM:100,speedKmh:.5,shoulder:'normal'});
 assert.ok(eventCapacity(e)>0&&eventCapacity(e)<100);
 assert.ok(validEvent(e));
 assert.equal(validEvent({...e,settings:{...e.settings,speedKmh:.25}}),false);
});
test('occupied slow cells do not leave a green gap below critical density',()=>{
 const st=initialiseCells(route,0),c=st.cells[8];
 c.vehicles=1;c.densityVehKm=10;c.speedKmh=5;
 assert.ok(cellSpeedBands(st).some(b=>b.fromM<=c.fromM&&b.toM>=c.toM));
 assert.ok(cellQueueSpans(st).some(b=>b.fromM<=c.fromM&&b.toM>=c.toM));
});
