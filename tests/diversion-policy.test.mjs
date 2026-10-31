import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice,closureGate,positionM} from '../dist/spatial.js';
import {automaticDiversions} from '../dist/auto-diversions.js';
import {diversionJunctions,potentialDiversionPercent} from '../dist/diversions.js';
import {bundledDetourGeometry,isNetworkDestination} from '../dist/bundled-detours.js';
import {emptyDetour,detourVehicles} from '../dist/detour-flow.js';
import {advanceRoutedNetwork} from '../dist/routed-traffic.js';
import {routedDiversionChoice,voluntaryDiversionPercent} from '../dist/diversion-policy.js';
import {initialiseCells,cellInventory} from '../dist/traffic-cells.js';
import {speedDelayInCells} from '../dist/speed-delay.js';
import {freeSpeedKmh} from '../dist/traffic-physics.js';
import {defaultDemands} from '../dist/traffic.js';
import {junctionMovements} from '../dist/junction-movements.js';
import {buildRampConnections} from '../dist/interchange.js';
const routes=makeCorridors(networkData.roads,networkData.ramps),{exits}=networkData;
const anchor=(path,ref)=>diversionJunctions(path,exits,routes[path]).find(j=>j.ref===ref);
function incident(path,from,to,kind='closure'){
 const a=anchor(path,from),b=anchor(path,to),at=(a.metre+b.metre)/2,laneCount=path.startsWith('A48')?2:3;
 return {id:'policy-'+path,kind,pathKey:path,point:routeSlice(routes[path],at,at+2)[0],
  laneCount,closedLanes:Array.from({length:laneCount},(_,i)=>i),createdAt:'2026-10-23T10:00:00Z',
  settings:{lengthM:200,speedKmh:0,shoulder:'blocked'}};
}
function prepare(event){return automaticDiversions([event],routes,exits,{}).map(option=>{
 const config={id:option.key,path:option.path,fromM:option.from.metre,toM:option.to.metre,eventId:event.id,
  geometry:bundledDetourGeometry(option.key,option.path,option.from,option.to,exits),exitsNetwork:isNetworkDestination(option.to)};
 return {config,state:emptyDetour(config)};
});}
// A real spatial field at known density and travel loss; changing its extent
// changes the tail. The lower fallback from excess vehicles stays below 45.
function withQueue(path,tail,head,delay=60){
 const grid=initialiseCells(routes[path],2000);
 const selected=grid.cells.filter(c=>c.toM>tail&&c.fromM<head);
 const km=selected.reduce((n,c)=>n+(c.toM-c.fromM)/1000,0),free=freeSpeedKmh(path);
 const speed=60*km/(delay+60*km/free);
 for(const c of selected){c.densityVehKm=60;c.vehicles=60*(c.toM-c.fromM)/1000;c.speedKmh=speed;c.flowVph=speed*60;}
 grid.initialVehicles=cellInventory(grid);return grid;
}
function wanted(entries,cells,event,demands=defaultDemands()){
 return entries.map(e=>({ref:e.config.geometry.sourceExitRef,...routedDiversionChoice(e,entries,cells,routes,[event],exits,demands)}));
}

test('voluntary diversion is zero below 45 min and starts with a few drivers, for every incident type',()=>{
 for(const delay of [0,5,15,30,44,44.999,44.99999]){
  assert.equal(potentialDiversionPercent(delay,false),0);assert.equal(voluntaryDiversionPercent(delay),0);
 }
 assert.equal(voluntaryDiversionPercent(45),2);
 assert.ok(voluntaryDiversionPercent(45,10)>0&&voluntaryDiversionPercent(45,10)<2);
 assert.ok(voluntaryDiversionPercent(60)>voluntaryDiversionPercent(45));
 assert.equal(voluntaryDiversionPercent(500),100);
 for(const kind of ['accident','roadworks','breakdown']){
  const path='A3-koeln',event=incident(path,'38','37',kind),entries=prepare(event),at=positionM(routes[path],event.point);
  const low=withQueue(path,at-3000,at,44),high=withQueue(path,at-3000,at,45);
  assert.ok(wanted(entries,{[path]:low},event).every(c=>c.percent===0),kind);
  const used=wanted(entries,{[path]:high},event).filter(c=>c.percent>0);
  assert.deepEqual(used.map(c=>c.ref),['38'],kind);
  assert.ok(used.every(c=>c.percent<=2&&!c.mandatory));
 }
});
test('a new incident between Limburg-Nord and Süd does not recruit remote AS, while normal trips continue',()=>{
 for(const [path,a,b] of [['A3-koeln','43','42'],['A3-frankfurt','42','43']]){
  for(const kind of ['accident','roadworks']){
   const event={...incident(path,a,b,kind),closedLanes:[0,1],settings:{lengthM:100,speedKmh:40,shoulder:'normal'}};
   let entries=prepare(event),cells={[path]:initialiseCells(routes[path],2000)};
   for(let t=0;t<4;t++){
    const next=advanceRoutedNetwork(cells,routes,[event],defaultDemands(),exits,entries);cells=next.cells;entries=next.detours;
    assert.ok(entries.every(d=>d.desiredPercent===0&&d.state.admittedTotal===0),path+' '+kind+' '+t);
    assert.ok(cells[path].junctions.every(j=>(j.entryVph===0||j.lastEntered>0)&&(j.exitPercent===0||j.lastExited>0)));
   }
  }
 }
});
test('all ordinary incident kinds select the nearest AS as the actual queue grows upstream',()=>{
 const path='A3-koeln',demands={...defaultDemands(),[path]:2000};
 for(const kind of ['accident','roadworks','breakdown']){
  const event=incident(path,'38','37',kind),entries=prepare(event),at=positionM(routes[path],event.point);
  for(const [tail,ref] of [[anchor(path,'38').metre+1000,'38'],[anchor(path,'38').metre-500,'40'],[anchor(path,'40').metre-500,'41']]){
   const grid=withQueue(path,tail,at,100),cells={[path]:grid};
   const choices=wanted(entries,cells,event,demands),selected=choices.find(c=>c.ref===ref),from=anchor(path,ref).metre;
   assert.ok(selected.percent>0&&selected.percent<=5);
   assert.ok(choices.filter(c=>anchor(path,c.ref).metre<from-25).every(c=>c.percent===0));
   const next=advanceRoutedNetwork(cells,routes,[event],demands,exits,entries);
   assert.deepEqual(next.detours.filter(d=>d.state.lastDeparture>0).map(d=>d.config.geometry.sourceExitRef).sort(),
    choices.filter(c=>c.percent>0).map(c=>c.ref).sort());
   assert.ok(next.detours.every(d=>{const row=next.cells[path].junctions.find(j=>j.ref===d.config.geometry.sourceExitRef);
    return d.state.lastDeparture*60+(row?.lastExited??0)*60<=(row?.exitCapacityVph??Infinity)+1e-6;}));
  }
 }
});
test('a new formal closure diverts ONLY the last AS, in both A3 and A48 directions',()=>{
 for(const [path,from,to] of [['A3-koeln','38','37'],['A3-frankfurt','41','42'],['A48-dernbach','11','12'],['A48-koblenz','11','10']]){
  const event=incident(path,from,to),entries=prepare(event),demands=defaultDemands();
  const cells=Object.fromEntries(['A3-koeln','A3-frankfurt','A48-dernbach','A48-koblenz'].map(p=>[p,initialiseCells(routes[p],demands[p])]));
  const next=advanceRoutedNetwork(cells,routes,[event],demands,exits,entries);
  const used=next.detours.filter(d=>d.state.lastDeparture>1e-6);
  assert.equal(used.length,1,path);assert.equal(used[0].config.geometry.sourceExitRef,from);
  assert.equal(used[0].desiredPercent,100);
  assert.ok(next.detours.filter(d=>d!==used[0]).every(d=>d.desiredPercent===0&&d.state.admittedTotal===0),path);
  for(const opposite of Object.keys(cells).filter(p=>p!==path))assert.equal(next.cells[opposite].divertedTotal,0);
  const actual=next.detours.map(d=>({path,fromM:d.config.fromM,toM:d.config.toM,eventId:event.id,
   desiredPercent:d.desiredPercent,outVph:d.state.lastDeparture*60,inVph:0,vehiclesOnDetour:detourVehicles(d.state),waitingAtReentry:0}));
  const displayed=junctionMovements(path,routes[path],exits,[event],0,actual,next.cells[path].junctions);
  assert.deepEqual(displayed.filter(r=>r.desiredPercent>0).map(r=>r.exit.ref),[from]);
 }
});
test('waiting at a mandatory exit recruits only the nearest AS before its actual approach queue',()=>{
 const path='A3-koeln',event=incident(path,'38','37'),entries=prepare(event),gate=closureGate(routes[path],event,exits);
 const mandatory=entries.find(d=>Math.abs(d.config.fromM-gate.metre)<25);
 mandatory.state.waitingRoad=2000;
 for(const [tail,ref] of [[gate.metre-500,'40'],[anchor(path,'40').metre-500,'41']]){
  const cells={[path]:withQueue(path,tail,gate.metre,100)};
  const choices=wanted(entries,cells,event);
  assert.equal(choices.find(c=>c.ref==='38').percent,100);
  assert.ok(choices.find(c=>c.ref===ref).percent>0);
  assert.ok(choices.filter(c=>anchor(path,c.ref).metre<anchor(path,ref).metre-25).every(c=>c.percent===0));
 }
 const free=initialiseCells(routes[path],2000);free.minute=10000;
 assert.ok(wanted(entries,{[path]:free},event).filter(c=>c.ref!=='38').every(c=>c.percent===0));
 mandatory.state.waitingRoad=0;
 assert.deepEqual(wanted(entries,{[path]:free},event).filter(c=>c.percent>0).map(c=>c.ref),['38']);
});
test('zero gate speed does not turn a short queue into remote mandatory exits',()=>{
 const path='A3-koeln',event=incident(path,'38','37'),entries=prepare(event),grid=initialiseCells(routes[path],2000);
 const gate=closureGate(routes[path],event,exits),cell=grid.cells.find(c=>c.fromM<gate.metre&&c.toM>=gate.metre);
 cell.speedKmh=0;cell.vehicles+=8;
 for(const c of wanted(entries,{[path]:grid},event))assert.equal(c.percent,c.ref==='38'?100:0);
});
test('a live long closure uses delay for voluntary choices and conserves boundary, local and detour vehicles',()=>{
 const path='A3-koeln',event=incident(path,'38','37'),demands={...defaultDemands(),[path]:3800};
 let entries=prepare(event),cells={[path]:initialiseCells(routes[path],3800)};
 const initial=cellInventory(cells[path]);let firstPrevious=null;
 for(let t=0;t<100;t++){
  const choices=wanted(entries,cells,event,demands);
  const next=advanceRoutedNetwork(cells,routes,[event],demands,exits,entries);cells=next.cells;entries=next.detours;
  for(const [i,d] of entries.entries()){
   assert.equal(d.desiredPercent,choices[i].percent);
   if(!choices[i].mandatory&&choices[i].delayMin<45)assert.equal(d.desiredPercent,0);
  }
  const previous=entries.find(d=>d.config.geometry.sourceExitRef==='40');
  if(previous.state.lastDeparture>0&&firstPrevious===null){firstPrevious=t;assert.ok(previous.desiredPercent<=5);}
  const completed=entries.reduce((n,d)=>n+(d.state.exitedNetworkTotal??0),0);
  const total=cellInventory(cells[path])+entries.reduce((n,d)=>n+detourVehicles(d.state),0);
  assert.ok(Math.abs(total+cells[path].exitedTotal+completed-initial-cells[path].offeredTotal)<1e-5);
 }
 assert.ok(firstPrevious!==null&&firstPrevious>5);
});
test('full-lane accidents have no mandatory exit; closure lifting removes its obligation',()=>{
 const path='A3-koeln',closed=incident(path,'38','37'),entries=prepare(closed),cells={[path]:initialiseCells(routes[path],2000)};
 for(const timeline of [[{...closed,kind:'accident'}],[]])for(const entry of entries){
  const choice=routedDiversionChoice(entry,entries,cells,routes,timeline,exits,defaultDemands());
  assert.equal(choice.mandatory,false);assert.equal(choice.percent,0);
 }
});
test('each approaching motorway uses its nearest exit for a delayed A3 journey',()=>{
 const path='A3-frankfurt',source='A48-dernbach',event=incident(path,'40','41');
 const merge=buildRampConnections(networkData.ramps,routes).find(c=>c.rampId==='ramp-a48-to-frankfurt');
 const gate=closureGate(routes[path],event,exits),target=anchor(path,'41');
 const grid=withQueue(path,merge.downstreamMergeM+1000,gate.metre,120);
 const entries=diversionJunctions(source,exits,routes[source]).filter(j=>!j.isInterchange).map(from=>{
  const id='cross-'+from.ref,config={id,path:source,targetPath:path,fromM:from.metre,toM:target.metre,
   sourceEndM:merge.rampEntryM,targetEntryM:merge.downstreamMergeM,eventId:event.id,
   geometry:bundledDetourGeometry(id,source,from,target,exits)};
  return {config,state:emptyDetour(config)};
 });
 const plans=automaticDiversions([event],routes,exits,{[path]:grid},[merge]);
 assert.deepEqual(plans.filter(p=>p.path===source).map(p=>p.from.ref).sort(),['10','11','12']);
 for(const [sourceGrid,nearest] of [[initialiseCells(routes[source],2000),'12'],
  [withQueue(source,anchor(source,'12').metre-500,merge.rampEntryM,60),'11'],
  [withQueue(source,anchor(source,'11').metre-500,merge.rampEntryM,60),'10']]){
  const choices=wanted(entries,{[source]:sourceGrid,[path]:grid},event);
  assert.ok(choices.every(c=>!c.mandatory));
  assert.ok(choices.find(c=>c.ref===nearest).percent>0);
  assert.ok(choices.filter(c=>anchor(source,c.ref).metre<anchor(source,nearest).metre-25).every(c=>c.percent===0));
 }
});

test('delay already behind an AS is not charged to its entrants, while earlier AS can avoid it',()=>{
 const path='A3-frankfurt',event=incident(path,'42','43','accident'),at=positionM(routes[path],event.point);
 const entries=prepare(event),grid=withQueue(path,at-200,at,20),diez=anchor(path,'41').metre;
 for(const c of grid.cells)if(c.fromM>diez-900&&c.toM<diez-100){
  c.densityVehKm=180;c.vehicles=180*(c.toM-c.fromM)/1000;c.speedKmh=.5;c.flowVph=90;
 }
 const chosen=wanted(entries,{[path]:grid},event);
 assert.equal(chosen.find(c=>c.ref==='41').percent,0,'the long queue behind Diez is not ahead of its new entrants');
 assert.ok(chosen.find(c=>c.ref==='40').percent>0,'Montabaur can avoid the long remaining journey');
});
test('one free cell within a fragmented queue does not switch earlier exits off',()=>{
 const path='A3-frankfurt',event=incident(path,'42','43','accident'),at=positionM(routes[path],event.point);
 const grid=withQueue(path,anchor(path,'41').metre-500,at,90),asCell=grid.cells.findIndex(c=>c.fromM<anchor(path,'41').metre&&c.toM>=anchor(path,'41').metre);
 const gap=grid.cells[asCell+2];
 gap.densityVehKm=15;gap.vehicles=15*(gap.toM-gap.fromM)/1000;gap.speedKmh=120;
 gap.queueMemoryMin=3;
 const before=wanted(prepare(event),{[path]:grid},event).find(c=>c.ref==='40');
 gap.densityVehKm=100;gap.vehicles=100*(gap.toM-gap.fromM)/1000;gap.speedKmh=70;
 const after=wanted(prepare(event),{[path]:grid},event).find(c=>c.ref==='40');
 assert.ok(before.percent>0&&after.percent>0&&Math.abs(before.percent-after.percent)<.2);
});
test('long real Unfall runs never force remote exits and use the remaining delay for their decisions',()=>{
 const path='A3-frankfurt',route=routes[path];
 for(const closedLanes of [[0,1],[0,1,2]]){
  const event={...incident(path,'42','43','accident'),id:'limburg-incident',closedLanes,
   settings:{lengthM:100,speedKmh:closedLanes.length===3?0:40,shoulder:'normal'}};
  let cells={[path]:initialiseCells(route,4200)},entries=prepare(event),firstDiez=null;
  for(let t=0;t<120;t++){
   const previous=cells[path];
   const next=advanceRoutedNetwork(cells,routes,[event],{...defaultDemands(),[path]:4200},exits,entries);
   cells=next.cells;entries=next.detours;
   for(const d of entries.filter(d=>d.state.lastDeparture>1e-6)){
    const ref=d.config.geometry.sourceExitRef;
    if(ref==='41'&&firstDiez===null){
     firstDiez=t;assert.ok(d.desiredPercent<20,'first Diez uptake must leave most drivers on the motorway');
     const exitCell=cells[path].cells.find(c=>c.fromM<d.config.fromM&&c.toM>=d.config.fromM);
     assert.ok(exitCell.speedKmh>65,'the first few Diez departures must not instantly create an exit jam');
    }
    const remaining=speedDelayInCells(previous,d.config.fromM,d.config.toM);
    assert.ok(remaining.delayMin>=45-1e-9,'voluntary departures require remaining delay, even at distant AS');
    assert.ok(d.desiredPercent>=0&&d.desiredPercent<=100);
    if(d.desiredPercent===100)assert.ok(remaining.delayMin>=180,
     'all drivers may choose a viable bypass only with a genuinely very high remaining delay');
    assert.equal(routedDiversionChoice(d,entries,{[path]:previous},routes,[event],exits,
     {...defaultDemands(),[path]:4200}).mandatory,false,'an accident remains a voluntary diversion');
   }
  }
  assert.notEqual(firstDiez,null);
 }
});
