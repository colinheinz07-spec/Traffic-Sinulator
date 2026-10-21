import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {initialiseCells,advanceCells,cellSpeedBands,cellInventory,assertCellConservation} from '../dist/traffic-cells.js';
import {eventFromHit,updatedEvent} from '../dist/events.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
const key='A3-koeln',road=routes[key];
function incident(fraction,kind='closure',lanes=[0,1,2],speed=0){
 const at=road.lengthM*fraction,point=routeSlice(road,at,at+2)[0];
 const found=networkData.roads.find(r=>r.road===key);
 const hit={kind:'road',road:found,key,point,distance:0,fraction};
 return eventFromHit(hit,kind,3,lanes,'accident','2026-10-21T12:00:00Z',
  {lengthM:500,speedKmh:speed,shoulder:kind==='closure'?'blocked':'normal'});
}
test('cell coordinates correspond only to the real OSM motorway, maximum 500m',()=>{
 for(const path of ['A3-koeln','A3-frankfurt','A48-koblenz','A48-dernbach']){
  const state=initialiseCells(routes[path],2800);
  assert.ok(state.cells.length>35);
  assert.ok(state.cellM<=500&&state.cellM>250);
  assert.equal(state.cells[0].fromM,0);
  assert.ok(Math.abs(state.cells.at(-1).toM-routes[path].lengthM)<.001);
  assert.ok(state.cells.every((c,i)=>i===0||Math.abs(c.fromM-state.cells[i-1].toM)<.001));
 }
});
test('mass balance holds over hours of rush hour, jam and reopening',()=>{
 const blocked=incident(.42);
 let state=initialiseCells(road,4200);
 for(let minute=0;minute<180;minute++){
  const incidents=minute<50?[blocked]:
   minute<115?[updatedEvent(blocked,'roadworks',[2],{lengthM:500,speedKmh:80,shoulder:'normal'})]:[];
  state=advanceCells(state,road,incidents,minute>130?1500:4200);
  assertCellConservation(state);
  assert.ok(state.cells.every(c=>c.vehicles>=-1e-6&&c.speedKmh>=0&&c.densityVehKm>=0));
 }
 assert.equal(state.minute,180);
 assert.ok(state.exitedTotal>0&&state.offeredTotal>0);
});
test('three blocked lanes first stop traffic locally, release of two lanes drains without global repaint',()=>{
 const blocked=incident(.5);
 let state=initialiseCells(road,3200);
 for(let i=0;i<25;i++)state=advanceCells(state,road,[blocked],3200);
 const eventFace=Math.floor((road.lengthM*.5)/state.cellM);
 const upstream=state.cells.slice(Math.max(0,eventFace-12),eventFace);
 const downstream=state.cells.slice(eventFace+2,eventFace+14);
 assert.ok(upstream.some(c=>c.densityVehKm>100&&c.speedKmh<=10),
  'upstream cells accumulate independently of downstream');
 assert.ok(downstream.every(c=>c.densityVehKm<100),'downstream was not magically stopped');
 const before=state.cells.map(c=>c.vehicles);
 const reopened=updatedEvent(blocked,'roadworks',[2],{lengthM:500,speedKmh:80,shoulder:'normal'});
 state=advanceCells(state,road,[reopened],1200);
 const localChanges=state.cells.map((c,i)=>Math.abs(c.vehicles-before[i]))
  .filter(d=>d>.05).length;
 assert.ok(localChanges>0&&localChanges<state.cells.length*.2,
  'one-minute release cannot change densities everywhere at once');
 for(let minute=0;minute<110;minute++)state=advanceCells(state,road,[reopened],1200);
 const after=state.cells.slice(Math.max(0,eventFace-12),eventFace);
 assert.ok(after.reduce((a,c)=>a+c.vehicles,0)<upstream.reduce((a,c)=>a+c.vehicles,0),
  'more discharge than inflow reduces waiting vehicles behind accident');
});
test('real cell speeds, not periodic impulses, determine chart colors',()=>{
 const blocked=incident(.6);
 let state=initialiseCells(road,3800);
 for(let i=0;i<45;i++)state=advanceCells(state,road,[blocked],3800);
 const bands=cellSpeedBands(state);
 assert.ok(bands.length>0);
 assert.ok(bands.every(b=>b.source==='cell'&&b.speedKmh<=65&&b.toM>b.fromM));
 assert.ok(bands.some(b=>b.color==='standstill'));
 const twice=cellSpeedBands(state);
 assert.deepEqual(bands,twice,'repainting cannot advance the model or create pulses');
});
test('one free lane need not create a jam at very low demand',()=>{
 let state=initialiseCells(road,450);
 const work=incident(.4,'roadworks',[0,1],80);
 for(let i=0;i<70;i++)state=advanceCells(state,road,[work],450);
 assert.equal(cellSpeedBands(state).length,0,'low inflow should not build a queue');
});
test('cell road treatment leaves ramp and diversion state entirely untouched',()=>{
 const src=readFileSync('src/app.ts','utf8');
 assert.match(src,/CELL_PATHS=PATHS\.filter\(key=>!key\.startsWith\('ramp-'\)\)/);
 assert.match(src,/cellNetwork\[key\]=advanceCells/);
 assert.match(src,/if\(cellNetwork\[jam\.pathKey\]\)continue/);
 assert.match(src,/advanceSpatial\(spatialState,events,active,1,spatialCorridors,rampConnections,transfers\)/);
});
