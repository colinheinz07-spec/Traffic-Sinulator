import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,emptySpatial,advanceSpatial,routeSlice} from '../dist/spatial.js';
import {defaultDemands} from '../dist/traffic.js';
import {DIVERSION_LINKS} from '../dist/diversions.js';
import {validCarWay,graphFromWays,shortestOSMRoute,relationQuery,bboxQuery,
 parseOSMWays,loadDetourGeometry,OFFICIAL_OSM_RELATION_IDS} from '../dist/detour-routing.js';
import {emptyDetour,advanceDetour,detourVehicles} from '../dist/detour-flow.js';

const way=(id,nodes,geometry,highway='secondary',other={})=>({
 id,nodes,geometry:geometry.map(([lat,lon])=>({lat,lon})),tags:{highway,...other}
});
const p0=[50.400,7.600],p1=[50.400,7.610],p2=[50.405,7.610],p3=[50.410,7.610];
const fixture=[
 way(1,[1,2],[p0,p1]),
 way(2,[2,3],[p1,p2]),
 way(3,[3,4],[p2,p3])
];
const fakeLink=DIVERSION_LINKS.find(x=>x.code==='U3'&&x.path==='A3-koeln');
const fakeExit=(ref,point)=>({road:'A3',ref,name:'Example',position:point,source:'test'});
const geo={id:'mock',path:'A3-koeln',sourceExitRef:'40',targetExitRef:'38',
 points:[p0,p1,p2,p3],lengthKm:5,freeMinutes:6,roadCapacityVph:700,
 source:'osm-routed-infill',relationId:null,label:'Simulierte OSM-Verbindung'};
const config={id:'mock',eventId:'works',path:'A3-koeln',fromM:5000,toM:11000,geometry:geo};

test('routing is based on connected OSM nodes and never fabricated straight roads',()=>{
 const result=shortestOSMRoute(graphFromWays(fixture),p0,p3,100);
 assert.ok(result&&result.points.length===4);
 assert.ok(result.lengthM>1600);
 assert.deepEqual(result.points[1],p1);
 const broken=graphFromWays([fixture[0],way(4,[8,9],[p2,p3])]);
 assert.equal(shortestOSMRoute(broken,p0,p3,100),null);
});
test('one-way restrictions and non-motorway road filters are enforced',()=>{
 const oneWay=[way(1,[1,2],[p0,p1],'secondary',{oneway:'yes'}),
  way(2,[2,3],[p1,p2],'secondary',{oneway:'yes'})];
 assert.ok(shortestOSMRoute(graphFromWays(oneWay),p0,p2,100));
 assert.equal(shortestOSMRoute(graphFromWays(oneWay),p2,p0,100),null);
 assert.equal(validCarWay(way(8,[6,7],[p0,p1],'motorway')),false);
 assert.equal(validCarWay(way(9,[6,7],[p0,p1],'residential',{access:'private'})),false);
});
test('official OSM relation identifiers are associated with the correct motorway',()=>{
 assert.equal(OFFICIAL_OSM_RELATION_IDS['A3-koeln-U3'],398045);
 assert.equal(OFFICIAL_OSM_RELATION_IDS['A3-koeln-U72'],186925);
 assert.equal(OFFICIAL_OSM_RELATION_IDS['A48-dernbach-U95'],6806117);
 assert.match(relationQuery(398045),/relation\(398045\);way\(r\);out body geom/);
 assert.match(bboxQuery(p0,p3),/\["highway"~/);
});
test('route loader prioritizes official OSM relation geometry',async()=>{
 const body={elements:fixture.map(w=>({type:'way',...w}))};
 let calls=[];
 const fetcher=async(url,options)=>{
  calls.push(options.body);
  return {ok:true,json:async()=>body};
 };
 const result=await loadDetourGeometry(fakeLink,fakeExit('40',p0),fakeExit('38',p3),fetcher);
 assert.equal(calls.length,1);
 assert.equal(result.source,'osm-official-relation');
 assert.equal(result.relationId,398045);
 assert.deepEqual(result.points[0],p0);
});
test('incomplete official relation falls back to real mapped roads, not direct coordinates',async()=>{
 let calls=[];
 const fetcher=async(url,options)=>{
  calls.push(options.body);
  const payload=calls.length===1?{elements:[{type:'way',...fixture[0]}]}:
    {elements:fixture.map(w=>({type:'way',...w}))};
  return {ok:true,json:async()=>payload};
 };
 const result=await loadDetourGeometry(fakeLink,fakeExit('40',p0),fakeExit('38',p3),fetcher);
 assert.equal(result.source,'osm-routed-infill');
 assert.equal(result.relationId,null);
 assert.equal(calls.length,2);
 assert.ok(result.points.length>2);
});
test('no mapped continuous route means failure and no activation',async()=>{
 const fetcher=async()=>({ok:true,json:async()=>({elements:[{type:'way',...fixture[0]}]})});
 await assert.rejects(loadDetourGeometry(fakeLink,fakeExit('40',p0),fakeExit('38',p3),fetcher),
  /nicht durchgehend verbunden/);
});
test('local traffic is exactly conserved even as queue grows, delays and then empties',()=>{
 let state=emptyDetour(config),peak=0;
 for(let t=0;t<160;t++){
  const flow=advanceDetour(state,config,t,4200,t<40?35:0,1300);
  state=flow.state;
  peak=Math.max(peak,state.waitingRoad);
  assert.ok(Math.abs(state.admittedTotal-state.returnedTotal-detourVehicles(state))<1e-5);
  assert.ok(state.waitingRoad>=0);
 }
 assert.ok(peak>30,'limited local network must experience real congestion');
 assert.ok(state.admittedTotal+1e-5>=state.returnedTotal);
 for(let t=160;t<330;t++)state=advanceDetour(state,config,t,0,0,3000).state;
 assert.ok(detourVehicles(state)<1,'side-road vehicles should eventually rejoin the motorway');
 assert.ok(Math.abs(state.admittedTotal-state.returnedTotal)<1e-5);
});
test('detour exit is subtracted exactly once from motorway incident arrivals',()=>{
 const roads=makeCorridors(networkData.roads,networkData.ramps),route=roads['A3-koeln'];
 const fromM=route.lengthM*.25,toM=route.lengthM*.80;
 const pos=routeSlice(route,route.lengthM*.54,route.lengthM*.54+2)[0];
 const event={id:'closed',kind:'closure',pathKey:'A3-koeln',point:pos,closedLanes:[0,1,2],
  laneCount:3,createdAt:'2026-10-21T08:00:00Z',settings:{lengthM:200,speedKmh:0,shoulder:'blocked'}};
 const demands=defaultDemands(),base=advanceSpatial(emptySpatial(),[event],demands,10,roads);
 let state=emptySpatial();
 for(let i=0;i<10;i++){
  state=advanceSpatial(state,[event],demands,1,roads,[],
   [{id:'test',path:'A3-koeln',fromM,toM,leaveVpm:5,joinVpm:0}]);
 }
 assert.ok(Math.abs((base.queues.closed.vehicles-state.queues.closed.vehicles)-50)<.001);
 assert.ok(state.queues.closed.vehicles>0);
});
test('an arriving local-road platoon rejoins AFTER an incident',()=>{
 const roads=makeCorridors(networkData.roads,networkData.ramps),route=roads['A3-koeln'];
 const fromM=route.lengthM*.25,toM=route.lengthM*.80;
 const pos=routeSlice(route,route.lengthM*.54,route.lengthM*.54+2)[0];
 const incident={id:'works',kind:'roadworks',pathKey:'A3-koeln',point:pos,closedLanes:[0,1],
  laneCount:3,createdAt:'2026-10-21T08:00:00Z',settings:{lengthM:500,speedKmh:40,shoulder:'normal'}};
 const demand=defaultDemands();
 const without=advanceSpatial(emptySpatial(),[incident],demand,1,roads);
 const withTraffic=advanceSpatial(emptySpatial(),[incident],demand,1,roads,[],
  [{id:'test',path:'A3-koeln',fromM,toM,leaveVpm:4,joinVpm:3}]);
 assert.ok(withTraffic.queues.works.vehicles<without.queues.works.vehicles);
});
test('SPCK uses bundled routes automatically and keeps manual controls',()=>{
 const page=readFileSync('index.html','utf8'),app=readFileSync('src/app.ts','utf8');
 assert.match(page,/TRAFFIC 1\.9\.0/);
 assert.match(page,/ohne Online-Routenabruf/);
 assert.match(app,/bundledDetourGeometry\(k,option.path,option.from,option.to,exits\)/);
 assert.match(app,/advanceSpatial\(spatialState,timeline,active,1,spatialCorridors,rampConnections,transfers,exits(?:,physicalMainline)?\)/);
 assert.match(app,/Umleitung aktivieren/);
});
