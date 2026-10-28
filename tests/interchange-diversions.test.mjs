import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {buildRampConnections,interchangeTrafficShare,interchangeDelays} from '../dist/interchange.js';
import {initialiseCells,cellInventory,cellSpeedBands} from '../dist/traffic-cells.js';
import {defaultDemands} from '../dist/traffic.js';
import {automaticDiversions} from '../dist/auto-diversions.js';
import {diversionJunctions} from '../dist/diversions.js';
import {routedDiversionChoice,voluntaryDiversionPercent} from '../dist/diversion-policy.js';
import {bundledDetourGeometry,isNetworkDestination} from '../dist/bundled-detours.js';
import {emptyDetour,detourVehicles} from '../dist/detour-flow.js';
import {advanceRoutedNetwork,remainingInterchangeDemands} from '../dist/routed-traffic.js';
import {journeyRampJams} from '../dist/interchange-journeys.js';
import {junctionMovements} from '../dist/junction-movements.js';

const routes=makeCorridors(networkData.roads,networkData.ramps),{exits}=networkData;
const links=buildRampConnections(networkData.ramps,routes),base=defaultDemands();
const junction=(path,ref)=>diversionJunctions(path,exits,routes[path]).find(j=>j.ref===ref);
function grids(demands=base){return Object.fromEntries(Object.keys(routes).filter(p=>!p.startsWith('ramp-'))
 .map(p=>[p,initialiseCells(routes[p],demands[p])]));}
function queue(cells,path,from,to,delay){
 const grid=cells[path],part=grid.cells.filter(c=>c.toM>from&&c.fromM<to),km=part.length*grid.cellM/1000;
 const speed=km*60/(delay+km/130*60);
 for(const c of part){c.speedKmh=speed;c.densityVehKm=100;c.vehicles=100*grid.cellM/1000;
  c.flowVph=c.travelFlowVph=speed*100;}
 grid.initialVehicles=cellInventory(grid);
}
function config(option){return {id:option.key,path:option.path,targetPath:option.targetPath,
 fromM:option.from.metre,toM:option.to.metre,sourceEndM:option.sourceEndM,targetEntryM:option.targetEntryM,
 movementId:option.movementId,journey:option.journey,eventId:option.event?.id??option.causeId??option.key,
 exitsNetwork:isNetworkDestination(option.to),geometry:option.geometry??bundledDetourGeometry(option.key,option.path,option.from,option.to,exits)};}
function prepare(cells,events=[],turnDelays={}){return automaticDiversions(events,routes,exits,cells,links,turnDelays)
 .map(o=>{const c=config(o);return {config:c,state:emptyDetour(c)};});}
function choices(entries,cells,events=[],demands=base,turnDelays={}){return entries.map(e=>({entry:e,
 ...routedDiversionChoice(e,entries,cells,routes,events,exits,demands,turnDelays)}));}
const expected={
 'A48-dernbach':['A48-dernbach:12>A3-frankfurt:40','A48-dernbach:12>A3-koeln:38'],
 'A48-koblenz':['A3-frankfurt:38>A48-koblenz:12','A3-koeln:38>A48-koblenz:12']
};
const routeName=e=>e.config.path+':'+e.config.geometry.sourceExitRef+'>'+e.config.targetPath+':'+e.config.geometry.targetExitRef;
for(const path of ['A48-dernbach','A48-koblenz'])for(const delay of [84.9,85,120])
 test(`${path}: ${delay} minutes selects only the matching AD destinations at the correct AS`,()=>{
  const cells=grids(),from=path==='A48-dernbach'?20000:2000;
  queue(cells,path,from,from+1500,delay);
  const entries=prepare(cells),used=choices(entries,cells).filter(c=>c.percent>0);
  assert.deepEqual(used.map(c=>routeName(c.entry)).sort(),delay<85?[]:expected[path]);
  if(delay===85)assert.ok(used.every(c=>c.percent>0&&c.percent<2),'only the first willing vehicles leave');
  assert.ok(used.every(c=>!c.mandatory));
  const before=structuredClone(entries);
  for(let i=0;i<5;i++)choices(entries,cells);
  assert.deepEqual(entries,before,'repainting cannot grow a share');
 });
test('85-minute movement uptake increases gradually while ordinary bypasses still start at 45',()=>{
 assert.equal(voluntaryDiversionPercent(84.99,0,85),0);
 assert.equal(voluntaryDiversionPercent(85,0,85),2);
 const values=[85,100,120,150,180].map(t=>voluntaryDiversionPercent(t,0,85));
 assert.ok(values.every((v,i)=>i===0||v>values[i-1]));assert.equal(values.at(-1),100);
 assert.equal(voluntaryDiversionPercent(45),2);
});
test('each A48 destination uses its own target-arm queue and its configured traffic share',()=>{
 const cells=grids(),link=links.find(l=>l.rampId==='ramp-a48-to-koeln');
 queue(cells,'A3-koeln',link.downstreamMergeM+300,link.downstreamMergeM+1200,150);
 const entries=prepare(cells),used=choices(entries,cells).filter(c=>c.percent>0&&c.entry.config.path==='A48-dernbach');
 assert.deepEqual(used.map(c=>routeName(c.entry)),['A48-dernbach:12>A3-koeln:38']);
 const noCologne={...base,'ramp-a48-to-koeln':0};
 assert.equal(choices(entries,cells,[],noCologne).filter(c=>c.entry.config.path==='A48-dernbach'&&c.percent>0).length,0);
 assert.equal(interchangeTrafficShare('ramp-a48-to-koeln','A48-dernbach','A3-koeln',base),5/12);
 assert.equal(interchangeTrafficShare('ramp-a48-to-koeln','A48-dernbach','A3-frankfurt',base),0);
});
test('Koblenz-bound traffic from Frankfurt passes its normal AD turn to reach Ransbach; straight A3 traffic stays',()=>{
 const cells=grids();queue(cells,'A48-koblenz',2000,4000,300);
 const entries=prepare(cells);for(const e of entries)e.state.choicePercent=100;
 const used=choices(entries,cells).filter(c=>c.percent>0),fromFrankfurt=used.find(c=>c.entry.config.path==='A3-koeln');
 assert.ok(fromFrankfurt);
 assert.ok(fromFrankfurt.entry.config.fromM>fromFrankfurt.entry.config.sourceEndM);
 for(const c of used){
  const share=interchangeTrafficShare(c.entry.config.movementId,c.entry.config.path,c.entry.config.targetPath,base);
  assert.ok(c.percent<=share*100&&c.percent<25,'cannot divert all unrelated A3 travellers');
 }
 const none={...base,'ramp-a3-to-a48-from-frankfurt':0};
 assert.equal(choices(entries,cells,[],none).find(c=>c.entry.config.id===fromFrankfurt.entry.config.id).percent,0);
});
test('a remote A3 queue after a free target-arm AS does not recruit Höhr early',()=>{
 const cells=grids(),from=junction('A3-koeln','38').metre;
 queue(cells,'A3-koeln',from+3000,from+4500,240);
 const entries=prepare(cells);
 assert.equal(choices(entries,cells).filter(c=>c.percent>0&&c.entry.config.path==='A48-dernbach').length,0);
});
test('a separate Bendorf exit queue cannot borrow a far target forecast and displace Höhr',()=>{
 const cells=grids(),link=links.find(l=>l.rampId==='ramp-a48-to-koeln');
 queue(cells,'A3-koeln',link.downstreamMergeM+300,link.downstreamMergeM+1200,240);
 const at=junction('A48-dernbach','11').metre;
 queue(cells,'A48-dernbach',at+200,at+600,12);
 const entries=prepare(cells);
 const used=choices(entries,cells).filter(c=>c.percent>0&&c.entry.config.path==='A48-dernbach');
 assert.deepEqual(used.map(c=>c.entry.config.geometry.sourceExitRef),['12']);
});
test('a source-side full closure splits mandatory A48 traffic into both destinations, with zero entry at Höhr',()=>{
 const cells=grids(),path='A48-dernbach',at=junction(path,'12').metre+300;
 const event={id:'ad-closure',kind:'closure',pathKey:path,point:routeSlice(routes[path],at,at+1)[0],
  laneCount:2,closedLanes:[0,1],createdAt:'2026-10-25T12:00:00Z',settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}};
 let entries=prepare(cells,[event]),state=cells;
 const initial=Object.values(state).reduce((n,g)=>n+cellInventory(g),0);
 for(let i=0;i<100;i++){
  const result=advanceRoutedNetwork(state,routes,[event],base,exits,entries);state=result.cells;entries=result.detours;
  assert.equal(state[path].junctions.find(j=>j.ref==='12').lastEntered,0);
  const local=state[path].junctions.find(j=>j.ref==='12');
  assert.ok(local.lastExited+entries.filter(e=>e.config.path===path&&Math.abs(e.config.fromM-local.metre)<25)
   .reduce((n,e)=>n+e.state.lastDeparture,0)<=local.exitCapacityVph/60+1e-6,'all targets share one exit movement');
  assertBudget(state,entries,initial);
 }
 const branches=entries.filter(e=>e.config.path===path&&e.config.geometry.sourceExitRef==='12'&&e.config.movementId);
 assert.equal(branches.length,2);assert.ok(branches.every(e=>Math.abs(e.desiredPercent-
  (e.config.movementId==='ramp-a48-to-koeln'?5/12:7/12)*100)<1e-8&&e.state.returnedTotal>50));
 const unspecific=entries.find(e=>e.config.path===path&&e.config.geometry.sourceExitRef==='12'&&!e.config.movementId);
 assert.equal(unspecific.desiredPercent,0);assert.equal(unspecific.state.admittedTotal,0);
 for(const e of branches){
  const returned=entries.filter(other=>(other.config.targetPath??other.config.path)===e.config.targetPath&&!other.config.exitsNetwork)
   .reduce((n,other)=>n+other.state.returnedTotal,0);
  assert.ok(Math.abs(state[e.config.targetPath].rejoinedTotal-returned)<1e-6,
   'target receiving totals include every real route, including bypasses of the newly backed-up exit');
 }
});
function assertBudget(cells,entries,initial){
 const inside=Object.values(cells).reduce((n,g)=>n+cellInventory(g),0)+entries.reduce((n,e)=>n+detourVehicles(e.state),0);
 const left=Object.values(cells).reduce((n,g)=>n+g.exitedTotal,0)+entries.reduce((n,e)=>n+(e.state.exitedNetworkTotal??0),0);
 const arrived=Object.values(cells).reduce((n,g)=>n+g.offeredTotal,0);
 assert.ok(Math.abs(inside+left-initial-arrived)<1e-5,'one global vehicle ledger');
}
for(const reverse of [false,true])test(`${reverse?'both A3 sources':'both A48 destinations'} share one side road and return exactly once`,()=>{
 const zero=Object.fromEntries(Object.keys(base).map(p=>[p,0]));let cells=grids(zero);
 const delays=reverse?{'ramp-a3-to-a48-from-koeln':200,'ramp-a3-to-a48-from-frankfurt':200}:
  {'ramp-a48-to-koeln':200,'ramp-a48-to-frankfurt':200};
 let entries=prepare(cells,[],delays).filter(e=>e.config.geometry.sourceExitRef===(reverse?'38':'12')&&
  (reverse?e.config.targetPath==='A48-koblenz':e.config.path==='A48-dernbach'));
 assert.equal(entries.length,2);
 entries=entries.map(e=>({...e,enabled:false,state:{...e.state,waitingRoad:500,admittedTotal:500}}));
 const common=entries[0].config.geometry.sections.find(s=>entries[1].config.geometry.sections.some(t=>t.id===s.id));
 assert.ok(common);const initial=1000;
 for(let i=0;i<150;i++){
  const before=entries.reduce((n,e)=>n+e.state.admittedTotal-e.state.waitingRoad,0);
  const result=advanceRoutedNetwork(cells,routes,[],zero,exits,entries);cells=result.cells;entries=result.detours;
  const after=entries.reduce((n,e)=>n+e.state.admittedTotal-e.state.waitingRoad,0);
  assert.ok((after-before)*60<=common.capacityVph+1e-6,'shared road capacity cannot be duplicated');
  assertBudget(cells,entries,initial);
  if(reverse)assert.ok(entries.reduce((n,e)=>n+e.state.lastRejoined*60,0)<=900+1e-6);
 }
 assert.ok(entries.every(e=>Math.abs(e.state.returnedTotal-500)<1e-6&&detourVehicles(e.state)<1e-6));
 assert.equal(cells['A48-dernbach'].rejoinedTotal,0);
 if(reverse){assert.ok(Math.abs(cells['A48-koblenz'].rejoinedTotal-1000)<1e-6);
  assert.equal(cells['A3-koeln'].rejoinedTotal,0);assert.equal(cells['A3-frankfurt'].rejoinedTotal,0);}
 else for(const e of entries)assert.ok(Math.abs(cells[e.config.targetPath].rejoinedTotal-500)<1e-6);
});
test('destination percentages add on the AS badge and count their separate correct re-entries',()=>{
 const flows=[{path:'A48-dernbach',targetPath:'A3-koeln',movementId:'ramp-a48-to-koeln',fromM:junction('A48-dernbach','12').metre,
  toM:junction('A3-koeln','38').metre,eventId:'x',desiredPercent:30,outVph:300,inVph:280,vehiclesOnDetour:50,waitingAtReentry:2},
 {path:'A48-dernbach',targetPath:'A3-frankfurt',movementId:'ramp-a48-to-frankfurt',fromM:junction('A48-dernbach','12').metre,
  toM:junction('A3-frankfurt','40').metre,eventId:'x',desiredPercent:20,outVph:200,inVph:180,vehiclesOnDetour:40,waitingAtReentry:3}];
 const source=junctionMovements('A48-dernbach',routes['A48-dernbach'],exits,[],0,flows).find(r=>r.exit.ref==='12');
 assert.equal(source.desiredPercent,50);assert.equal(source.diversionOutVph,500);
 for(const [path,ref,rate] of [['A3-koeln','38',280],['A3-frankfurt','40',180]]){
  const row=junctionMovements(path,routes[path],exits,[],0,flows).find(r=>r.exit.ref===ref);
  assert.equal(row.returningInVph,rate);
 }
});
test('AD turn observations stay destination-specific and a blocked accident forecast does not use event age',()=>{
 const path='ramp-a48-to-koeln',event={id:'ramp-block',kind:'accident',pathKey:path,laneCount:2,closedLanes:[0,1],
  point:routes[path].points[3],createdAt:'2026-10-25T12:00:00Z',settings:{lengthM:100,speedKmh:0,shoulder:'normal',clearanceMin:90}};
 const jam={id:event.id,pathKey:path,queueVehicles:300,delayMin:null};
 const loss=interchangeDelays([jam],[event]);assert.ok(loss[path]>90&&loss[path]<180);
 assert.equal(loss['ramp-a48-to-frankfurt'],undefined);
 assert.deepEqual(interchangeDelays([jam],[{...event,createdAt:'2020-01-01T00:00:00Z'}]),loss);
 const cells=grids(),entries=prepare(cells,[event],loss);
 assert.deepEqual(choices(entries,cells,[event],base,loss).filter(c=>c.percent>0).map(c=>routeName(c.entry)),
  ['A48-dernbach:12>A3-koeln:38']);
});

function branchClosure(path,id='branch-closure'){
 const ramp=links.find(l=>l.to===path&&l.from==='A48-dernbach');
 const first=junction(path,path==='A3-koeln'?'38':'40');
 const at=(ramp.downstreamMergeM+first.metre)/2;
 return {id,kind:'closure',pathKey:path,point:routeSlice(routes[path],at,at+1)[0],laneCount:3,closedLanes:[0,1,2],
  createdAt:'2026-10-25T12:00:00Z',settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}};
}
const journeyDemands={...base,'A48-dernbach':1400,'A3-koeln':1800,'A3-frankfurt':1800};
for(const rampOnly of [false,true])test(`${rampOnly?'Frankfurt ramp':'A3 Frankfurt arm'} closure uses Köln ramp, Ransbach exit and Montabaur entry`,()=>{
 let cells=grids(journeyDemands);
 const event=rampOnly?{id:'ramp-frankfurt-closed',kind:'closure',pathKey:'ramp-a48-to-frankfurt',
  point:routes['ramp-a48-to-frankfurt'].points[3],laneCount:2,closedLanes:[0,1],createdAt:'2026-10-25T12:00:00Z',
  settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}}:branchClosure('A3-frankfurt');
 let entries=prepare(cells,[event]);
 const via=entries.find(e=>e.config.journey?.kind==='via'),next=entries.find(e=>e.config.journey?.kind==='continuation');
 assert.ok(via&&next);
 assert.equal(via.config.targetPath,'A3-koeln');assert.equal(via.config.journey.rampId,'ramp-a48-to-koeln');
 assert.equal(via.config.geometry.source,'osm-motorway-ramp');
 assert.equal(next.config.path,'A3-koeln');assert.equal(next.config.geometry.sourceExitRef,'38');
 assert.equal(next.config.targetPath,'A3-frankfurt');assert.equal(next.config.geometry.targetExitRef,'40');
 const token=via.config.journey.token,initial=Object.values(cells).reduce((n,g)=>n+cellInventory(g),0);
 for(let i=0;i<70;i++){
  const step=advanceRoutedNetwork(cells,routes,[event],journeyDemands,exits,entries);cells=step.cells;entries=step.detours;
  assertBudget(cells,entries,initial);
  const first=entries.find(e=>e.config.id===via.config.id),last=entries.find(e=>e.config.id===next.config.id);
  const onA3=cells['A3-koeln'].cells.reduce((n,c)=>n+(c.routedVehicles?.[token]??0),0)+
   cells['A3-koeln'].junctions.reduce((n,j)=>n+(j.exitQueue?.detours[next.config.id]??0),0);
  assert.ok(Math.abs(first.state.returnedTotal-last.state.admittedTotal-onA3)<1e-5,
   'Frankfurt cohorts travel along A3 Köln and leave only for their continuation');
  if(i>10){
   assert.ok(cells['A48-dernbach'].cells.at(-1).routedVehicles?.[token]===undefined,
    'committed Frankfurt trips cannot disappear through the normal A48 boundary');
   assert.ok(cells['A3-koeln'].cells.filter(c=>c.fromM>next.config.fromM+300)
    .every(c=>(c.routedVehicles?.[token]??0)<1e-6),'no Frankfurt cohort continues toward Cologne after Ransbach');
  }
 }
 const first=entries.find(e=>e.config.id===via.config.id),last=entries.find(e=>e.config.id===next.config.id);
 assert.ok(first.state.returnedTotal>300&&last.state.admittedTotal>200&&last.state.returnedTotal>100);
 assert.equal(remainingInterchangeDemands(journeyDemands,entries,[event])['ramp-a48-to-frankfurt'],0,
  'rerouted Frankfurt trips cannot also build a phantom queue on the original ramp');
 assert.equal(remainingInterchangeDemands(journeyDemands,entries,[event])['ramp-a48-to-koeln'],journeyDemands['ramp-a48-to-koeln'],
  'normal Cologne traffic retains its own ramp demand');
 for(const jam of journeyRampJams(entries,routes,[event],journeyDemands)){
  assert.ok(jam.pathKey.startsWith('ramp-')&&jam.queueM<=routes[jam.pathKey].lengthM);
  assert.equal(jam.outOfBoundsM,0,'owned ramp cars do not create a second feeder queue');
  assert.ok(jam.delayMin===null||Number.isFinite(jam.delayMin));
 }
 assert.equal(entries.filter(e=>e.config.path==='A48-dernbach'&&e.config.geometry.sourceExitRef==='12'&&
  e.config.targetPath==='A3-frankfurt').reduce((n,e)=>n+e.state.admittedTotal,0),0,
  'a usable Köln-ramp journey replaces an early Höhr–Montabaur departure');
});
test('closed Cologne arm keeps Koblenz traffic on the open AD turn and sends A48 Cologne trips via Höhr',()=>{
 const path='A3-koeln',event=branchClosure(path),turn=links.find(l=>l.from===path&&l.to==='A48-koblenz');
 let cells=grids(journeyDemands),entries=prepare(cells,[event]);
 const protectedRoute=entries.find(e=>e.config.journey?.kind==='protected'&&e.config.path===path);
 assert.ok(protectedRoute);const token=protectedRoute.config.journey.token;
 const gate=junction(path,'40').metre,after=junction(path,'38').metre;
 const ordinary=entries.find(e=>e.config.path===path&&!e.config.movementId&&e.config.geometry.sourceExitRef==='40');
 assert.ok(ordinary&&ordinary.config.geometry.targetExitRef==='38');
 const initial=Object.values(cells).reduce((n,g)=>n+cellInventory(g),0);
 for(let i=0;i<70;i++){
  const next=advanceRoutedNetwork(cells,routes,[event],journeyDemands,exits,entries);cells=next.cells;entries=next.detours;
  assertBudget(cells,entries,initial);
  if(i>20){
   const approach=cells[path].cells.filter(c=>c.fromM>gate+300&&c.toM<turn.rampEntryM-300);
   assert.ok(approach.some(c=>c.vehicles>.1),'Koblenz traffic must actually pass Montabaur');
   assert.ok(approach.every(c=>Math.abs(c.vehicles-(c.routedVehicles?.[token]??0))<1e-5),
    'only the protected Koblenz cohort can enter beyond the last regular exit');
   assert.ok(cells[path].cells.filter(c=>c.fromM>turn.rampEntryM+500&&c.toM<after-200).every(c=>c.vehicles<1e-5),
    'the protected cohort takes A48 before the physically closed Cologne section');
  }
 }
 const protectedFinal=entries.find(e=>e.config.id===protectedRoute.config.id);
 assert.ok(protectedFinal.state.returnedTotal>300);
 assert.equal(remainingInterchangeDemands(journeyDemands,entries,[event])[turn.rampId],0,
  'the open turn is served by its real committed cohort, without duplicate legacy demand');
 assert.ok(cells['A48-koblenz'].rejoinedTotal>=protectedFinal.state.returnedTotal-1e-6);
 const cologne=entries.find(e=>e.config.path==='A48-dernbach'&&e.config.targetPath===path&&e.config.geometry.sourceExitRef==='12');
 assert.ok(cologne&&cologne.state.returnedTotal>100);assert.equal(cologne.config.geometry.targetExitRef,'38');
 assert.ok(entries.find(e=>e.config.id===ordinary.config.id).state.admittedTotal>100);
 const committed=protectedFinal.state.admittedTotal;
 for(let i=0;i<150;i++){
  const next=advanceRoutedNetwork(cells,routes,[],journeyDemands,exits,entries);cells=next.cells;entries=next.detours;
  assertBudget(cells,entries,initial);
 }
 const settled=entries.find(e=>e.config.id===protectedRoute.config.id),before=settled.state.admittedTotal;
 for(let i=0;i<20;i++){
  const next=advanceRoutedNetwork(cells,routes,[],journeyDemands,exits,entries);cells=next.cells;entries=next.detours;
 }
 assert.equal(entries.find(e=>e.config.id===protectedRoute.config.id).state.admittedTotal,before,
  'removing the closure stops assigning new protected journeys; old cars finish');
 assert.equal(remainingInterchangeDemands(journeyDemands,entries,[])[turn.rampId],journeyDemands[turn.rampId],
  'normal ramp demand resumes when the committed closure journeys have cleared');
 assert.ok(before>=committed);
});
