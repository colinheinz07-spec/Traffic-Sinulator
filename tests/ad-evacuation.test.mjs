import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {buildRampConnections} from '../dist/interchange.js';
import {initialiseCells,advanceCells,cellInventory} from '../dist/traffic-cells.js';
import {defaultDemands} from '../dist/traffic.js';
import {automaticDiversions} from '../dist/auto-diversions.js';
import {diversionJunctions} from '../dist/diversions.js';
import {bundledDetourGeometry,isNetworkDestination} from '../dist/bundled-detours.js';
import {emptyDetour,detourVehicles,detourStorage} from '../dist/detour-flow.js';
import {advanceRoutedNetwork} from '../dist/routed-traffic.js';

const routes=makeCorridors(networkData.roads,networkData.ramps),{exits}=networkData;
const links=buildRampConnections(networkData.ramps,routes),demands=defaultDemands();
const grids=(profile=demands)=>Object.fromEntries(Object.keys(routes).filter(p=>!p.startsWith('ramp-')).map(p=>[p,initialiseCells(routes[p],profile[p])]));
const junction=(p,ref)=>diversionJunctions(p,exits,routes[p]).find(j=>j.ref===ref);
function closure(path,before=false){
 const turn=links.find(l=>l.from===path&&l.to==='A48-koblenz'),next=junction(path,path==='A3-frankfurt'?'40':'38');
 const at=before?turn.rampEntryM-800:(turn.rampEntryM+next.metre)/2;
 return {id:'ad-arm-'+path,kind:'closure',pathKey:path,point:routeSlice(routes[path],at,at+1)[0],laneCount:3,
  closedLanes:[0,1,2],createdAt:'2026-10-29T08:00:00Z',settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}};
}
function prepare(cells,events){return automaticDiversions(events,routes,exits,cells,links).map(o=>{
 const config={id:o.key,path:o.path,targetPath:o.targetPath,fromM:o.from.metre,toM:o.to.metre,eventId:o.event?.id??o.causeId??o.key,
  sourceEndM:o.sourceEndM,targetEntryM:o.targetEntryM,movementId:o.movementId,journey:o.journey,exitsNetwork:isNetworkDestination(o.to),
  geometry:o.geometry??bundledDetourGeometry(o.key,o.path,o.from,o.to,exits)};
 return {config,state:emptyDetour(config)};
});}
function balance(cells,entries){return Object.values(cells).reduce((n,c)=>n+cellInventory(c)+c.exitedTotal-c.offeredTotal,0)+
 entries.reduce((n,e)=>n+detourVehicles(e.state)+(e.state.exitedNetworkTotal??0),0);}
function tagged(grid,token){return grid.cells.reduce((n,c)=>n+(c.routedVehicles?.[token]??0),0)+(grid.routedBacklog?.[token]??0);}

for(const path of ['A3-frankfurt','A3-koeln'])test(`${path}: queued exit traffic cannot freeze the still-open Koblenz branch, including boundary backlog`,()=>{
 let cells=grids();cells[path].backlog=2500;cells[path].offeredTotal+=2500;
 const event=closure(path),turn=links.find(l=>l.from===path&&l.to==='A48-koblenz');
 let entries=prepare(cells,[event]);const route=entries.find(e=>e.config.path===path&&e.config.journey?.kind==='protected');
 const initial=balance(cells,entries);let lateFlow=0;
 for(let minute=0;minute<180;minute++){
  const next=advanceRoutedNetwork(cells,routes,[event],demands,exits,entries);cells=next.cells;entries=next.detours;
  assert.ok(Math.abs(balance(cells,entries)-initial)<1e-5);
  const own=entries.find(e=>e.config.id===route.config.id);
  if(minute>=120)lateFlow+=own.state.lastDeparture;
  const gate=cells[path].junctions.find(j=>Math.abs(j.metre-route.config.journey.gateM)<25);
  assert.equal(gate.lastEntered,0,'a closed mainline entry remains closed');
 }
 assert.ok(lateFlow>demands[turn.rampId]*.8,`the open turn must serve its own traffic instead of only a fraction: ${lateFlow}`);
 assert.ok(lateFlow<demands[turn.rampId]*1.15,'ordinary local trips cannot multiply the configured turn budget');
 assert.ok(entries.find(e=>e.config.id===route.config.id).state.returnedTotal>500);
 assert.ok(cells[path].backlog>0,'the test keeps real external waiting inventory');
});

for(const path of ['A3-frankfurt','A3-koeln'])test(`${path}: trapped cars take A48 and Höhr and complete their re-entry when traffic eases`,()=>{
 const profile={...demands,'A3-koeln':1200,'A3-frankfurt':1200,'A48-dernbach':0,'A48-koblenz':600,
  'ramp-a48-to-frankfurt':0,'ramp-a48-to-koeln':0,'ramp-a3-to-a48-from-koeln':350,'ramp-a3-to-a48-from-frankfurt':350};
 let cells=grids(profile);const event=closure(path),accident={...event,id:'earlier-accident',kind:'accident',settings:{...event.settings,shoulder:'normal'}};
 for(let i=0;i<45;i++)for(const p of Object.keys(cells))
  cells[p]=advanceCells(cells[p],routes[p],[accident],p===path?4100:profile[p],exits);
 let entries=prepare(cells,[event]);const escape=entries.find(e=>e.config.path===path&&e.config.journey?.kind==='evacuation');
 assert.ok(escape);const token=escape.config.journey.token,continuation=entries.find(e=>e.config.journey?.kind==='continuation'&&e.config.journey.token===token);
 assert.equal(escape.config.targetPath,'A48-koblenz');assert.equal(escape.config.geometry.source,'osm-motorway-ramp');
 assert.equal(continuation.config.path,'A48-koblenz');assert.equal(continuation.config.geometry.sourceExitRef,'12');
 assert.equal(continuation.config.targetPath,path);assert.equal(continuation.config.geometry.targetExitRef,path==='A3-frankfurt'?'40':'38');
 const initial=balance(cells,entries);let captured,completed;
 for(let minute=0;minute<420;minute++){
  const events=minute<120?[event]:[];
  // Continuing peak demand can overload the shared local road. After the
  // arm reopens use a quieter period, so completion is physically possible.
  const active=minute<120?profile:Object.fromEntries(Object.entries(profile).map(([k,v])=>[k,Math.round(v*.15)]));
  const next=advanceRoutedNetwork(cells,routes,events,active,exits,entries);cells=next.cells;entries=next.detours;
  assert.ok(Math.abs(balance(cells,entries)-initial)<1e-5);
  const via=entries.find(e=>e.config.id===escape.config.id),last=entries.find(e=>e.config.id===continuation.config.id);
  const assigned=tagged(cells[path],token)+via.state.admittedTotal;
  if(captured===undefined){captured=assigned;assert.ok(captured>400,'start with a substantial already queued cohort');}
  assert.ok(Math.abs(assigned-captured)<1e-5,'only initially trapped cars choose this evacuation; no fresh through traffic is captured');
  const shortRamp=cells['A48-koblenz'].junctions.reduce((n,j)=>n+(j.exitQueue?.detours[continuation.config.id]??0),0);
  assert.ok(Math.abs(via.state.returnedTotal-last.state.admittedTotal-tagged(cells['A48-koblenz'],token)-shortRamp)<1e-5);
  assert.ok(cells[path].cells.filter(c=>c.fromM>escape.config.fromM+300).every(c=>(c.routedVehicles?.[token]??0)<1e-6),
   'an evacuation cohort cannot drive through the closed arm instead of taking the available branch');
  const rampUsers=entries.filter(e=>e.config.journey&&'rampId' in e.config.journey&&e.config.journey.rampId===escape.config.journey.rampId);
  assert.ok(rampUsers.reduce((n,e)=>n+detourVehicles(e.state),0)<=Math.min(...rampUsers.map(e=>detourStorage(e.config)))+1e-5,
   'the same physical motorway ramp cannot acquire duplicate storage');
  completed=last;
 }
 assert.ok(Math.abs(completed.state.returnedTotal-captured)<1e-4,'the old cohort completes Höhr and the intended re-entry after release too: '+
  JSON.stringify({captured,returned:completed.state.returnedTotal,source:tagged(cells[path],token),a48:tagged(cells['A48-koblenz'],token)}));
 assert.ok(tagged(cells[path],token)<1e-5&&tagged(cells['A48-koblenz'],token)<1e-5);
});

for(const path of ['A3-frankfurt','A3-koeln'])test(`${path}: closure before the AD turn uses the local Koblenz bypass and cannot grant an open-branch passage`,()=>{
 const cells=grids(),event=closure(path,true),entries=prepare(cells,[event]);
 assert.ok(!entries.some(e=>e.config.path===path&&['protected','evacuation'].includes(e.config.journey?.kind)));
 const local=entries.find(e=>e.config.path===path&&e.config.targetPath==='A48-koblenz'&&e.config.journey?.kind==='closure-bypass');
 assert.ok(local);assert.equal(local.config.geometry.targetExitRef,'12');
});

test('retired protected motorway journeys admit no new cars and drain their existing ramp stock',()=>{
 let cells=grids(),events=[closure('A3-koeln')];
 let detours=prepare(cells,events);
 const index=detours.findIndex(e=>e.config.journey?.kind==='protected');
 assert.ok(index>=0);
 const config=detours[index].config,token=config.journey.token;
 detours=detours.map(e=>({...e,enabled:false}));
 detours[index].state.waitingRoad=30;
 detours[index].state.admittedTotal=30;
 cells[config.path].cells[0].routedVehicles={[token]:cells[config.path].cells[0].vehicles};
 const before=balance(cells,detours);
 let departures=0;
 for(let t=0;t<12;t++){
  const next=advanceRoutedNetwork(cells,routes,[],demands,exits,detours);
  cells=next.cells;detours=next.detours;
  departures+=detours[index].state.lastDeparture;
 }
 assert.equal(departures,0,'a retained journey cannot keep taking source-road traffic');
 assert.ok(detourVehicles(detours[index].state)<.01,'old ramp inventory still exits');
 assert.equal(tagged(cells[config.path],token),0,'obsolete source intentions are released');
 assert.ok(Math.abs(balance(cells,detours)-before)<1e-5,'vehicles are conserved');
});
