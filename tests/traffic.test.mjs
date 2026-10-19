import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PATHS,emptyTraffic,advanceTraffic,defaultDemands,trafficEstimate,eventCapacity,baselineCapacity,pathBottleneck} from '../dist/traffic.js';
import {eventFromHit} from '../dist/events.js';
import {networkData} from '../dist/geodata.js';
import {mapCandidates} from '../dist/selection.js';
const project=p=>[p[1]*10000,p[0]*10000];
const r=networkData.roads.find(x=>x.road==='A3-koeln'&&x.lanes===3);
const hit=mapCandidates([r],[],project(r.points[0]),project,2)[0];
const E=(kind,closed,speed,shoulder='normal',name='e')=>eventFromHit(hit,kind,3,closed,name,'2026-10-19T00:00:00Z',{lengthM:kind==='accident'?100:500,speedKmh:speed,shoulder});
test('independent paths and plausible free-flow default rates',()=>{
 assert.equal(PATHS.length,8);const d=defaultDemands();const state=advanceTraffic(emptyTraffic(),[],d,30);
 for(const key of PATHS){assert.equal(state.vehiclesWaiting[key],0);assert.ok(baselineCapacity(key)>d[key]);}
 assert.equal(trafficEstimate(state,'A3-koeln',[],d['A3-koeln']).color,'free');
});
test('restriction creates a real queue, no negative counts, and clearance drains it',()=>{
 const d=defaultDemands(),e=E('roadworks',[0,1],40);const before=emptyTraffic();
 const after=advanceTraffic(before,[e],d,30);const wait=after.vehiclesWaiting['A3-koeln'];
 assert.ok(wait>100);assert.equal(after.vehiclesWaiting['A3-frankfurt'],0);
 const result=trafficEstimate(after,'A3-koeln',[e],d['A3-koeln']);
 assert.ok(result.queueKm>0);assert.ok(result.delayMin>0);assert.ok(['slow','jam'].includes(result.color));
 const drained=advanceTraffic(advanceTraffic(after,[],d,60),[],d,60);
 assert.ok(drained.vehiclesWaiting['A3-koeln']<wait);
 assert.equal(drained.vehiclesWaiting['A3-koeln'],0);
});
test('shoulder opening increases capacity, speed reduction decreases it',()=>{
 const closed=E('roadworks',[0],40,'normal');const open=E('roadworks',[0],40,'open');
 assert.ok(eventCapacity(open)>eventCapacity(closed));
 assert.ok(eventCapacity(E('roadworks',[0],80))>eventCapacity(closed));
 assert.ok(eventCapacity(closed)<baselineCapacity('A3-koeln'));
});
test('official full closure is different from an all-lanes accident',()=>{
 const closure=E('closure',[0,1,2],0,'blocked');
 const accident=E('accident',[0,1,2],0);
 assert.equal(eventCapacity(closure),0);assert.equal(eventCapacity(accident),0);
 const d=defaultDemands(),q=advanceTraffic(emptyTraffic(),[closure],d,10);
 const result=trafficEstimate(q,'A3-koeln',[closure],d['A3-koeln']);
 assert.equal(result.color,'standstill');assert.equal(result.delayMin,null);assert.equal(result.officiallyClosed,true);
 assert.equal(trafficEstimate(q,'A3-koeln',[accident],d['A3-koeln']).officiallyClosed,false);
});
test('two incidents on same path do not incorrectly double-count demand',()=>{
 const first=E('roadworks',[0],60,'normal','one');const second=E('accident',[0,1],40,'normal','two');
 const bottleneck=pathBottleneck('A3-koeln',[first,second]);
 assert.equal(bottleneck.capacityVph,Math.min(eventCapacity(first),eventCapacity(second)));
 assert.equal(bottleneck.count,2);
 const d=defaultDemands(),q=advanceTraffic(emptyTraffic(),[first,second],d,5);
 assert.ok(q.vehiclesWaiting['A3-koeln']<=advanceTraffic(emptyTraffic(),[second],d,5).vehiclesWaiting['A3-koeln']+1e-7);
});
test('a ramp event affects its ramp only, without inventing A3/A48 interchange movement',()=>{
 const ramp=networkData.ramps[0];const hit=mapCandidates([], [ramp],project(ramp.points[0]),project,2)[0];
 const event=eventFromHit(hit,'roadworks',2,[0], 'ramp1','2026-10-19T00:00:00Z',{lengthM:500,speedKmh:40,shoulder:'normal'});
 const demands=defaultDemands();demands[ramp.id]=1600;
 const state=advanceTraffic(emptyTraffic(),[event],demands,30);
 assert.ok(state.vehiclesWaiting[ramp.id]>0);
 for(const key of PATHS.filter(x=>x!==ramp.id))assert.equal(state.vehiclesWaiting[key],0);
});
test('determinism, time input, and invalid flow controls are rejected',()=>{
 const x=emptyTraffic(),d=defaultDemands();
 assert.deepEqual(advanceTraffic(x,[],d,10),advanceTraffic(x,[],d,10));
 assert.equal(x.minute,0);assert.throws(()=>advanceTraffic(x,[],d,0));
 assert.throws(()=>advanceTraffic(x,[],{...d,'A3-koeln':-1},1));
 assert.throws(()=>trafficEstimate(x,'A3-koeln',[],9000));
});
test('SPCK controls and compiled module hooks exist without a second app entry',async()=>{
 const {readFileSync}=await import('node:fs');
 const html=readFileSync('index.html','utf8');
 const app=readFileSync('src/app.ts','utf8');
 for(const id of ['traffic-route','traffic-inflow','traffic-play','traffic-step','traffic-reset','traffic-minute','traffic-demand','traffic-queue','traffic-queue-km','traffic-delay','traffic-summary'])
  assert.ok(html.includes(`id="${id}"`),`missing ${id}`);
 assert.match(app,/advanceTraffic/);
 assert.match(app,/document\.addEventListener\('visibilitychange'/);
 assert.ok(!html.includes('map-v2/'));
});

// Regression: 0.9 displayed an empty picker on iOS because start() never called initializeTraffic().
test('traffic route picker is initialized at startup and has eight static fallback options',()=>{
 const html=readFileSync('index.html','utf8'),app=readFileSync('src/app.ts','utf8');
 const keys=[...html.matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]);
 for(const path of PATHS)assert.ok(keys.includes(path),`missing iOS fallback path: ${path}`);
 assert.match(app,/function start\(\)[\s\S]*?bind\(\);initializeTraffic\(\);/);
 assert.match(app,/function initializeTraffic\(\)[\s\S]*?select\.replaceChildren\(\)/);
});
