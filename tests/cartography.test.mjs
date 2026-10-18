import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {buildContinuousRoads,lineWidths,along,rampBadges,overlaps} from '../dist/cartography.js';
import {DIRECTIONS,mercator} from '../dist/core.js';

test('every OSM way appears exactly once in connected paths; no synthetic roads',()=>{
 const merged=buildContinuousRoads(networkData.roads);
 const actual=merged.flatMap(m=>m.wayIds).sort((a,b)=>a-b);
 const expected=networkData.roads.map(r=>r.wayId).sort((a,b)=>a-b);
 assert.deepEqual(actual,expected);
 assert.ok(merged.length<networkData.roads.length,'real node joining should reduce pen-lift seams');
 for(const id of DIRECTIONS)assert.ok(merged.some(d=>d.road===id&&d.points.length>=2));
 const keys=new Set(networkData.roads.flatMap(r=>r.points.map(p=>p.join(','))));
 assert.ok(merged.every(route=>route.points.every(p=>keys.has(p.join(',')))), 'merged lines must use only original OSM vertices');
});
test('zoom adaptive line styles preserve fine independent carriageways',()=>{
 const low=lineWidths(9),mid=lineWidths(13),high=lineWidths(16);
 assert.ok(low.motorway<mid.motorway&&mid.motorway<high.motorway);
 assert.ok(mid.motorwayCasing<6.4&&mid.rampCasing<8);
 assert.ok(low.motorway>=1.5);
});
test('ramp badges sit at real points on each of the four OSM routes',()=>{
 const c=mercator([50.460264,7.767549],14.2),project=p=>{const v=mercator(p,14.2);return [190+v[0]-c[0],380+v[1]-c[1]]};
 const badges=rampBadges(networkData.ramps,project,{width:390,height:760});
 assert.equal(badges.length,4);
 for(const b of badges){assert.ok(b.number>0&&b.number<=4);assert.ok(b.bubble[0]>=17);assert.ok(b.bubble[1]<760);}
 assert.equal(new Set(badges.map(b=>b.number)).size,4);
 assert.equal(overlaps({x:10,y:20,w:5,h:5},{x:30,y:40,w:5,h:5}),false);
});

test('all four motorway directions form one continuous real-OSM chain',()=>{
 const audit=networkData.audit.gapRepair;
 assert.ok(audit&&audit.verifiedWays>=80,'verified OSM repair is missing');
 const paths=buildContinuousRoads(networkData.roads);
 assert.equal(paths.length,4,'unexpected breaks in the motorway geometry');
 for(const id of DIRECTIONS){
  const own=paths.filter(p=>p.road===id);
  assert.equal(own.length,1,'remaining OSM path gap in '+id);
  assert.equal(audit.terminalAudit[id].danglingAfter,2,'expected precisely two natural endpoints in '+id);
  assert.ok(own[0].points.length>=150,'path too short '+id);
 }
});
