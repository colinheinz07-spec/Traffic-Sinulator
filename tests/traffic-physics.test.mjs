import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice,advanceSpatial,emptySpatial,jamsAt,queueCondition} from '../dist/spatial.js';
import {buildRampConnections,rampSpillbacks} from '../dist/interchange.js';
import {routeReport} from '../dist/network-report.js';
import {defaultDemands} from '../dist/traffic.js';
import {eventFromHit} from '../dist/events.js';
import {colorAtSpeed,queueFundamentalDiagram,physicalSpeedBands,resolveSpeedBands,freeSpeedKmh} from '../dist/traffic-physics.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
const links=buildRampConnections(networkData.ramps,routes),d=defaultDemands();

test('all four colors have exact speed boundaries (km/h)',()=>{
 for(const [v,color] of [[0,'standstill'],[10,'standstill'],[10.01,'jam'],[30,'jam'],[30.01,'slow'],[65,'slow'],[65.01,'free'],[120,'free']])
  assert.equal(colorAtSpeed(v),color,v+' km/h');
 assert.throws(()=>colorAtSpeed(-1));assert.throws(()=>colorAtSpeed(NaN));
});

test('triangular diagram: capacity, speed and density obey flow conservation',()=>{
 for(const path of ['A3-koeln','A48-dernbach','ramp-a48-to-koeln']){
  for(const lanes of [1,2,3]){
   for(const cap of [0,500,1500,2800,3900]){
    const p=queueFundamentalDiagram(cap,lanes,path);
    assert.ok(p.densityVehPerKm>0&&p.densityVehPerKm<=95*lanes);
    assert.ok(p.speedKmh>=0&&p.speedKmh<=freeSpeedKmh(path));
    if(cap===0)assert.equal(p.speedKmh,0);
    else assert.ok(p.speedKmh*p.densityVehPerKm<=cap+1e-8);
   }
  }
 }
 const congested=queueFundamentalDiagram(1600,3,'A3-koeln');
 const moderate=queueFundamentalDiagram(3000,3,'A3-koeln');
 const slow=queueFundamentalDiagram(3900,3,'A3-koeln');
 assert.equal(colorAtSpeed(congested.speedKmh),'standstill');
 assert.equal(colorAtSpeed(moderate.speedKmh),'jam');
 assert.equal(colorAtSpeed(slow.speedKmh),'slow');
 assert.equal(colorAtSpeed(queueFundamentalDiagram(5400,3,'A3-koeln').speedKmh),'free');
});

test('approach colors follow calculated braking distance and local speeds',()=>{
 const bands=physicalSpeedBands({pathKey:'A3-koeln',anchorM:9000,queueM:1800,speedKmh:7});
 assert.equal(bands.at(-1).source,'queue');
 assert.equal(bands.at(-1).toM,9000);
 assert.equal(bands.at(-1).fromM,7200);
 assert.equal(bands.at(-1).color,'standstill');
 assert.ok(bands.some(x=>x.source==='approach'&&x.color==='slow'),'slow approach must be present');
 assert.ok(bands.some(x=>x.source==='approach'&&x.color==='jam'),'red deceleration threshold must be present');
 assert.ok(bands.every(x=>x.color===colorAtSpeed(x.speedKmh)));
 assert.ok(bands.every(x=>x.toM>x.fromM&&x.fromM>=0));
 assert.ok(bands[0].toM<=7200,'approach must be upstream of the standing queue');
 assert.deepEqual(physicalSpeedBands({pathKey:'A3-koeln',anchorM:9000,queueM:0,speedKmh:7}),[]);
});

test('overlapping obstacles select the slowest speed independent of draw order',()=>{
 const a={fromM:1000,toM:1900,color:'slow',speedKmh:45,source:'restriction'};
 const b={fromM:1600,toM:2400,color:'standstill',speedKmh:6,source:'queue'};
 const first=resolveSpeedBands([a,b]);
 assert.deepEqual(first,resolveSpeedBands([b,a]));
 assert.ok(first.some(x=>x.fromM===1600&&x.color==='standstill'));
 assert.ok(first.every(x=>x.toM>x.fromM));
});

test('work zone speed limit adds only the actual traversal time even without a queue',()=>{
 const key='A3-koeln',at=routes[key].lengthM*.7;
 const point=routeSlice(routes[key],at,at+3)[0];
 const hit={kind:'road',road:networkData.roads.find(r=>r.road===key),key,point,distance:0,fraction:.7};
 const event=eventFromHit(hit,'roadworks',3,[],'posted-40','2026-10-21T06:00:00Z',{lengthM:500,speedKmh:40,shoulder:'normal'});
 const result=routeReport(key,[],[],[event]);
 assert.equal(result.ownVehicles,0);
 assert.equal(result.speedKmh,40);
 assert.equal(result.color,'slow');
 assert.ok(Math.abs(result.delayMin-0.5)<.0001,'500m at 40 instead of 120 is 0.5min, no extra surcharge');
 const none=routeReport(key,[],[],[]);
 assert.equal(none.delayMin,0);assert.equal(none.color,'free');
});

test('constant saved queue has the same travel delay regardless of elapsed clock minutes',()=>{
 const key='A3-koeln',point=routes[key].points[500];
 const initial={minute:5,queues:{site:{pathKey:key,point,vehicles:340,lanes:3,capacityVph:2700,active:false}}};
 const later={...initial,minute:initial.minute+500};
 const a=jamsAt(initial,[],routes),b=jamsAt(later,[],routes);
 assert.deepEqual(a,b);
 assert.equal(a[0].color,colorAtSpeed(a[0].speedKmh));
 assert.ok(a[0].queueM>0);
});

test('A48 through-route is not slowed by a red exit-lane queue after 180 minutes',()=>{
 const link=links.find(l=>l.rampId==='ramp-a48-to-koeln');
 const path='A3-koeln',at=Math.min(routes[path].lengthM-2000,link.downstreamMergeM+1100);
 const p=routeSlice(routes[path],at,at+2)[0];
 const hit={kind:'road',road:networkData.roads.find(r=>r.road===path),key:path,point:p,distance:0,fraction:.6};
 const ev=eventFromHit(hit,'roadworks',3,[0,1],'jam','2026-10-21T06:00:00Z',{lengthM:500,speedKmh:40,shoulder:'normal'});
 let state=emptySpatial(),hasSpill=false;
 for(let i=0;i<180;i++){
  state=advanceSpatial(state,[ev],d,1,routes,links);
  const jams=jamsAt(state,[ev],routes),spill=rampSpillbacks(jams,links,routes);
  const feeder=routeReport('A48-dernbach',jams,spill,[ev]);
  assert.equal(feeder.delayMin,0,'no fake A48 through wait at '+i);
  assert.equal(feeder.color,'free','exit-lane congestion cannot recolor through-traffic');
  if(feeder.sharedRampVehicles>0)hasSpill=true;
 }
 assert.ok(hasSpill,'test needs actual blocked ramp reaching the A48 exit');
});

test('latest HTML legend and linked physics are speed-based',()=>{
 const html=readFileSync('index.html','utf8');
 const app=readFileSync('src/app.ts','utf8');
 assert.match(html,/TRAFFIC 1\.5\.0/);
 for(const label of ['Frei (&gt;65 km/h)','Stockend (&gt;30–65 km/h)','Stau\/Stop-and-Go (&gt;10–30 km/h)','Stillstand\/Kriechverkehr (0–10 km/h)'])
  assert.ok(html.includes(label),label);
 assert.match(app,/physicalSpeedBands\(jam\)/);
 assert.match(app,/resolveSpeedBands\(bands\)/);
 assert.match(app,/result\.speedKmh/);
});
