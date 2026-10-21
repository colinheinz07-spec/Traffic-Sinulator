import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,emptySpatial,advanceSpatial,jamsAt} from '../dist/spatial.js';
import {defaultDemands} from '../dist/traffic.js';
import {eventFromHit} from '../dist/events.js';
import {stopAndGoBands,propagatedBaseSpeed} from '../dist/traffic-physics.js';

const route=makeCorridors(networkData.roads,networkData.ramps);
const base={id:'unfall',pathKey:'A3-koeln',anchorM:14000,queueM:11000,speedKmh:8};

function colorAt(bands,m){
 return bands.find(b=>b.fromM<=m&&b.toM>=m)?.color??'free';
}
test('a 11-km queue has local red, dark-red and occasional orange sections at once',()=>{
 const bands=stopAndGoBands(base,125);
 const colors=new Set(bands.map(b=>b.color));
 for(const c of ['standstill','jam','slow'])assert.ok(colors.has(c),c+' missing');
 assert.ok(bands.length>8,'a long jam must not be a single painted stripe');
 assert.ok(bands.every(b=>b.toM>b.fromM&&b.fromM>=0&&b.toM<=base.anchorM));
});
test('stop-and-go waves migrate upstream, not entire sections flashing in sync',()=>{
 const t=110,later=112;
 const a=stopAndGoBands(base,t),b=stopAndGoBands(base,later);
 let shifting=0,changing=0,count=0;
 for(let p=3500;p<12800;p+=160){
  const old=colorAt(a,p+460),moving=colorAt(b,p),samePosition=colorAt(a,p);
  if(old===moving)shifting++;
  if(moving!==samePosition)changing++;
  count++;
 }
 assert.ok(shifting/count>.85,'upstream front travels ~230m/min: '+shifting+'/'+count);
 assert.ok(changing>8,'local speeds should evolve after two simulation minutes');
});
test('an incident speed edit propagates upstream after travel time, not instantly',()=>{
 const history=[
  {minute:90,speedKmh:8},{minute:100,speedKmh:8},{minute:101,speedKmh:28}
 ];
 assert.equal(propagatedBaseSpeed(history,101,0,8),28);
 assert.equal(propagatedBaseSpeed(history,101,460,8),8);
 const jam={...base,speedHistory:history};
 const bands=stopAndGoBands(jam,101);
 assert.ok(bands.length>2);
});
test('complete closure remains stopped, no invented moving pockets',()=>{
 const closed=stopAndGoBands({...base,speedKmh:0},140);
 assert.ok(closed.length>0);
 assert.ok(closed.every(b=>b.speedKmh===0&&b.color==='standstill'));
 assert.deepEqual(stopAndGoBands({...base,queueM:0},140),[]);
});
test('same model minute is deterministic; moving waves do not add queue vehicles',()=>{
 assert.deepEqual(stopAndGoBands(base,145),stopAndGoBands(base,145));
 const event={id:'roadblock',kind:'roadworks',pathKey:'A3-koeln',closedLanes:[0,1],laneCount:3,
  createdAt:'2026-10-21T06:00:00Z',point:route['A3-koeln'].points[850],settings:{lengthM:500,speedKmh:60,shoulder:'normal'}};
 const state=advanceSpatial(emptySpatial(),[event],defaultDemands(),30,route);
 const jams=jamsAt(state,[event],route);
 const before=state.queues.roadblock.vehicles,classes=stopAndGoBands(jams[0],state.minute);
 const after=state.queues.roadblock.vehicles;
 assert.equal(after,before,'renderer must be read-only');
 assert.ok(classes.length>1);
 assert.ok(state.queues.roadblock.speedHistory.length>=20,'history holds minute-by-minute local speeds');
});
test('repainting after changing a posted speed without advancing simulation leaves old queue physics intact',()=>{
 const event={id:'incident',kind:'accident',pathKey:'A3-koeln',closedLanes:[0],laneCount:3,
  createdAt:'2026-10-21T06:00:00Z',point:route['A3-koeln'].points[900],settings:{lengthM:100,speedKmh:60,shoulder:'normal'}};
 const state=advanceSpatial(emptySpatial(),[event],defaultDemands(),45,route);
 const before=jamsAt(state,[event],route);
 const revised={...event,settings:{...event.settings,speedKmh:80}};
 const after=jamsAt(state,[revised],route);
 assert.equal(before[0].capacityVph,after[0].capacityVph);
 assert.equal(before[0].speedKmh,after[0].speedKmh);
 assert.deepEqual(stopAndGoBands(before[0],state.minute),stopAndGoBands(after[0],state.minute));
});
test('SPCK app uses wave speeds in place of entire single-color queue, ramps included',()=>{
 const app=readFileSync('src/app.ts','utf8');
 assert.match(app,/stopAndGoBands\(jam,spatialState\.minute\)/);
 assert.match(app,/speedHistory:parent\.speedHistory/);
 assert.match(app,/physicalSpeedBands\(jam\)\.filter\(b=>b\.source==='approach'\)/);
});
