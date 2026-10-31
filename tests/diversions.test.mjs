import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice,emptySpatial,advanceSpatial} from '../dist/spatial.js';
import {defaultDemands} from '../dist/traffic.js';
import {DIVERSION_LINKS,CROSS_MOTORWAY_DIVERSION,diversionJunctions,
 planDiversion,potentialDiversionPercent} from '../dist/diversions.js';

const roads=makeCorridors(networkData.roads,networkData.ramps);
const {exits}=networkData;
const byRef=(path,ref)=>diversionJunctions(path,exits,roads[path]).find(e=>e.ref===ref);
const eventBetween=(path,startRef,endRef,kind='closure')=>{
 const start=byRef(path,startRef),end=byRef(path,endRef);
 assert.ok(start&&end&&end.metre>start.metre, `Expected upstream ordered junctions ${path} ${startRef} -> ${endRef}`);
 const point=routeSlice(roads[path],start.metre+(end.metre-start.metre)*.5,
  start.metre+(end.metre-start.metre)*.5+2)[0];
 assert.ok(point);
 return {id:`div-${path}-${startRef}`,kind,pathKey:path,point,laneCount:path.startsWith('A48')?2:3,
  closedLanes:path.startsWith('A48')?[0,1]:[0,1,2],
  createdAt:'2026-10-21T12:00:00Z',
  settings:{lengthM:200,speedKmh:0,shoulder:'blocked'}};
};
test('all 23 existing A3/A48 junction references remain available in both directions',()=>{
 for(const key of ['A3-koeln','A3-frankfurt']){
  const js=diversionJunctions(key,exits,roads[key]);
  assert.equal(js.length,18,key+' must include Limburg-Süd through Bonn/Siegburg');
  for(const ref of ['43','42','41','40','39','38','37','36','35','34'])
   assert.ok(js.some(x=>x.ref===ref),key+' / '+ref);
 }
 for(const key of ['A48-dernbach','A48-koblenz']){
  const js=diversionJunctions(key,exits,roads[key]);
  assert.equal(js.length,5,key+' includes AK Koblenz, AS Koblenz-Nord, Bendorf, Höhr, AD Dernbach');
  assert.ok(js.some(x=>x.ref==='13'&&x.isInterchange));
  assert.ok(js.some(x=>x.ref==='9'&&x.isInterchange));
  assert.ok(js.every((x,i)=>i===0||x.metre>=js[i-1].metre));
 }
});
test('Limburg-Süd to Limburg-Nord U72 is found before an A3 northbound closure',()=>{
 const e=eventBetween('A3-koeln','43','42');
 const result=planDiversion(e,roads['A3-koeln'],exits,null);
 assert.ok(result);
 assert.equal(result.requiredDiversion,true);
 assert.equal(result.interestPercent,null,'closure is an obligation to hold or divert, not 100% routed');
 assert.equal(result.candidateExits[0].exit.ref,'43');
 assert.equal(result.candidateExits[0].link?.code,'U72');
 assert.equal(result.candidateExits[0].canSimulate,false);
});
test('Montabaur U3 before Dernbach, without treating the interchange as a local exit',()=>{
 const e=eventBetween('A3-koeln','40','39');
 const result=planDiversion(e,roads['A3-koeln'],exits,31);
 assert.ok(result);
 assert.equal(result.candidateExits[0].exit.ref,'40');
 assert.equal(result.candidateExits[0].link?.code,'U3');
 assert.equal(result.requiredDiversion,true);
 assert.ok(result.candidateExits.every(x=>!x.exit.isInterchange));
});
test('Dierdorf U8 and Koblenz-Nord U95 appear in the correct directions',()=>{
 const frankfurt=eventBetween('A3-frankfurt','37','38');
 const f=planDiversion(frankfurt,roads['A3-frankfurt'],exits,72);
 assert.equal(f.candidateExits[0].link?.code,'U8');
 const east=eventBetween('A48-dernbach','10','11');
 const a=planDiversion(east,roads['A48-dernbach'],exits,45);
 assert.equal(a.candidateExits[0].link?.code,'U95');
 assert.ok(a.candidateExits.every(x=>x.link?.code!=='U40'));
 assert.equal(CROSS_MOTORWAY_DIVERSION.fromRoad,'A3');
 assert.equal(CROSS_MOTORWAY_DIVERSION.fromRef,'38');
});
test('partial/unknown road geometries cannot be silently treated as drivable detours',()=>{
 const incomplete=DIVERSION_LINKS.filter(x=>x.evidence==='partial');
 assert.ok(incomplete.some(x=>x.code==='U74'&&x.path==='A3-koeln'));
 assert.ok(incomplete.some(x=>x.code==='U42'&&x.path==='A48-koblenz'));
 assert.ok(incomplete.every(x=>x.description.includes('unvollständig')));
 const complete=DIVERSION_LINKS.filter(x=>x.evidence==='named-endpoints');
 assert.ok(complete.every(x=>x.toRef!==null));
});
test('delay response reaches full diversion at extreme delay, closures remain mandatory',()=>{
 assert.equal(potentialDiversionPercent(0,false),0);
 assert.ok(potentialDiversionPercent(45,false)>potentialDiversionPercent(15,false));
 assert.ok(potentialDiversionPercent(90,false)>potentialDiversionPercent(45,false));
 assert.equal(potentialDiversionPercent(500,false),100);
 assert.equal(potentialDiversionPercent(100,true),null);
 assert.equal(potentialDiversionPercent(null,false),0);
});
test('planning is read-only and never removes A3/A48 vehicles without a route graph',()=>{
 const e=eventBetween('A3-koeln','40','39');
 const demand=defaultDemands(),state=advanceSpatial(emptySpatial(),[e],demand,12,roads);
 const before=JSON.stringify(state);
 const planned=planDiversion(e,roads['A3-koeln'],exits,100);
 assert.ok(planned&&planned.candidateExits.length);
 assert.ok(planned.candidateExits.every(c=>c.canSimulate===false));
 assert.equal(JSON.stringify(state),before);
 const repeat=advanceSpatial(emptySpatial(),[e],demand,12,roads);
 assert.deepEqual(state,repeat,'plan must not touch motorway conservation');
});
test('UI exposes the offline route catalog and keeps activation controls',()=>{
 const html=readFileSync('index.html','utf8'),app=readFileSync('src/app.ts','utf8');
 assert.match(html,/traffic-diversion-plans/);
 assert.match(html,/traffic-diversion-catalog/);
 assert.match(html,/ohne Online-Routenabruf/i);
 assert.match(app,/renderDiversionPlanner\(key,jams,spillbacks\)/);
 assert.match(app,/planDiversion\(event,corridor,exits,traffic\.delayMin\)/);
 assert.match(app,/bundledDetourGeometry\(k,option.path,option.from,option.to,exits\)/);
});
