import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {junctionLabelPosition,layoutJunctionLabels,layoutStreetTerminalMarkers} from '../dist/cartography.js';
import {networkData} from '../dist/geodata.js';
import {extensionJunctions,extensionRoutes,extensionRampBoundaryPoints} from '../dist/network-extensions.js';
import {verifiedOsmAdditionalRoutes,verifiedOsmStreetBoundaries} from '../dist/01_Strassennetz/osm-zusatzrampen.js';

const exits=[...networkData.exits,...extensionJunctions];
const d=(a,b)=>Math.hypot((a[0]-b[0])*111195,(a[1]-b[1])*111195*Math.cos((a[0]+b[0])*Math.PI/360));

test('Köln-Poll map label uses actual directed A4 AS nodes instead of old 700m-off lookup seed',()=>{
 const poll=exits.find(j=>j.road==='A4'&&j.ref==='13');
 assert.ok(poll);
 const actual=junctionLabelPosition(poll);
 const directions=Object.values(poll.directional);
 assert.equal(directions.length,2);
 assert.ok(d(actual,poll.position)>500,'old approximate junction label is far from actual OSM ramps');
 for(const dir of directions)assert.ok(d(actual,dir.position)<150,'map pin must be between real motorway departures');
 const projected=p=>[(p[1]-6.995)*15000,(50.915-p[0])*15000];
 const labels=layoutJunctionLabels([{...poll,position:actual}],projected,{width:500,height:500},14,()=>65);
 assert.equal(labels.length,1);
 assert.deepEqual(labels[0].point,projected(actual));
});
test('Idstein and other labels do not change position when another traffic route is selected',()=>{
 const idstein=exits.find(j=>j.road==='A3'&&j.ref==='45');
 assert.ok(idstein);
 const at=junctionLabelPosition(idstein),dirs=Object.values(idstein.directional);
 assert.ok(dirs.length>=2);
 for(const dir of dirs)assert.ok(d(at,dir.position)<150,'A3 Idstein should be located between actual ramps');
 assert.deepEqual(junctionLabelPosition(idstein),at);
 const app=readFileSync('src/app.ts','utf8');
 assert.match(app,/position:junctionLabelPosition\(e\)/);
 assert.doesNotMatch(app,/position:\(e\.road===networkRoad\(key\)/);
});
test('real local-road termini can be shown without drawing fictional green road extensions',()=>{
 assert.ok(verifiedOsmStreetBoundaries.some(p=>p[0]>50.908&&p[0]<50.912&&p[1]>7.001&&p[1]<7.006),
  'Köln-Poll must retain verified street transitions to L82');
 const project=p=>[(p[1]-6.995)*15000,(50.915-p[0])*15000];
 const markers=layoutStreetTerminalMarkers(extensionRampBoundaryPoints,project,{width:500,height:500},14);
 assert.ok(markers.length>0);
 assert.ok(markers.every(m=>extensionRampBoundaryPoints.some(p=>p[0]===m.point[0]&&p[1]===m.point[1])));
 for(let i=0;i<markers.length;i++)for(let j=i+1;j<markers.length;j++)
  assert.ok(Math.hypot(markers[i].screen[0]-markers[j].screen[0],markers[i].screen[1]-markers[j].screen[1])>=14);
 assert.deepEqual(layoutStreetTerminalMarkers(extensionRampBoundaryPoints,project,{width:500,height:500},12),[]);
});
test('the saved OSM snapshots contain no unimported local motorway_link near Köln-Poll or Idstein',()=>{
 const owned=new Set([...extensionRoutes,...verifiedOsmAdditionalRoutes].flatMap(r=>r.wayIds));
 const regions=[
  ['data/a4-koeln-sued-osm.json',p=>p.lat>50.902&&p.lat<50.914&&p.lon>6.993&&p.lon<7.008,22],
  ['data/a3-wiesbaden-osm.json',p=>p.lat>50.203&&p.lat<50.216&&p.lon>8.245&&p.lon<8.257,17]
 ];
 for(const [file,contains,minWays] of regions){
  const data=JSON.parse(readFileSync(file,'utf8'));
  const ways=data.elements.filter(w=>w.type==='way'&&w.tags?.highway==='motorway_link'&&w.geometry?.some(contains));
  assert.ok(ways.length>=minWays,file+' OSM source unexpectedly lost ramp ways');
  assert.deepEqual(ways.filter(w=>!owned.has(w.id)).map(w=>w.id),[],file+' has missing imported motorway links');
 }
});

test('widely separated motorway departures do not place the pin midway on an unrelated stretch',()=>{
 const montabaur=exits.find(j=>j.road==='A3'&&j.ref==='40');
 assert.ok(montabaur);
 const branches=Object.values(montabaur.directional).filter(a=>a.nodeId>0);
 assert.ok(d(branches[0].position,branches[1].position)>1000);
 const marker=junctionLabelPosition(montabaur);
 assert.ok(branches.some(a=>d(a.position,marker)<1),
  'very wide complexes must use a surveyed vertex rather than an arbitrary midpoint');
});
