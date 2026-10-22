import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {buildContinuousRoads,lineWidths,along,rampBadges,overlaps,layoutJunctionLabels} from '../dist/cartography.js';
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

test('whole-network mobile map retains all 15 junction markers and readable numbers below zoom 11',()=>{
 const points=networkData.roads.flatMap(r=>r.points),lat=points.map(p=>p[0]),lon=points.map(p=>p[1]);
 const low=[Math.min(...lat),Math.min(...lon)],high=[Math.max(...lat),Math.max(...lon)];
 const center=[(low[0]+high[0])/2,(low[1]+high[1])/2];
 for(const width of [320,370,410,760]){
  const height=557;let zoom=8;
  for(let z=13;z>=8;z-=.08){const a=mercator(low,z),b=mercator(high,z);
   if(Math.abs(a[0]-b[0])<width*.86&&Math.abs(a[1]-b[1])<height*.79){zoom=z;break;}}
  const middle=mercator(center,zoom),project=p=>{const q=mercator(p,zoom);return [width/2+q[0]-middle[0],height/2+q[1]-middle[1]]};
  const obstacles=[{x:10,y:10,w:width-90,h:33},{x:width-55,y:10,w:45,h:95},{x:0,y:height-100,w:width,h:100}];
  const labels=layoutJunctionLabels(networkData.exits,project,{width,height},zoom,t=>t.length*6,obstacles);
  assert.equal(labels.length,15,`missing marker at width ${width}`);
  assert.ok(labels.every(l=>l.box),`missing junction number at width ${width}: ${labels.filter(l=>!l.box).map(l=>l.exit.name)}`);
  for(const label of labels){
   assert.deepEqual(label.point,project(label.exit.position),'the anchor must stay at its real location');
   assert.ok(label.text.includes(label.exit.ref));
   assert.ok(obstacles.every(obstacle=>!overlaps(label.box,obstacle,3)));
   assert.ok(labels.every(other=>!overlaps(label.box,{x:other.point[0]-5,y:other.point[1]-5,w:10,h:10},3)),
    'a label must not cover another junction marker');
  }
  for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++)assert.ok(!overlaps(labels[i].box,labels[j].box,3));
 }
});
test('detailed junction labels use names, and a lack of label room never erases the geographic marker',()=>{
 const exit=networkData.exits.find(e=>e.ref==='38'&&e.road==='A3');
 const full=layoutJunctionLabels([exit],()=>[150,150],{width:380,height:450},13,t=>t.length*6);
 assert.ok(full[0].text.includes('Ransbach-Baumbach'));assert.ok(full[0].box);
 const noRoom=layoutJunctionLabels([exit],()=>[150,150],{width:380,height:450},13,t=>t.length*6,[{x:0,y:0,w:380,h:450}]);
 assert.equal(noRoom.length,1);assert.equal(noRoom[0].box,null);assert.deepEqual(noRoom[0].point,[150,150]);
});
