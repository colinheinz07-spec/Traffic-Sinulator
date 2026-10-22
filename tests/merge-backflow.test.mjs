import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice,emptySpatial,advanceSpatial,jamsAt} from '../dist/spatial.js';
import {buildRampConnections,mergeBackflows,rampSpillbacks} from '../dist/interchange.js';
import {PATHS,defaultDemands} from '../dist/traffic.js';
import {eventFromHit} from '../dist/events.js';
const corridors=makeCorridors(networkData.roads,networkData.ramps);
const links=buildRampConnections(networkData.ramps,corridors);
const d=defaultDemands();
function downstreamJam(link,queueM=19000,anchorOffset=7000){
 const route=corridors[link.to];
 const anchor=Math.min(route.lengthM-1,link.downstreamMergeM+anchorOffset);
 assert.ok(anchor>link.downstreamMergeM);
 return {id:'test-'+link.rampId,pathKey:link.to,eventKind:'roadworks',point:route.points[10],anchorM:anchor,
 queueVehicles:queueM/1000*95*3,queueM,visibleQueueM:Math.min(queueM,anchor),delayMin:33,capacityVph:1500,color:'jam',released:false,outOfBoundsM:Math.max(0,queueM-anchor)};
}
test('each of four real OSM merge geometries supports correct A3/A48 reverse backflow',()=>{
 assert.equal(links.length,4);
 for(const link of links){
  const sample=downstreamJam(link);
  const result=mergeBackflows([sample],links,corridors,d);
  const b=result.find(x=>x.rampId===link.rampId);
  assert.ok(b,link.rampId);
  assert.equal(b.target,link.to);assert.equal(b.source,link.from);
  assert.ok(b.rampLengthM>0&&b.rampFromM>=0&&b.rampToM<=corridors[b.rampId].lengthM+1e-6);
  assert.ok(b.sourceLengthM>50,link.rampId+' did not reach motorway');
  assert.ok(b.sourceFromM>=0&&b.sourceToM<=corridors[b.source].lengthM);
  for(const [key,a,z] of [[b.rampId,b.rampFromM,b.rampToM],[b.source,b.sourceFromM,b.sourceToM]]){
   const curve=routeSlice(corridors[key],a,z);
   assert.ok(curve.length>=2,key);
  }
  // Other valid ramps sharing the SAME blocked target may also back up.
  assert.equal(b.source,link.from);
  assert.ok(!result.some(x=>x.rampId===link.rampId && x.source!==link.from));
 }
});
test('downstream queue must physically pass a verified merge, never jump over or cross to the opposite road',()=>{
 for(const link of links){
  const c=corridors[link.to],anchor=Math.min(c.lengthM-1,link.downstreamMergeM+800);
  const tooShort=downstreamJam(link,300,800);
  assert.equal(mergeBackflows([tooShort],links,corridors,d).find(x=>x.rampId===link.rampId),undefined);
  const before={...tooShort,anchorM:Math.max(0,link.downstreamMergeM-100),queueM:8000};
  assert.equal(mergeBackflows([before],links,corridors,d).find(x=>x.rampId===link.rampId),undefined);
  const other=PATHS.filter(x=>x!==link.to&&!x.startsWith('ramp-'))[0];
  const wrong={...tooShort,pathKey:other,queueM:99999};
  assert.equal(mergeBackflows([wrong],links,corridors,d).find(x=>x.rampId===link.rampId),undefined);
 }
});
test('joining traffic demand matters and zero ramp traffic cannot create a ramp backflow',()=>{
 const link=links.find(x=>x.from==='A48-dernbach'&&x.to==='A3-koeln');
 const jam=downstreamJam(link,14500);
 const regular=mergeBackflows([jam],links,corridors,d).find(x=>x.rampId===link.rampId);
 const absent=mergeBackflows([jam],links,corridors,{...d,[link.rampId]:0});
 assert.ok(regular?.rampLengthM>0);assert.ok(!absent.some(x=>x.rampId===link.rampId));
 const reduced=mergeBackflows([jam],links,corridors,{...d,[link.rampId]:150}).find(x=>x.rampId===link.rampId);
 assert.ok(reduced&&reduced.rampLengthM<regular.rampLengthM);
});
test('multiple serial destination incidents cannot claim the same ramp twice',()=>{
 const l=links[0],a=downstreamJam(l,12000),b={...downstreamJam(l,18000),id:'second'};
 const list=mergeBackflows([a,b],links,corridors,d).filter(x=>x.rampId===l.rampId);
 assert.equal(list.length,1);assert.equal(list[0].id,'second');
});
test('display-only projections do not change traffic counts or existing ramp-event spillback',()=>{
 const link=links[0],j=downstreamJam(link),source=structuredClone(j);
 const baseline=rampSpillbacks([j],links,corridors),value=mergeBackflows([j],links,corridors,d);
 assert.ok(value.length>0);assert.deepEqual(j,source);
 assert.deepEqual(rampSpillbacks([j],links,corridors),baseline);
 assert.equal(value.reduce((n,x)=>n+x.rampLengthM,0)>0,true);
});
test('an actual downstream A3 closure can reach A48 through ramp; releasing it drains gradually',()=>{
 const link=links.find(x=>x.from==='A48-dernbach'&&x.to==='A3-koeln');
 const route=corridors[link.to];const along=Math.min(route.lengthM-1000,link.downstreamMergeM+3500);
 const point=route.points.find((p,i)=>route.metres[i]>=along);
 const road=networkData.roads.find(x=>x.road===link.to);
 const hit={kind:'road',road,point,key:link.to,distance:0,fraction:0};
 const event=eventFromHit(hit,'closure',3,[],'x','2026-10-19T00:00:00Z',{lengthM:200,speedKmh:0,shoulder:'blocked'});
 let state=advanceSpatial(emptySpatial(),[event],d,45,corridors);
 let projected=mergeBackflows(jamsAt(state,[event],corridors),links,corridors,d);
 assert.ok(projected.some(x=>x.rampId===link.rampId&&x.sourceLengthM>0));
 const initial=projected.find(x=>x.rampId===link.rampId).sourceLengthM;
 state=advanceSpatial(state,[],d,1,corridors);
 projected=mergeBackflows(jamsAt(state,[],corridors),links,corridors,d);
 assert.ok(projected.some(x=>x.rampId===link.rampId));
 assert.ok(projected.find(x=>x.rampId===link.rampId).sourceLengthM<initial);
 for(let i=0;i<6;i++)state=advanceSpatial(state,[],d,60,corridors);
 projected=mergeBackflows(jamsAt(state,[],corridors),links,corridors,d);
 assert.ok(!projected.some(x=>x.rampId===link.rampId));
});
test('SPCK uses real coupled junction queues and no longer paints fake merge projections',()=>{
 const source=readFileSync('src/app.ts','utf8'),html=readFileSync('index.html','utf8');
 assert.match(source,/advanceSpatial\(spatialState,timeline,active,1,spatialCorridors,rampConnections,transfers,exits(?:,physicalMainline)?\)/);
 assert.ok(source.includes('trafficView(jams,cellNetwork,spatialCorridors,timeline,spillbacks,spatialState.minute)'));
 assert.doesNotMatch(source,/mergeBackflows\(list,rampConnections/);
 assert.match(html,/id="traffic-interchange"/);
 assert.match(html,/TRAFFIC 1\.8\.0/);
});
