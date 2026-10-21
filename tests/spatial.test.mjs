import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,positionM,routeSlice,emptySpatial,advanceSpatial,jamsAt,jamBands,metres} from '../dist/spatial.js';
import {defaultDemands,PATHS} from '../dist/traffic.js';
import {eventFromHit} from '../dist/events.js';

const corridors=makeCorridors(networkData.roads,networkData.ramps),demands=defaultDemands();
const date='2026-10-19T00:00:00.000Z';
function eventAt(key,fraction,kind='roadworks',closed=[0,1],speed=40,id='e'){
 const geom=corridors[key];const pt=geom.points[Math.floor((geom.points.length-1)*fraction)];
 const road=networkData.roads.find(x=>x.road===key),ramp=networkData.ramps.find(x=>x.id===key);
 const hit=road?{kind:'road',road,point:pt,key, distance:0,fraction}: {kind:'ramp',ramp,point:pt,key,distance:0,fraction};
 const laneCount=key.startsWith('ramp-')?2:3;
 return eventFromHit(hit,kind,laneCount,closed,id,date,{lengthM:kind==='closure'?200:500,speedKmh:speed,shoulder:kind==='closure'?'blocked':'normal'});
}
test('complete eight real OSM corridors, no route jumps or opposing carriageway conflation',()=>{
 assert.deepEqual(Object.keys(corridors).sort(),[...PATHS].sort());
 for(const key of PATHS){
  const c=corridors[key];assert.ok(c.points.length>=30,key);assert.ok(c.lengthM>1000,key);
  assert.ok(c.metres.every((v,i)=>i===0||v>=c.metres[i-1]));
  const total=c.points.slice(1).reduce((a,p,i)=>a+metres(c.points[i],p),0);
  assert.ok(Math.abs(total-c.lengthM)<.02,key);
 }
 for(const key of ['A3-koeln','A48-koblenz'])assert.ok(corridors[key].points[0][1]>corridors[key].points.at(-1)[1]);
 for(const key of ['A3-frankfurt','A48-dernbach'])assert.ok(corridors[key].points[0][1]<corridors[key].points.at(-1)[1]);
 assert.ok(corridors['A3-koeln'].lengthM>70000);assert.ok(corridors['A48-dernbach'].lengthM>23000);
});
test('positions and slices are only on existing road curves, not fabricated shortcuts',()=>{
 const c=corridors['A3-koeln'],p=c.points[600],at=positionM(c,p);
 assert.ok(at>1000&&at<c.lengthM-1000);
 const trace=routeSlice(c,at-1000,at);assert.ok(trace.length>=2);
 assert.ok(metres(trace.at(-1),p)<2);
 assert.equal(positionM(c,[50.99,7.99]),null);
 assert.deepEqual(routeSlice(c,-999,-100),[]);
});
test('one A3 construction produces an upstream-only queue and four user colors',()=>{
 const e=eventAt('A3-koeln',.6,'roadworks',[0,1],40,'montabaur');
 const state=advanceSpatial(emptySpatial(),[e],demands,30,corridors);
 const jams=jamsAt(state,[e],corridors);assert.equal(jams.length,1);
 const j=jams[0];assert.equal(j.pathKey,'A3-koeln');assert.ok(j.queueVehicles>100&&j.queueM>0);
 const bands=jamBands(j);assert.equal(bands.length,1,'no fabricated orange/red fractions');
 assert.ok(bands.every(b=>b.fromM>=0&&b.toM<=j.anchorM+1e-9));
 assert.equal(bands[0].color,'standstill','actual congested segment gets the derived color');
 assert.equal(state.queues['montabaur'].pathKey,'A3-koeln');
 assert.ok(!jams.some(x=>x.pathKey==='A3-frankfurt'));
});
test('all-lane closure creates standstill patch but never fakes a finite delay',()=>{
 const e=eventAt('A3-frankfurt',.6,'closure',[0,1,2],0,'closed');
 const state=advanceSpatial(emptySpatial(),[e],demands,12,corridors);
 const jams=jamsAt(state,[e],corridors);assert.equal(jams.length,1);
 assert.equal(jams[0].delayMin,null);assert.equal(jams[0].color,'standstill');
 assert.ok(jamBands(jams[0]).some(b=>b.color==='standstill'));
});
test('two serial events form separate identifiable queues without double counting upstream arrival',()=>{
 const a=eventAt('A3-koeln',.35,'roadworks',[0],80,'upstream');
 const b=eventAt('A3-koeln',.65,'roadworks',[0,1],40,'downstream');
 const state=advanceSpatial(emptySpatial(),[a,b],demands,20,corridors);
 const jams=jamsAt(state,[a,b],corridors);
 assert.equal(jams.length,2);assert.deepEqual(jams.map(x=>x.id),['upstream','downstream']);
 assert.ok(jams.every(j=>j.queueM>0&&j.delayMin>0));
 assert.equal(jams.filter(j=>j.pathKey==='A3-frankfurt').length,0);
 assert.ok(state.queues['upstream'].vehicles+state.queues['downstream'].vehicles <= demands['A3-koeln']/60*20+1);
});
test('after removing a worksite queued vehicles drain, with no residual blockade or instant disappearance',()=>{
 const e=eventAt('A3-koeln',.6,'roadworks',[0,1],40,'works');
 const packed=advanceSpatial(emptySpatial(),[e],demands,20,corridors);
 const residual=advanceSpatial(packed,[],demands,1,corridors);
 assert.ok(residual.queues.works.vehicles>0,'cannot erase jam instantly');
 assert.ok(residual.queues.works.vehicles<packed.queues.works.vehicles,'discharge starts immediately');
 let cleared=residual;for(let i=0;i<4;i++)cleared=advanceSpatial(cleared,[],demands,60,corridors);
 assert.equal(cleared.queues.works,undefined);assert.deepEqual(jamsAt(cleared,[],corridors),[]);
});
test('ramp queue remains on its own directional branch, never flows onto A48 in 4b',()=>{
 const e=eventAt('ramp-a48-to-koeln',.6,'closure',[0,1],0,'ramp');
 const state=advanceSpatial(emptySpatial(),[e],demands,12,corridors);
 const jams=jamsAt(state,[e],corridors);
 assert.equal(jams.length,1);assert.equal(jams[0].pathKey,e.pathKey);
 assert.equal(state.queues['ramp'].pathKey,'ramp-a48-to-koeln');
 assert.ok(jams[0].visibleQueueM<=corridors[e.pathKey].lengthM);
});
test('SPCK main entry supports own per-stau report and compiled geometry overlay',()=>{
 const html=readFileSync('index.html','utf8'),app=readFileSync('src/app.ts','utf8');
 assert.match(html,/id="traffic-jams"/);assert.match(html,/id="traffic-jams-count"/);
 assert.match(app,/drawSpatialJams\(\)/);assert.match(app,/routeSlice/);
 assert.match(app,/advanceSpatial\(spatialState,timeline,active,1,spatialCorridors,rampConnections,transfers\)/);
 assert.match(app,/initializeTraffic\(\);redrawEventList\(\)/);
 assert.ok(!html.includes('map-v2/'));
});
