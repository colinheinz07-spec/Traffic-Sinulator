import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localWaveSpeed,stopAndGoBands,waveEpisodes} from '../dist/traffic-physics.js';
import {placeJamCallout,intersectsLabel} from '../dist/map-callouts.js';
import {graphFromWays,shortestOSMRoute,parseTrafficSignalNodes,loadDetourGeometry} from '../dist/detour-routing.js';
import {DIVERSION_LINKS} from '../dist/diversions.js';
import {emptyDetour,advanceDetour,detourVehicles} from '../dist/detour-flow.js';

test('standstill and ramp queues cannot receive unrealistic 65-km/h burst animations',()=>{
 for(let minute=0;minute<=300;minute+=.5){
  const speed=localWaveSpeed(5,minute,'ramp-a48-to-koeln',6,100,'ramp');
  assert.ok(speed>=0&&speed<=23,'ramp burst '+speed);
  const motorway=localWaveSpeed(5,minute,'crash',12,120);
  assert.ok(motorway>=0&&motorway<=23,'motorway burst '+motorway);
  assert.ok(localWaveSpeed(0,minute,'closure',12,120)===0,'a closure stays stopped');
 }
 assert.equal(localWaveSpeed(7,123,'jam',.25,120),7,'short or absent queue is not artificially shaken');
});
test('deep congestion stays largely dark red with occasional modest local start-ups',()=>{
 const bandsAt=(minute)=>stopAndGoBands({id:'event-a',pathKey:'A3-koeln',
  anchorM:14000,queueM:8000,speedKmh:5},minute);
 let dark=0,red=0,orange=0;
 for(let minute=70;minute<220;minute++){
  const band=bandsAt(minute).find(b=>b.fromM<=13920&&b.toM>=13920);
  if(!band)continue;
  if(band.color==='standstill')dark++;
  if(band.color==='jam')red++;
  if(band.color==='slow')orange++;
 }
 assert.ok(dark>95,'most minutes should be creeping or stopped: '+dark);
 assert.ok(red>0,'occasional realistic small movement should exist');
 assert.equal(orange,0,'no orange sudden surges in a 5-km/h core');
});
test('waiting intervals are variable and longer than old continuously oscillating pulses',()=>{
 const e=waveEpisodes('event-a',800);
 assert.ok(e.length>12);
 assert.ok(e.some(x=>x.stopGapMin>25));
 assert.ok(e.some(x=>x.stopGapMin<16));
 assert.ok(e.every(x=>x.flowMin<5&&x.riseMin<5));
});
test('traffic labels avoid markers, controls and legend, and omit cluttered areas',()=>{
 const crowded=[{x:80,y:80,width:90,height:50}];
 const a=placeJamCallout({x:210,y:285},165,33,{width:400,height:500},crowded);
 assert.ok(a,'there is enough free space');
 assert.equal(crowded.some(b=>intersectsLabel(a,b,7)),false);
 assert.ok(a.x>=7&&a.y>=115);
 assert.ok(a.y+a.height<500-116);
 const blockers=[{x:0,y:0,width:400,height:500}];
 assert.equal(placeJamCallout({x:210,y:285},165,33,{width:400,height:500},blockers),null);
 const src=readFileSync('src/app.ts','utf8');
 assert.match(src,/placeJamCallout\(/);
 assert.match(src,/\.\.\.badges\.map/);
});
const w=(id,nodes,coords,extra={})=>({id,nodes,geometry:coords.map(([lat,lon])=>({lat,lon})),tags:{highway:'secondary',...extra}});
const p0=[50.4,7.6],p1=[50.4,7.61],p2=[50.405,7.61],p3=[50.41,7.61],side=[50.402,7.611];
const ways=[w(1,[1,2],[p0,p1]),w(2,[2,3],[p1,p2]),w(3,[3,4],[p2,p3]),w(4,[2,5],[p1,side])];
test('only OSM topology and tagged signals count, never invent intersections',()=>{
 const signals=parseTrafficSignalNodes({elements:[
  {type:'node',id:2,tags:{highway:'traffic_signals'}},
  {type:'node',id:3,tags:{highway:'give_way'}},
  {type:'way',id:200,tags:{highway:'traffic_signals'}}
 ]});
 assert.deepEqual([...signals],[2]);
 const route=shortestOSMRoute(graphFromWays(ways,signals),p0,p3,50);
 assert.ok(route);
 assert.equal(route.junctionCount,1,'the spur touches node 2');
 assert.equal(route.trafficLightCount,1,'node 2 explicitly signalled');
 const clean=shortestOSMRoute(graphFromWays(ways.slice(0,3)),p0,p3,50);
 assert.equal(clean.junctionCount,0);
 assert.equal(clean.trafficLightCount,0);
});
test('real mapped junctions lower predicted detour capacity and add plausible delay',async()=>{
 const link=DIVERSION_LINKS.find(x=>x.code==='U3');
 const exit=(ref,position)=>({ref,position,road:'A3',name:'Testexit'});
 let payload={elements:ways.map(w=>({type:'way',...w}))};
 const fetcher=async()=>({ok:true,json:async()=>payload});
 const baseline=await loadDetourGeometry(link,exit('40',p0),exit('38',p3),fetcher);
 assert.equal(baseline.junctionCount,1);
 payload={elements:[...ways.map(w=>({type:'way',...w})),
  {type:'node',id:2,tags:{highway:'traffic_signals'}}]};
 const withLight=await loadDetourGeometry(link,exit('40',p0),exit('38',p3),fetcher);
 assert.equal(withLight.trafficLightCount,1);
 assert.ok(withLight.roadCapacityVph<baseline.roadCapacityVph);
 assert.ok(withLight.freeMinutes>baseline.freeMinutes);
});
test('merging queue is separate from road intersection queue and still conserved',()=>{
 const geometry={id:'x',path:'A3-koeln',sourceExitRef:'40',targetExitRef:'38',
  lengthKm:2,freeMinutes:2,roadCapacityVph:650,junctionCount:3,trafficLightCount:1,
  points:[p0,p1,p2],source:'osm-routed-infill',relationId:null,label:'Test'};
 const cfg={id:'x',path:'A3-koeln',fromM:2000,toM:9000,eventId:'e',geometry};
 let state=emptyDetour(cfg);
 for(let t=0;t<20;t++){
  const moved=advanceDetour(state,cfg,t,2800,35,0);
  state=moved.state;
  assert.equal(moved.rejoined,0);
  assert.ok(state.waitingRoad>=0&&state.waitingMerge>=0);
  assert.ok(Math.abs(state.admittedTotal-state.returnedTotal-detourVehicles(state))<1e-5);
 }
 assert.ok(state.waitingMerge>0,'re-entry queue must form when blocked');
 for(let t=20;t<140;t++)state=advanceDetour(state,cfg,t,0,0,3000).state;
 assert.ok(detourVehicles(state)<1);
 assert.ok(Math.abs(state.admittedTotal-state.returnedTotal)<1e-5);
});
