import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice,closureGate,emptySpatial,advanceSpatial,jamsAt} from '../dist/spatial.js';
import {buildRampConnections} from '../dist/interchange.js';
import {diversionJunctions} from '../dist/diversions.js';
import {initialiseCells,advanceCells,cellInventory,assertCellConservation} from '../dist/traffic-cells.js';
import {defaultDemands,eventCapacity} from '../dist/traffic.js';
import {flowPolicy,validEvent,decodeEvents} from '../dist/events.js';
import {roadSections,physicalEvents,junctionAccess} from '../dist/road-controls.js';
import {automaticDiversions} from '../dist/auto-diversions.js';
import {bundledDetourGeometry,isNetworkDestination} from '../dist/bundled-detours.js';
import {emptyDetour,detourVehicles} from '../dist/detour-flow.js';
import {advanceRoutedNetwork,remainingInterchangeDemands} from '../dist/routed-traffic.js';
import {trafficView} from '../dist/traffic-view.js';

const routes=makeCorridors(networkData.roads,networkData.ramps),{exits}=networkData,demands=defaultDemands();
const links=buildRampConnections(networkData.ramps,routes),path='A3-frankfurt',route=routes[path];
const as=(p,ref)=>diversionJunctions(p,exits,routes[p]).find(j=>j.ref===ref);
function event(id,p,at,length,closedLanes,kind='roadworks',shoulder='normal'){
 return {id,pathKey:p,kind,point:routeSlice(routes[p],at,at+1)[0],laneCount:3,closedLanes,
  createdAt:'2026-10-30T08:00:00Z',settings:{lengthM:length,speedKmh:closedLanes.length===3&&shoulder!=='open'?0:40,shoulder}};
}
function entries(events,cells={}){return automaticDiversions(events,routes,exits,cells,links).map(o=>{
 const config={id:o.key,path:o.path,targetPath:o.targetPath,fromM:o.from.metre,toM:o.to.metre,
  sourceEndM:o.sourceEndM,targetEntryM:o.targetEntryM,movementId:o.movementId,journey:o.journey,
  eventId:o.event?.id??o.causeId??o.key,exitsNetwork:isNetworkDestination(o.to),
  geometry:o.geometry??bundledDetourGeometry(o.key,o.path,o.from,o.to,exits)};
 return {config,state:emptyDetour(config)};
});}

test('both Montabaur–AD closures leave the A48 Köln merge outside the closed interval',()=>{
 const closures=['A3-frankfurt','A3-koeln'].map(p=>{
  const at=(as(p,'39').metre+as(p,'40').metre)/2;
  return event('closed-'+p,p,at,100,[0,1,2],'closure','blocked');
 });
 const link=links.find(l=>l.rampId==='ramp-a48-to-koeln'),gate=closureGate(routes[link.to],closures[1],exits);
 assert.equal(gate.endExit.ref,'39');assert.ok(link.downstreamMergeM>gate.endM);
 let cells=Object.fromEntries(Object.keys(routes).filter(p=>!p.startsWith('ramp-')).map(p=>[p,initialiseCells(routes[p],demands[p])]));
 let detours=entries(closures,cells),legacy=emptySpatial(),passed=0;
 for(let t=0;t<60;t++){
  const step=advanceRoutedNetwork(cells,routes,closures,demands,exits,detours);cells=step.cells;detours=step.detours;
  const active=remainingInterchangeDemands(demands,detours,closures);
  legacy=advanceSpatial(legacy,closures,active,1,routes,links,[],exits);
  assert.ok(!legacy.queues['closed-merge:'+link.rampId],'the open arm cannot acquire a zero-throughput closure queue');
  passed+=detours.filter(e=>e.config.journey?.kind==='via').reduce((n,e)=>n+e.state.lastRejoined,0);
 }
 assert.ok(passed>100,'Frankfurt-bound A48 cars actually use the open Köln ramp');
 const original=jamsAt(legacy,closures,routes).filter(j=>j.pathKey===link.rampId);
 assert.ok(original.every(j=>j.capacityVph>0),'any real ramp congestion still has positive service');
});

for(const order of [false,true])test(`overlapping worksite and truck block every usable lane, independent of event order ${order}`,()=>{
 const at=route.lengthM*.7,work=event('work',path,at,2000,[1,2]),truck=event('truck',path,at+700,50,[0],'breakdown');
 const timeline=order?[truck,work]:[work,truck],effective=physicalEvents(route,timeline).find(e=>e.id==='truck');
 assert.equal(eventCapacity(effective,2200),0);assert.deepEqual(effective.closedLanes,[0,1,2]);
 let grid=initialiseCells(route,2200);
 for(let t=0;t<35;t++){grid=advanceCells(grid,route,timeline,2200,exits);assertCellConservation(grid);}
 assert.equal(grid.capacityVph,0);assert.ok(cellInventory(grid)>grid.initialVehicles+500);
 for(let t=0;t<100;t++)grid=advanceCells(grid,route,[work],1200,exits);
 assert.ok(grid.capacityVph>1000&&grid.dischargeVph>1000,'removing the truck restores the remaining worksite lane');
 assertCellConservation(grid);
});

test('all three main lanes may close while an opened shoulder carries real traffic',()=>{
 const at=route.lengthM*.7,work=event('shoulder-only',path,at,1500,[0,1,2],'roadworks','open');
 assert.equal(validEvent(work),true);assert.equal(flowPolicy(work).openTotalLanes,1);
 assert.ok(eventCapacity(work)>500);assert.deepEqual(decodeEvents(JSON.stringify([work])),[work]);
 let grid=initialiseCells(route,650);
 for(let t=0;t<70;t++)grid=advanceCells(grid,route,[work],650,exits);
 assertCellConservation(grid);assert.ok(grid.dischargeVph>600);
 const inside=grid.cells.filter(c=>c.fromM>at+200&&c.toM<at+1200);
 assert.ok(inside.every(c=>c.openLanes.length===0&&c.shoulderOpen&&c.jamDensityVehKm===130));
});

test('a downstream all-lane accident fills only the one available lane inside the worksite',()=>{
 const at=route.lengthM*.7,work=event('single-lane',path,at,3000,[1,2]),crash=event('downstream',path,at+3200,100,[0,1,2],'accident');
 let grid=initialiseCells(route,1800);
 for(let t=0;t<55;t++){grid=advanceCells(grid,route,[work,crash],1800,exits);assertCellConservation(grid);}
 const inside=grid.cells.filter(c=>c.fromM>at+500&&c.toM<at+2500);
 assert.ok(inside.every(c=>c.openLanes.length===1&&c.openLanes[0]===0&&c.densityVehKm<=130+1e-5));
 assert.ok(inside.some(c=>c.densityVehKm>120),'the actual remaining lane fills');
 assert.ok(grid.cells.some(c=>c.toM<at&&c.densityVehKm>130),'upstream three-lane storage remains distinct');
 // Switching an already occupied road to a narrower worksite cannot erase
 // the excess cars or admit more above its new storage limit.
 const before=cellInventory(grid);const narrower={...work,point:routeSlice(route,at-2000,at-1999)[0],settings:{...work.settings,lengthM:5000}};
 grid=advanceCells(grid,route,[narrower,crash],1800,exits);assertCellConservation(grid);
 assert.ok(cellInventory(grid)>=before,'queued vehicles survive the changed layout');
});

for(const mode of ['entry','exit','both'])test(`${mode} AS closure blocks only the configured movements and round-trips through storage`,()=>{
 const junction=as(path,'40'),work=event('junction-'+mode,path,junction.metre-500,1200,[]);
 work.settings.junctionClosures={'40':mode};work.settings.speedKmh=60;
 assert.ok(validEvent(work));assert.deepEqual(decodeEvents(JSON.stringify([work])),[work]);
 const access=junctionAccess(route,[work],junction.metre,'40');
 let grid=initialiseCells(route,2200);
 for(let t=0;t<10;t++)grid=advanceCells(grid,route,[work],2200,exits);
 const local=grid.junctions.find(j=>j.ref==='40');assertCellConservation(grid);
 assert.equal(local.lastEntered===0,!access.entry);assert.equal(local.lastExitAdmitted===0,!access.exit);
 const opposite=routes['A3-koeln'];assert.deepEqual(junctionAccess(opposite,[work],as('A3-koeln','40').metre,'40'),{entry:true,exit:true});
 const moved={...work,point:routeSlice(route,junction.metre+500,junction.metre+501)[0]};
 assert.deepEqual(junctionAccess(route,[moved],junction.metre,'40'),{entry:true,exit:true},'a stale stored choice outside the worksite has no effect');
});

test('a blocked normal exit is excluded from new incident bypasses',()=>{
 const junction=as(path,'40'),work=event('no-exit',path,junction.metre-300,1000,[]);
 work.settings.junctionClosures={'40':'exit'};
 const crash=event('blocked-after',path,junction.metre+1500,100,[0,1,2],'accident');
 const plans=automaticDiversions([work,crash],routes,exits,{},links);
 assert.ok(!plans.some(p=>p.path===path&&p.from.ref==='40'));
 assert.ok(plans.some(p=>p.path===path&&p.from.ref==='38'));
});

test('an unavailable Montabaur exit moves the formal gate upstream in both cell and ramp closure logic',()=>{
 const junction=as(path,'40'),work=event('montabaur-offramp',path,junction.metre-300,900,[]);
 work.settings.junctionClosures={'40':'exit'};
 const closure=event('closed-after-montabaur',path,junction.metre+500,100,[0,1,2],'closure','blocked');
 const timeline=[work,closure],gate=closureGate(route,closure,exits,timeline);
 assert.equal(gate.exit.ref,'38');
 const via=automaticDiversions(timeline,routes,exits,{},links).find(p=>p.journey?.kind==='via');
 assert.equal(via.journey.forcedByEventId,closure.id);
 assert.equal(via.journey.toM,as(path,'41').metre,'a closed exit cannot count as the next reachable departure');
 const legacy=advanceSpatial(emptySpatial(),timeline,demands,1,routes,links,[],exits);
 assert.equal(legacy.queues['closed-merge:ramp-a48-to-frankfurt'].capacityVph,0,
  'a ramp joining inside the newly upstream-extended closed interval must not bypass its gate');
});

test('Frankfurt detour cohorts use the next open Cologne-side exit when the Ransbach off-ramp is closed',()=>{
 const closed=event('ffm-closed',path,(as(path,'39').metre+as(path,'40').metre)/2,100,[0,1,2],'closure','blocked');
 const north='A3-koeln',junction=as(north,'38'),work=event('ransbach-exit',north,junction.metre-300,900,[]);
 work.settings.junctionClosures={'38':'exit'};
 const timeline=[closed,work],flow={...demands,'A48-dernbach':1400,'A3-frankfurt':1800,'A3-koeln':1800};
 let cells=Object.fromEntries(Object.keys(routes).filter(p=>!p.startsWith('ramp-')).map(p=>[p,initialiseCells(routes[p],flow[p])]));
 let detours=entries(timeline,cells);
 const via=detours.find(e=>e.config.journey?.kind==='via'),local=detours.find(e=>e.config.journey?.kind==='continuation');
 assert.equal(local.config.geometry.sourceExitRef,'37');
 assert.equal(via.config.journey.localExitM,as(north,'37').metre);
 for(let t=0;t<90;t++){
  const next=advanceRoutedNetwork(cells,routes,timeline,flow,exits,detours);cells=next.cells;detours=next.detours;
  assert.equal(cells[north].junctions.find(j=>j.ref==='38').lastExitAdmitted,0);
  assert.ok(cells[north].cells.filter(c=>c.fromM>as(north,'37').metre+200)
   .every(c=>(c.routedVehicles?.[via.config.journey.token]??0)<1e-6));
 }
 assert.ok(detours.find(e=>e.config.id===local.config.id).state.returnedTotal>20);
});

test('weaving vehicles can travel below the posted maximum before the worksite is congested',()=>{
 const at=route.lengthM*.7,work=event('weave',path,at,1200,[0]);work.settings.speedKmh=60;
 let grid=initialiseCells(route,2800);const speeds=[];
 for(let t=0;t<50;t++){
  grid=advanceCells(grid,route,[work],2800,exits);assertCellConservation(grid);
  if(t>10)speeds.push(...grid.cells.filter(c=>c.fromM>=at&&c.toM<=at+300).map(c=>c.speedKmh));
 }
 assert.ok(speeds.every(v=>v<=60+1e-6));assert.ok(speeds.some(v=>v<59));
 assert.ok(Math.max(...speeds)-Math.min(...speeds)>.05);assert.ok(grid.dischargeVph>2700);
 const view=trafficView([],{[path]:grid},routes,[work],[],grid.minute);
 assert.equal(view.reports[path].queueKm,0,'sub-limit speed by itself is not a jam');
 assert.ok(view.bands.get(path).some(b=>b.source==='restriction'&&b.speedKmh<60),'the map uses observed free-flow worksite speeds too');
});
