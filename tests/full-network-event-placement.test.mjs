import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {extensionRoutes} from '../dist/network-extensions.js';
import {roadLaneInfo,rampLaneInfo} from '../dist/lane-info.js';
import {eventFromHit,validEvent} from '../dist/events.js';

const createdAt='2026-11-02T18:00:00Z';
let serial=0;
function check(hit,count,label){
 assert.ok(Number.isInteger(count)&&count>=1&&count<=7,label+': ungültige Fahrstreifenanzahl '+count);
 const lanes=count===1?[0]:[0];
 const speed=count===1?0:40;
 const incident=eventFromHit(hit,'accident',count,lanes,'audit-'+serial++,createdAt,
  {lengthM:100,speedKmh:speed,shoulder:'normal'});
 assert.ok(validEvent(incident),label+': Unfall nicht speicherbar');
 const closure=eventFromHit(hit,'closure',count,lanes,'audit-'+serial++,createdAt,
  {lengthM:200,speedKmh:0,shoulder:'blocked'});
 assert.ok(validEvent(closure),label+': Vollsperrung nicht speicherbar');
}
test('all mapped legacy motorway and ramp sections admit incident and closure events',()=>{
 let examined=0;
 for(const road of networkData.roads){
  const info=roadLaneInfo(road);
  for(const position of [0,Math.floor(road.points.length/2),road.points.length-1]){
   const point=road.points[position];
   check({kind:'road',key:road.road,road,point,distance:0,fraction:position/(road.points.length-1)},
    info.count,road.road+' OSM '+road.wayId);examined++;
  }
 }
 for(const ramp of networkData.ramps){
  for(const position of [0,Math.floor(ramp.points.length/2),ramp.points.length-1]){
   const point=ramp.points[position],info=rampLaneInfo(ramp,point);
   assert.notEqual(info.source,'unknown',ramp.id+' nicht prüfbar');
   check({kind:'ramp',key:ramp.id,ramp,point,distance:0,fraction:position/(ramp.points.length-1)},info.count,ramp.id);
   examined++;
  }
 }
 assert.ok(examined>100);
});
test('every OSM extension path accepts map events at its entrance, centre and exit',()=>{
 let examined=0;
 for(const feature of extensionRoutes){
  assert.ok(feature.points.length>=2,feature.id+' ohne Geometrie');
  const n=feature.points.length-1;
  for(const index of [0,Math.floor(n/2),n]){
   check({kind:'extension',key:feature.id,feature,point:feature.points[index],distance:0,fraction:index/n},
    feature.lanes,feature.name+' ('+feature.id+')');
   examined++;
  }
 }
 assert.ok(examined>100);
});
