import test from 'node:test';
import assert from 'node:assert/strict';
import {extensionRoutes,extensionJunctions} from '../dist/network-extensions.js';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,closureGate,routeSlice,positionM} from '../dist/spatial.js';
import {buildExtensionConnections} from '../dist/extension-connections.js';
import {extensionDetours,planExtensionDetours,refreshExtensionDetour,extensionDetourConfig} from '../dist/extension-detours.js';
import {defaultDemands} from '../dist/traffic.js';
import {initialiseCells,cellInventory} from '../dist/traffic-cells.js';
import {advanceRoutedNetwork,remainingInterchangeDemands} from '../dist/routed-traffic.js';
import {emptyDetour,detourVehicles} from '../dist/detour-flow.js';
import {normalJunctionTraffic} from '../dist/junction-traffic.js';
import {diversionJunctions} from '../dist/diversions.js';
import {readFileSync} from 'node:fs';
const routes=makeCorridors(networkData.roads,networkData.ramps),exits=[...networkData.exits,...extensionJunctions],links=buildExtensionConnections(routes),demands=defaultDemands();
const mainKeys=['A3-koeln','A3-frankfurt','A48-dernbach','A48-koblenz',...extensionRoutes.filter(r=>r.kind==='motorway').map(r=>r.id)];
const initialise=()=>Object.fromEntries(mainKeys.map(k=>[k,initialiseCells(routes[k],demands[k])]));
function closure(key,metre,length=1500){const count=extensionRoutes.find(r=>r.id===key)?.lanes??3;return {id:'closure-'+key,pathKey:key,kind:'closure',point:routeSlice(routes[key],metre,metre+2)[0],laneCount:count,closedLanes:Array.from({length:count},(_,i)=>i),settings:{lengthM:length,speedKmh:0,shoulder:'blocked'},createdAt:'2026-11-01T08:00:00Z'};}
test('A59 31–43 and A560 1–7 have actual directional anchors including entry-only Rath',()=>{
 for(const [road,refs] of [['A59',['31','32','33','34','35','36','37','38','39','40','41','42','43']],['A560',['1','2','3','4','5','6','7']]]){
  assert.deepEqual(extensionJunctions.filter(j=>j.road===road).map(j=>j.ref).sort(),refs.sort());
  for(const j of extensionJunctions.filter(j=>j.road===road))for(const [key,d] of Object.entries(j.directional))assert.notEqual(positionM(routes[key],d.position,1),null,j.name+' '+key);
 }
 const rath=extensionJunctions.find(j=>j.road==='A59'&&j.ref==='32');assert.equal(rath.access['extra-a59-koeln'].exit,false);
 assert.equal(normalJunctionTraffic(routes['extra-a59-koeln'],exits,1400).find(j=>j.ref==='32').exitPercent,0);
 for(const key of ['extra-a560-hennef','extra-a560-bonn'])assert.equal(extensionRoutes.find(r=>r.id===key).lanes,2);
});
test('all four Sankt Augustin turns and the real Heumar mainline connection are retained',()=>{
 for(const [from,to] of [['extra-a59-koeln','extra-a560-hennef'],['extra-a59-bonn','extra-a560-hennef'],['extra-a560-bonn','extra-a59-koeln'],['extra-a560-bonn','extra-a59-bonn']])assert.ok(links.some(l=>l.from===from&&l.to===to),from+' > '+to);
 for(const [key,point] of [['extra-a59-koeln',routes['extra-a59-koeln'].points.at(-1)],['extra-a59-bonn',routes['extra-a59-bonn'].points[0]]])assert.ok(['A3-koeln','A3-frankfurt'].some(k=>positionM(routes[k],point,1)!==null),key);
});
test('all regular A59/A560 exits have a connected local departure and all alternatives follow directed OSM edges',()=>{
 for(const key of mainKeys.filter(k=>k.startsWith('extra-'))){
  for(const j of diversionJunctions(key,exits,routes[key]).filter(j=>!j.isInterchange&&j.access?.[key]?.exit!==false))assert.ok(extensionDetours.some(r=>r.path===key&&r.fromRef===j.ref),key+' exit '+j.ref);
 }
 const sources=['a3-heumar-camberg-osm.json','a59-a560-osm.json','cologne-triangle-osm.json','bonn-a59-a562-osm.json','a4-koeln-sued-osm.json','a4-koeln-west-osm.json','a555-a565-bonn-osm.json'].flatMap(f=>JSON.parse(readFileSync(new URL('../data/'+f,import.meta.url))).elements);
 const ways=new Map(sources.filter(e=>e.type==='way').map(w=>[w.id,w])),edge=new Set();
 const point=p=>[p.lat,p.lon].map(v=>Number(v.toFixed(7))).join(',');
 for(const w of ways.values()){
  const ps=w.geometry?.map(point)??[],t=w.tags??{};if(t.oneway==='-1')ps.reverse();
  const directed=['yes','1','-1'].includes(t.oneway)||['motorway','motorway_link'].includes(t.highway)||t.junction==='roundabout';
  for(let i=1;i<ps.length;i++){edge.add(ps[i-1]+'>'+ps[i]);if(!directed)edge.add(ps[i]+'>'+ps[i-1]);}
 }
 for(const r of extensionDetours){assert.deepEqual(r.points[0],r.fromPoint);for(let i=1;i<r.points.length;i++)assert.ok(edge.has(r.points[i-1].join(',')+'>'+r.points[i].join(',')),r.id+' edge '+i);}
 assert.ok(extensionDetours.some(r=>r.path==='A3-frankfurt'&&r.motorway&&r.legs.some(l=>l.path.startsWith('extra-a59'))));
});
test('A59 closure exits at the correct AS, never returns inside closure and conserves its shared cell/detour ledger',()=>{
 const key='extra-a59-bonn',event=closure(key,12000),gate=closureGate(routes[key],event,exits,[event]);assert.equal(gate.exit.ref,'36');assert.equal(gate.endExit.ref,'38');
 let cells=initialise();const configs=planExtensionDetours([event],routes,exits,cells,links).filter(c=>c.path===key&&c.targetPath===key);
 assert.ok(configs.some(c=>Math.abs(c.fromM-gate.metre)<25));assert.ok(configs.every(c=>c.toM>=gate.endM-1&&!c.exitsNetwork));
 let detours=configs.map(config=>({config,state:emptyDetour(config),enabled:true}));
 const before=Object.values(cells).reduce((n,g)=>n+cellInventory(g),0);
 for(let i=0;i<35;i++){const next=advanceRoutedNetwork(cells,routes,[event],demands,exits,detours);cells=next.cells;detours=next.detours;}
 assert.ok(detours.reduce((n,d)=>n+d.state.admittedTotal,0)>0);
 const after=Object.values(cells).reduce((n,g)=>n+cellInventory(g),0)+detours.reduce((n,d)=>n+detourVehicles(d.state),0);
 const offered=Object.values(cells).reduce((n,g)=>n+g.offeredTotal,0),left=Object.values(cells).reduce((n,g)=>n+g.exitedTotal,0);
 assert.ok(Math.abs(after-before-offered+left)<1e-4);
 const inventory=detours.reduce((n,d)=>n+detourVehicles(d.state),0);
 detours=detours.map(d=>({...d,enabled:false}));for(let i=0;i<40;i++){const next=advanceRoutedNetwork(cells,routes,[],demands,exits,detours);cells=next.cells;detours=next.detours;}
 assert.ok(detours.reduce((n,d)=>n+detourVehicles(d.state),0)<inventory);
});
test('an incident on an alternate motorway disables that route service, and reopening restores it',()=>{
 const record=extensionDetours.find(r=>r.path==='A3-frankfurt'&&r.motorway&&r.legs.some(l=>l.path==='extra-a59-bonn'));
 assert.ok(record);const leg=record.legs.find(l=>l.path==='extra-a59-bonn'),route=routes[leg.path],at=positionM(route,leg.fromPoint,1)+100;
 const event=closure(leg.path,at,200);
 const config=extensionDetourConfig(record,'test',routes,[],exits);assert.ok(config.geometry.roadCapacityVph>0);
 assert.equal(refreshExtensionDetour(config,routes,[event],exits,{}).geometry.roadCapacityVph,0);
 assert.ok(refreshExtensionDetour(config,routes,[],exits,{}).geometry.roadCapacityVph>0);
});
test('a closed A560→A3 turn uses a reachable downstream exit without zero-length travel-time errors or duplicate ramp demand',()=>{
 const id='extra-siegburg-A560-bonn-to-A3-koeln',event=closure(id,50,100);
 let cells=initialise();const configs=planExtensionDetours([event],routes,exits,cells,links).filter(c=>c.movementId===id);
 assert.ok(configs.length>0);const link=links.find(l=>l.rampId===id);assert.ok(configs.every(c=>c.fromM>link.rampEntryM));
 let detours=configs.map(config=>({config,state:emptyDetour(config),enabled:true}));
 for(let i=0;i<25;i++){const next=advanceRoutedNetwork(cells,routes,[event],demands,exits,detours);cells=next.cells;detours=next.detours;}
 assert.ok(detours.reduce((n,e)=>n+e.state.admittedTotal,0)>0);
 assert.ok(remainingInterchangeDemands(demands,detours,[event])[id]<demands[id]);
});
