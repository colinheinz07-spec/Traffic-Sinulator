import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {exitPosition} from '../dist/core.js';
import {makeCorridors,positionM,routeSlice,closureGate} from '../dist/spatial.js';
import {diversionJunctions} from '../dist/diversions.js';
import {automaticDiversions} from '../dist/auto-diversions.js';
import {bundledExitRoutes,bundledDetourGeometry,isNetworkDestination} from '../dist/bundled-detours.js';
import {initialiseCells,cellInventory,assertCellConservation} from '../dist/traffic-cells.js';
import {advanceRoutedPath} from '../dist/routed-traffic.js';
import {emptyDetour,detourVehicles} from '../dist/detour-flow.js';

const routes=makeCorridors(networkData.roads,networkData.ramps),{exits}=networkData;
for(const path of ['A3-koeln','A3-frankfurt'])test(`${path}: exact OSM carriageway reaches past Bonn/Siegburg and includes both new directional exits`,()=>{
 const route=routes[path],audit=networkData.audit.northExtension;
 assert.ok(route.lengthM>120000&&route.lengthM<130000);
 assert.ok(audit.lengthsKm[path]>16000/1000&&audit.lengthsKm[path]<17);
 const nodes=diversionJunctions(path,exits,route);
 for(const ref of ['32','33']){
  const j=nodes.find(x=>x.ref===ref),raw=exits.find(e=>e.road==='A3'&&e.ref===ref);
  assert.ok(j&&raw.directional[path].nodeId>0);
  assert.notEqual(positionM(route,exitPosition(raw,path),.2),null);
 }
 const refs=nodes.map(x=>x.ref).filter(ref=>!['28','29','30a','30b','31','44'].includes(ref));
 assert.deepEqual(refs,path==='A3-koeln'?
  ['43','42','41','40','39','38','37','36','35','34','33','32']:
  ['32','33','34','35','36','37','38','39','40','41','42','43']);
 const choice=bundledExitRoutes(path,exits,route).find(c=>c.from.ref==='33');
 assert.ok(choice&&choice.to.metre>choice.from.metre);
 assert.equal(choice.geometry.source,'simulated-bundled');
 assert.equal(isNetworkDestination(choice.to),false);
});
for(const path of ['A3-koeln','A3-frankfurt'])test(`${path}: a full closure in the new section uses AS Siebengebirge and closes its entry`,()=>{
 const route=routes[path],js=diversionJunctions(path,exits,route),from=js.find(j=>j.ref==='33');
 const to=js.find(j=>j.ref===(path==='A3-koeln'?'32':'34')),at=(from.metre+to.metre)/2;
 const event={id:'north-closure',kind:'closure',pathKey:path,laneCount:3,closedLanes:[0,1,2],
  point:routeSlice(route,at,at+1)[0],createdAt:'2026-10-25T12:00:00Z',settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}};
 assert.equal(closureGate(route,event,exits).exit.ref,'33');
 let entries=automaticDiversions([event],routes,exits,{}).map(p=>{
  const config={id:p.key,path,fromM:p.from.metre,toM:p.to.metre,eventId:event.id,exitsNetwork:isNetworkDestination(p.to),
   geometry:bundledDetourGeometry(p.key,path,p.from,p.to,exits)};
  return {config,state:emptyDetour(config)};
 });
 let state=initialiseCells(route,1800);const initial=cellInventory(state);
 for(let i=0;i<90;i++){
  const result=advanceRoutedPath(state,route,[event],1800,exits,entries);
  state=result.cells;entries=result.detours;assertCellConservation(state);
  const local=state.junctions.find(j=>j.ref==='33');
  assert.equal(local.lastEntered,0);
  const side=entries.reduce((n,e)=>n+detourVehicles(e.state)+(e.state.exitedNetworkTotal??0),0);
  assert.ok(Math.abs(cellInventory(state)+state.exitedTotal+side-initial-state.offeredTotal)<1e-5);
 }
 const used=entries.find(e=>e.config.geometry.sourceExitRef==='33');
 assert.equal(used.desiredPercent,100);assert.ok(used.state.admittedTotal>100);
 assert.ok(used.state.returnedTotal>0,'vehicles must rejoin beyond the closed section, now inside the enlarged network');
});
test('SPCK contains the northern map data and both navigation targets without an online routing dependency',()=>{
 const html=readFileSync('index.html','utf8');
 for(const id of ['siebengebirge','bonn-siegburg'])assert.ok(html.includes('id="'+id+'"'));
 assert.ok(html.includes('34 sofort verfügbare Abfahrtsmöglichkeiten'));
 const source=JSON.parse(readFileSync('data/a3-north-osm.json','utf8'));
 assert.ok(source.elements.some(e=>e.type==='node'&&e.tags?.ref==='33'));
 assert.ok(source.elements.some(e=>e.type==='node'&&e.tags?.ref==='32'));
});
