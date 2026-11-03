import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {extensionRoutes,extensionJunctions} from '../dist/network-extensions.js';
import {buildExtensionConnections} from '../dist/extension-connections.js';
import {makeCorridors} from '../dist/spatial.js';
import {eventFromHit,validEvent} from '../dist/events.js';
import {networkRoad} from '../dist/network-road.js';
import {MOTORWAY_GROUPS} from '../dist/network-presentation.js';
import {initialiseCells,advanceCells,assertCellConservation} from '../dist/traffic-cells.js';

const lookup=id=>extensionRoutes.find(r=>r.id===id);
const ids=['extra-a555-bonn','extra-a555-koeln','extra-a565-siegburg','extra-a565-koblenz'];
const routes=makeCorridors(networkData.roads,networkData.ramps);

test('A555 both directions reach Bonn-Nord from AK Köln-Süd on OSM nodes',()=>{
 for(const id of ids.slice(0,2)){
  const r=lookup(id);assert.ok(r,id);
  const length=r.laneSegments.at(-1).toM;
  assert.ok(length>14000&&length<26000,id+' length '+length);
  assert.ok(r.points.length>90,id);
  assert.ok(r.wayIds.length>=20,id);
  assert.equal(networkRoad(id),'A555');
 }
});
test('A565 both directional mainlines exist between Bonn-Nord and Bonn-Nordost',()=>{
 for(const id of ids.slice(2)){
  const r=lookup(id);assert.ok(r,id);
  const length=r.laneSegments.at(-1).toM;
  assert.ok(length>3500&&length<8500,id+' length '+length);
  assert.ok(r.wayIds.length>=5,id);
  assert.equal(networkRoad(id),'A565');
 }
 assert.ok(MOTORWAY_GROUPS.find(x=>x.road==='A565').paths.length>=2);
});
test('A555 and A565 numbered junctions have directional OSM anchors',()=>{
 for(const [road,refs] of [['A555',['3','4','5','6','7']],['A565',['1','2','3','4']]]){
  for(const ref of refs){
   const j=extensionJunctions.find(e=>e.road===road&&e.ref===ref);
   assert.ok(j,road+' AS '+ref);
   const pathIds=road==='A555'?ids.slice(0,2):ids.slice(2);
   for(const id of pathIds){
    const anchor=j.directional?.[id]?.position;
    assert.ok(anchor,road+' '+ref+': direction '+id);
    assert.ok(lookup(id).points.some(p=>p[0]===anchor[0]&&p[1]===anchor[1]),road+' '+ref+' non-OSM anchor '+id);
   }
  }
 }
});
test('all new mainlines can host incidents and closures at multiple locations',()=>{
 for(const id of ids){
  const feature=lookup(id);
  for(const fraction of [.2,.5,.8]){
   const point=feature.points[Math.floor((feature.points.length-1)*fraction)];
   const hit={kind:'extension',feature,key:id,point,distance:0,fraction};
   const event=eventFromHit(hit,'accident',feature.lanes,[0],'new-'+id+'-'+fraction,'2026-11-04T06:00:00Z',
    {lengthM:100,speedKmh:feature.lanes>1?40:0,shoulder:'normal'});
   assert.ok(validEvent(event),'No incident placement '+id);
  }
 }
});
test('Bonn junction connectors are actual physical, directed ramp paths',()=>{
 const connections=buildExtensionConnections(routes);
 for(const node of ['A555','A565','A59']){
  const entries=connections.filter(c=>networkRoad(c.from)===node||networkRoad(c.to)===node);
  assert.ok(entries.length>=2,node+' is isolated from other motorway connectors');
 }
 const physical=connections.filter(c=>c.from!==c.rampId&&c.to!==c.rampId&&
  ((networkRoad(c.from)==='A555'&&networkRoad(c.to)==='A565')||
   (networkRoad(c.from)==='A565'&&networkRoad(c.to)==='A555')||
   (networkRoad(c.from)==='A565'&&networkRoad(c.to)==='A59')||
   (networkRoad(c.from)==='A59'&&networkRoad(c.to)==='A565')));
 assert.ok(physical.length>=3,'Cross-motorway directed transfers missing: '+JSON.stringify(physical));
 for(const c of physical){
  assert.ok(routes[c.rampId].lengthM>35,c.rampId);
  assert.ok(c.rampEntryM>=0&&c.downstreamMergeM>=0,c.rampId);
 }
});
test('A555 and A565 congestion cells conserve vehicles through incident and reopened states',()=>{
 for(const id of ids){
  const route=routes[id],f=lookup(id),i=Math.floor(f.points.length*.55);
  const event={id:'test-'+id,pathKey:id,kind:'roadworks',
   point:f.points[i],laneCount:f.lanes,closedLanes:[0],
   createdAt:'2026-11-04T00:00:00Z',
   settings:{lengthM:200,speedKmh:f.lanes>1?40:0,shoulder:'normal'}};
  let state=initialiseCells(route,1250);
  for(let minute=0;minute<10;minute++){
   state=advanceCells(state,route,minute<6?[event]:[],1250);
   assertCellConservation(state);
  }
 }
});
