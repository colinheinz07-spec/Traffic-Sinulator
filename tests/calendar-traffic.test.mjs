import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {demandAtClock,defaultDemands,PATHS} from '../dist/traffic.js';
import {makeCorridors,emptySpatial,advanceSpatial,jamsAt,jamBands} from '../dist/spatial.js';
import {eventFromHit} from '../dist/events.js';
import {networkData} from '../dist/geodata.js';

const base=defaultDemands();
const at=(local)=>demandAtClock(base,new Date(local));

test('weekday traffic demand peaks in morning and evening, with a quiet night',()=>{
 const night=at('2026-10-19T03:00:00'),morning=at('2026-10-19T08:00:00'),evening=at('2026-10-19T17:00:00');
 for(const key of PATHS){
  assert.ok(morning[key]>night[key]*3,key+' morning');
  assert.ok(evening[key]>night[key]*3,key+' evening');
 }
 assert.ok(morning['A3-frankfurt']>morning['A3-koeln'],'morning directional factor applies');
});

test('weekday versus weekend is calendar-dependent, including Sundays',()=>{
 const weekday=at('2026-10-19T07:45:00'),saturday=at('2026-10-17T07:45:00'),sunday=at('2026-10-18T07:45:00');
 assert.ok(weekday['A3-koeln']>saturday['A3-koeln']*2);
 assert.ok(weekday['A3-koeln']>sunday['A3-koeln']*2);
 assert.ok(at('2026-10-18T17:00:00')['A3-koeln']>sunday['A3-koeln']);
 assert.throws(()=>demandAtClock(base,new Date('invalid')));
});

test('crossing midnight changes demand smoothly then follows the next daily peak',()=>{
 const a=at('2026-10-19T23:55:00')['A3-koeln'];
 const b=at('2026-10-20T00:05:00')['A3-koeln'];
 const c=at('2026-10-20T08:05:00')['A3-koeln'];
 assert.ok(a>0&&b>0&&c>b*3);
 assert.ok(Math.abs(a-b)<base['A3-koeln']*.1,'continuous nightly transition');
});

test('dark red marks a very slow but moving one-lane queue',()=>{
 const corridors=makeCorridors(networkData.roads,networkData.ramps);
 const key='A3-koeln',route=corridors[key],p=route.points[Math.floor(route.points.length*.60)];
 const hit={kind:'road',road:networkData.roads.find(r=>r.road===key),point:p,key,distance:0,fraction:.6};
 const event=eventFromHit(hit,'roadworks',3,[0,1],'one-lane','2026-10-19T12:00:00Z',{lengthM:500,speedKmh:40,shoulder:'normal'});
 const state=advanceSpatial(emptySpatial(),[event],base,30,corridors);
 const jam=jamsAt(state,[event],corridors).find(j=>j.id==='one-lane');
 assert.ok(jam&&jam.capacityVph>0,'roadworks remains passable');
 assert.ok(jam.speedKmh>0&&jam.speedKmh<=10,'traffic crawls but moves');
 assert.equal(jam.color,'standstill');
 assert.equal(jamBands(jam).at(-1).color,'standstill');
});

test('date/time controls drive minute-by-minute simulation',()=>{
 const html=readFileSync('index.html','utf8'),app=readFileSync('src/app.ts','utf8');
 for(const id of ['traffic-start-datetime','traffic-clock','traffic-now','traffic-demand-mode'])
  assert.ok(html.includes(`id="${id}"`),id);
 assert.match(html,/value="clock" selected/);
 assert.match(app,/demandAtClock\(trafficDemands,simulatedClock\(\)\)/);
 assert.match(app,/simulationStartMs\+spatialState.minute\*60000/);
 assert.match(app,/spatialState=emptySpatial\(\)/);
 assert.ok(html.includes('Stillstand/Kriechverkehr (0–10 km/h)'));
});