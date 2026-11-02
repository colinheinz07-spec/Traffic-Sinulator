import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {extensionRoutes,extensionJunctions} from '../dist/network-extensions.js';
import {networkRoad} from '../dist/network-road.js';
import {makeCorridors,emptySpatial,advanceSpatial} from '../dist/spatial.js';
import {buildExtensionConnections} from '../dist/extension-connections.js';
import {rampReceiving} from '../dist/network-receiving.js';
import {initialiseCells,advanceCells,cellQueueSpans} from '../dist/traffic-cells.js';
import {defaultDemands,baselineCapacity} from '../dist/traffic.js';
const routes=makeCorridors(networkData.roads,networkData.ramps);
const exits=[...networkData.exits,...extensionJunctions];
const get=id=>extensionRoutes.find(f=>f.id===id);
test('A4 both directions pass Köln-Eifeltor, Köln-Klettenberg and reach AK Köln-West on exact OSM segments',()=>{
 const source=JSON.parse(readFileSync('data/a4-koeln-west-osm.json','utf8'));
 const edges=new Set(source.elements.filter(w=>w.type==='way'&&w.tags?.highway==='motorway')
  .flatMap(w=>{const ps=w.geometry.map(p=>[p.lat,p.lon]);if(w.tags.oneway==='-1')ps.reverse();
   return ps.slice(1).map((p,i)=>JSON.stringify([ps[i],p]));}));
 for(const key of ['extra-a4-aachen','extra-a4-olpe']){
  const f=get(key),route=routes[key];assert.ok(f&&route.lengthM>14000);
  assert.ok(f.points.some(p=>p[1]<6.846&&p[0]>50.915),'A4 does not reach AK Köln-West: '+key);
  const western=key.endsWith('aachen')?f.points.slice(-120):f.points.slice(0,120);
  assert.ok(western.slice(1).some((p,i)=>edges.has(JSON.stringify([western[i],p]))),key+' not sourced from western OSM');
 }
 for(const [ref,name] of [['10','AK Köln-West'],['11a','Köln-Klettenberg'],['11b','Köln-Eifeltor']]){
  const j=exits.find(x=>x.road==='A4'&&x.ref===ref);assert.ok(j,ref);
  assert.ok(j.name.includes(name),ref);
  for(const k of ['extra-a4-aachen','extra-a4-olpe'])assert.ok(j.directional[k],ref+' '+k);
 }
});
test('A4 Köln-Klettenberg/Eifeltor labels use real numbered OSM exits and ramps',()=>{
 const osms=JSON.parse(readFileSync('data/a4-koeln-west-osm.json','utf8'));
 const nodes=osms.elements.filter(e=>e.type==='node'&&e.tags?.highway==='motorway_junction');
 const distance=(a,b)=>111195*Math.hypot(a[0]-b[0],(a[1]-b[1])*Math.cos(a[0]*Math.PI/180));
 for(const ref of ['11a','11b']){
  const exit=exits.find(e=>e.road==='A4'&&e.ref===ref);
  assert.ok(exit,'missing numbered exit '+ref);
  const official=nodes.filter(n=>(n.tags.ref||'').split(';').includes(ref)).map(n=>[n.lat,n.lon]);
  assert.ok(official.length>0,'missing OSM exit nodes '+ref);
  assert.ok(Math.min(...official.map(n=>distance(n,exit.position)))<450,'wrong label placement '+ref);
  for(const key of ['extra-a4-aachen','extra-a4-olpe']){
   const pos=exit.directional?.[key]?.position;
   assert.ok(pos,'no directional AS anchor '+key+' '+ref);
   const individually=nodes.filter(n=>n.tags.ref===ref).map(n=>[n.lat,n.lon]);
   assert.ok(individually.length,'missing individually signed motorway exit '+ref);
   assert.ok(Math.min(...individually.map(n=>distance(n,pos)))<430,'incorrect direction label '+key+' '+ref);
  }
  const name=ref==='11a'?'Köln-Klettenberg':'Köln-Eifeltor';
  const ramps=extensionRoutes.filter(x=>x.kind==='ramp'&&x.name.includes(name));
  assert.ok(ramps.length>=2,'missing OSM ramps at '+name);
 }
});

test('motorway lanes receive +100 veh/h, ramp lanes retain their capacity',async()=>{
 const {baseLaneCapacity}=await import('../dist/traffic-physics.js');
 for(const key of ['A3-koeln','A48-koblenz','extra-a4-aachen','extra-a1-dortmund']){
  assert.equal(baseLaneCapacity(key),2100);
 }
 assert.equal(baseLaneCapacity('ramp-a48-to-koeln'),1500);
 const ramp=extensionRoutes.find(x=>x.kind==='ramp'&&x.id.includes('koelnwest'));
 assert.ok(ramp);
 assert.equal(baseLaneCapacity(ramp.id),1500);
 assert.equal(baselineCapacity('A3-koeln'),6300);
 assert.equal(baselineCapacity('A48-koblenz'),4200);
});
test('AS Köln-Klettenberg and AS Köln-Eifeltor have distinct physical directional markers',()=>{
 const exits11=exits.filter(e=>e.road==='A4'&&(e.ref==='11a'||e.ref==='11b'));
 const a=exits11.find(e=>e.ref==='11a'),b=exits11.find(e=>e.ref==='11b');
 const metres=(p,q)=>111195*Math.hypot(p[0]-q[0],(p[1]-q[1])*Math.cos(p[0]*Math.PI/180));
 for(const key of ['extra-a4-aachen','extra-a4-olpe']){
  assert.ok(metres(a.directional[key].position,b.directional[key].position)>450,
   'two physically different motorway exits were pinned to the same fork: '+key);
 }
});

test('undisturbed A4 Richtung Aachen no longer creates a 4-km jam from a single OSM split-bridge lane',()=>{
 const key='extra-a4-aachen',f=get(key),route=routes[key];
 assert.equal(f.laneSegments.filter(s=>s.lanes===1&&s.fromM>10500&&s.fromM<13000).length,0);
 const q=defaultDemands()[key];
 let state=initialiseCells(route,q);
 for(let i=0;i<68;i++)state=advanceCells(state,route,[],q,exits);
 const max=cellQueueSpans(state).reduce((n,s)=>Math.max(n,s.toM-s.fromM),0);
 assert.ok(max<900,'phantom stop-and-go near Eifeltor: '+max+'m');
});

test('Köln-West A1 is available both directions with real connector ramps',()=>{
 for(const key of ['extra-a1-dortmund','extra-a1-koblenz']){
  const f=get(key);assert.ok(f&&f.kind==='motorway'&&routes[key].lengthM>1800);
  assert.equal(networkRoad(key),'A1');assert.ok(f.points.every(p=>p[1]<6.9));
 }
 const j=exits.find(x=>x.road==='A1'&&x.ref==='104');assert.ok(j);
 const turns=extensionRoutes.filter(f=>f.id.startsWith('extra-koelnwest-turn-'));
 assert.ok(turns.length>=2,'no physically linked A1/A4 turns');
 const connected=buildExtensionConnections(routes);
 assert.ok(connected.some(l=>turns.some(t=>t.id===l.rampId)&&l.to!==l.rampId));
});
test('A555 one-lane interchange arm has no self-made multi-kilometre jam in free-flow scenario',()=>{
 const demands=defaultDemands();
 for(const key of ['extra-a555-bonn','extra-a555-koeln']){
  let grid=initialiseCells(routes[key],demands[key]);
  for(let t=0;t<100;t++)grid=advanceCells(grid,routes[key],[],demands[key],exits);
  const segments=cellQueueSpans(grid);
  const long=segments.reduce((m,x)=>Math.max(m,x.toM-x.fromM),0);
  assert.ok(long<700,key+' invented persistent jam of '+long+' metres');
 }
});
test('downstream CTM congestion turns a verified ramp dark, free receiving does not',()=>{
 const links=buildExtensionConnections(routes);
 const l=links.find(x=>x.from==='extra-a59-bonn'&&x.to==='extra-a562-bonn');
 assert.ok(l,'existing exact A59–A562 interchange connection missing');
 const target=initialiseCells(routes[l.to],900);
 const index=Math.min(target.cells.length-1,Math.floor(l.downstreamMergeM/target.cellM));
 const congested=structuredClone(target);
 congested.cells[index].densityVehKm=(congested.cells[index].jamDensityVehKm??390)*.96;
 congested.cells[index].speedKmh=2;
 const free=rampReceiving({[l.to]:target},[l]);
 assert.equal(free[l.rampId],undefined);
 const received=rampReceiving({[l.to]:congested},[l]);
 assert.ok(received[l.rampId]>=0&&received[l.rampId]<900);
 const volume={...defaultDemands(),[l.rampId]:950,[l.to]:3500};
 const jam=advanceSpatial(emptySpatial(),[],volume,6,routes,[l],[],exits,[],[l.rampId],received);
 assert.ok(jam.queues['merge:'+l.rampId]?.vehicles>0,'real constrained merge must store ramp cars');
});
