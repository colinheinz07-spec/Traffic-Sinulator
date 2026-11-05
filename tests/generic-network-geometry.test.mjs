import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContinuousRoads} from '../dist/cartography.js';
import {closestJunction} from '../dist/selection.js';
import {motorwayRef,createRouteCatalog,validateRouteCatalog} from '../dist/network-catalog.js';
import {makeCorridors} from '../dist/spatial.js';
import {normalThroughLanes} from '../dist/lane-info.js';

/** A new A61 must not require edits in drawing, hit testing or core physics. */
function way(id,road,points){
 return {id:road+'-'+id,wayId:id,road,lanes:2,km:1,posKm:id,
  points,tags:{ref:'A 61',lanes:'2'}};
}
test('new autobahn carriageways are stitched independently and retain OSM vertices',()=>{
 const north=[way(200,'A61-nord',[[50,7],[50.001,7]]),
  way(201,'A61-nord',[[50.001,7],[50.002,7]])];
 const south=[way(202,'A61-sued',[[50.0021,7.0002],[50.0011,7.0002]]),
  way(203,'A61-sued',[[50.0011,7.0002],[50.0001,7.0002]])];
 const drawings=buildContinuousRoads([north[1],south[1],north[0],south[0]]);
 assert.equal(drawings.length,2);
 assert.deepEqual(new Set(drawings.map(r=>r.road)),new Set(['A61-nord','A61-sued']));
 assert.equal(drawings.find(r=>r.road==='A61-nord').points.length,3);
 assert.equal(drawings.find(r=>r.road==='A61-sued').points.length,3);
 assert.deepEqual(drawings.flatMap(r=>r.wayIds).sort((a,b)=>a-b),[200,201,202,203]);
 const catalog=createRouteCatalog({roads:[...north,...south],ramps:[]},[]);
 assert.deepEqual(validateRouteCatalog(catalog),[]);
 assert.deepEqual(catalog.map(c=>c.key).sort(),['A61-nord','A61-sued']);
 assert.ok(catalog.every(c=>c.motorway==='A61'&&c.kind==='motorway'&&c.lanes===2));
 const corridors=makeCorridors([...north,...south],[]);
 for(const key of ['A61-nord','A61-sued']){
  assert.equal(corridors[key].points.length,3,'the new road must be usable by the shared flow solver');
  assert.ok(corridors[key].lengthM>200);
 }
});
test('nearest exit on an unregistered future A61 road uses the OSM motorway reference',()=>{
 const road=way(210,'A61-nord',[[50,7],[50.005,7]]);
 const candidate={kind:'road',key:road.road,road,point:[50.002,7],distance:1,fraction:.4};
 const exits=[
  {road:'A3',ref:'1',name:'A3 test',position:[50.002,7],source:'fixture'},
  {road:'A61',ref:'22',name:'A61 nearby',position:[50.0023,7.0004],source:'fixture'}
 ];
 assert.equal(closestJunction(candidate,exits)?.exit.ref,'22');
 assert.equal(motorwayRef('A 61'),'A61');
});

test('four-lane imported motorways keep four through lanes, while old A3 calibration remains',()=>{
 const future=way(600,'A61-nord',[[50,7],[50.002,7]]);
 future.lanes=4;future.tags.lanes='4';
 assert.equal(normalThroughLanes(future),4);
 assert.equal(createRouteCatalog({roads:[future],ramps:[]},[])[0].lanes,4);
 const a3={...future,road:'A3-frankfurt'};
 assert.equal(normalThroughLanes(a3),3);
});
