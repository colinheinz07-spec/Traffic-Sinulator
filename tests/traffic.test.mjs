import test from 'node:test';
import assert from 'node:assert/strict';
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

// Regression from iPhone feedback: 0.9-1.1 made 40 km/h and two blocked A3
// lanes discharge just 916 veh/h despite a separately accounted merge loss.
test('moderate 40 km/h work-zone discharge avoids exaggerated short-term delay',()=>{
 const event=E('roadworks',[0,1],40);
 const capacity=eventCapacity(event);
 assert.ok(capacity>=1400&&capacity<=1650,`work zone one-lane discharge ${capacity}`);
 const d=defaultDemands();
 assert.equal(d['A3-koeln'],4200,'demand must not be silently lowered to hide jams');
 const five=trafficEstimate(advanceTraffic(emptyTraffic(),[event],d,5),'A3-koeln',[event],d['A3-koeln']);
 const fifteen=trafficEstimate(advanceTraffic(emptyTraffic(),[event],d,15),'A3-koeln',[event],d['A3-koeln']);
 assert.ok(five.delayMin>0&&five.delayMin<12,`five-minute delay ${five.delayMin}`);
 assert.ok(fifteen.delayMin>=20&&fifteen.delayMin<=35,`15-minute delay ${fifteen.delayMin}`);
 assert.ok(fifteen.delayMin>five.delayMin,'ongoing overload still grows the queue');
 assert.ok(fifteen.queueKm>0,'no artificial deletion of queued vehicles');
});
test('slow pass-by remains restrictive, normal speed-only limits need not cause a queue',()=>{
 const d=defaultDemands();
 const normal=E('roadworks',[],40);
 assert.ok(eventCapacity(normal)>d['A3-koeln'],'speed limit alone must not force a 4.2k/h jam');
 assert.equal(advanceTraffic(emptyTraffic(),[normal],d,15).vehiclesWaiting['A3-koeln'],0);
 const c10=eventCapacity(E('roadworks',[0,1],10)),c30=eventCapacity(E('roadworks',[0,1],30)),c40=eventCapacity(E('roadworks',[0,1],40)),c80=eventCapacity(E('roadworks',[0,1],80));
 assert.ok(0<c10&&c10<c30&&c30<c40&&c40<c80,`monotone physically passable capacities ${[c10,c30,c40,c80]}`);
 const closure=E('closure',[0,1,2],0,'blocked');
 assert.equal(eventCapacity(closure),0,'full closure must stay physically blocked');
 const incident=E('accident',[0,1],40);
 assert.ok(eventCapacity(incident)<eventCapacity(E('roadworks',[0,1],40)),'incident has tighter squeeze');
});
