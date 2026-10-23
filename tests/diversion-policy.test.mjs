import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice,closureGate} from '../dist/spatial.js';
import {automaticDiversions} from '../dist/auto-diversions.js';
import {diversionJunctions} from '../dist/diversions.js';
import {bundledDetourGeometry,isNetworkDestination} from '../dist/bundled-detours.js';
import {emptyDetour,detourVehicles} from '../dist/detour-flow.js';
import {advanceRoutedNetwork} from '../dist/routed-traffic.js';
import {routedDiversionChoice,earlierExitPercent} from '../dist/diversion-policy.js';
import {initialiseCells,cellInventory} from '../dist/traffic-cells.js';
import {defaultDemands} from '../dist/traffic.js';
import {junctionMovements} from '../dist/junction-movements.js';
import {buildRampConnections} from '../dist/interchange.js';
const routes=makeCorridors(networkData.roads,networkData.ramps),{exits}=networkData;
function closure(path,from,to){
 const js=diversionJunctions(path,exits,routes[path]),a=js.find(j=>j.ref===from),b=js.find(j=>j.ref===to);
 const at=(a.metre+b.metre)/2,laneCount=path.startsWith('A48')?2:3;
 return {id:'policy-'+path,kind:'closure',pathKey:path,point:routeSlice(routes[path],at,at+2)[0],
  laneCount,closedLanes:Array.from({length:laneCount},(_,i)=>i),createdAt:'2026-10-23T10:00:00Z',
  settings:{lengthM:200,speedKmh:0,shoulder:'blocked'}};
}
function prepare(event){return automaticDiversions([event],routes,exits,{}).map(option=>{
 const config={id:option.key,path:option.path,fromM:option.from.metre,toM:option.to.metre,eventId:event.id,
  geometry:bundledDetourGeometry(option.key,option.path,option.from,option.to,exits),exitsNetwork:isNetworkDestination(option.to)};
 return {config,state:emptyDetour(config)};
});}

test('a new formal closure actually diverts ONLY the last AS, in both A3 and A48 directions',()=>{
 for(const [path,from,to] of [['A3-koeln','38','37'],['A3-frankfurt','41','42'],['A48-dernbach','11','12'],['A48-koblenz','11','10']]){
  const event=closure(path,from,to),entries=prepare(event),demands=defaultDemands();
  const cells=Object.fromEntries(['A3-koeln','A3-frankfurt','A48-dernbach','A48-koblenz'].map(p=>[p,initialiseCells(routes[p],demands[p])]));
  const next=advanceRoutedNetwork(cells,routes,[event],demands,exits,entries);
  const used=next.detours.filter(d=>d.state.lastDeparture>1e-6);
  assert.equal(used.length,1,path);assert.equal(used[0].config.geometry.sourceExitRef,from);
  assert.equal(used[0].desiredPercent,100);
  assert.ok(next.detours.filter(d=>d!==used[0]).every(d=>d.desiredPercent===0&&d.state.admittedTotal===0),path);
  for(const opposite of Object.keys(cells).filter(p=>p!==path))assert.equal(next.cells[opposite].divertedTotal,0);
  const actual=next.detours.map(d=>({path,fromM:d.config.fromM,toM:d.config.toM,eventId:event.id,
   desiredPercent:d.desiredPercent,outVph:d.state.lastDeparture*60,inVph:0,vehiclesOnDetour:detourVehicles(d.state),waitingAtReentry:0}));
  const displayed=junctionMovements(path,routes[path],exits,[event],0,actual);
  assert.deepEqual(displayed.filter(r=>r.desiredPercent>0).map(r=>r.exit.ref),[from]);
 }
});
test('earlier exits start one by one as the real mandatory-exit queue grows, without an elapsed-closure clock',()=>{
 const path='A3-koeln',event=closure(path,'38','37'),entries=prepare(event),demands=defaultDemands();
 const cells={[path]:initialiseCells(routes[path],demands[path])},gate=closureGate(routes[path],event,exits);
 const nearest=entries.find(d=>Math.abs(d.config.fromM-gate.metre)<25);
 const early=entries.filter(d=>d!==nearest).sort((a,b)=>b.config.fromM-a.config.fromM);
 assert.deepEqual(early.map(d=>d.config.geometry.sourceExitRef),['40','41','42','43']);
 const firstUse=[];
 for(let minutes=0;minutes<=240;minutes++){
  nearest.state.waitingRoad=minutes*nearest.config.geometry.roadCapacityVph/60;
  for(let i=0;i<early.length;i++){
   const choice=routedDiversionChoice(early[i],entries,cells,routes,[event],exits,demands);
   assert.equal(choice.mandatory,false);assert.equal(choice.upstreamRank,i+1);
   if(choice.percent>0&&firstUse[i]===undefined)firstUse[i]=minutes;
  }
 }
 assert.ok(firstUse.every(Number.isFinite));assert.ok(firstUse[0]>=45);
 assert.ok(firstUse.every((n,i)=>!i||n>firstUse[i-1]),JSON.stringify(firstUse));
 // Minutes of simulation alone cannot make remote exits mandatory.
 nearest.state.waitingRoad=0;cells[path].minute=10000;
 assert.ok(early.every(d=>routedDiversionChoice(d,entries,cells,routes,[event],exits,demands).percent===0));
});
test('zero speed at the closed gate does not turn a short queue into 100 percent at every earlier exit',()=>{
 const path='A3-koeln',event=closure(path,'38','37'),entries=prepare(event),demands=defaultDemands();
 const grid=initialiseCells(routes[path],demands[path]),gate=closureGate(routes[path],event,exits);
 const cell=grid.cells.find(c=>c.fromM<gate.metre&&c.toM>=gate.metre);
 cell.speedKmh=0;cell.vehicles+=8;
 for(const entry of entries){
  const choice=routedDiversionChoice(entry,entries,{[path]:grid},routes,[event],exits,demands);
  assert.equal(choice.percent,Math.abs(entry.config.fromM-gate.metre)<=25?100:0);
 }
});
test('a long live closure recruits the previous AS before distant exits and conserves cars',()=>{
 const path='A3-koeln',event=closure(path,'38','37'),demands={...defaultDemands(),[path]:3800};
 let entries=prepare(event),cells={[path]:initialiseCells(routes[path],3800)};
 const initial=cellInventory(cells[path]);let firstPrevious=null,firstDistant=null;
 for(let t=0;t<100;t++){
  const next=advanceRoutedNetwork(cells,routes,[event],demands,exits,entries);cells=next.cells;entries=next.detours;
  const previous=entries.find(d=>d.config.geometry.sourceExitRef==='40');
  const distant=entries.filter(d=>['41','42','43'].includes(d.config.geometry.sourceExitRef));
  if(previous.state.lastDeparture>0&&firstPrevious===null)firstPrevious=t;
  if(distant.some(d=>d.state.lastDeparture>0)&&firstDistant===null)firstDistant=t;
  if(t<5)assert.ok(entries.filter(d=>d.config.geometry.sourceExitRef!=='38').every(d=>d.state.admittedTotal===0));
  const completed=entries.reduce((n,d)=>n+(d.state.exitedNetworkTotal??0),0);
  const total=cellInventory(cells[path])+entries.reduce((n,d)=>n+detourVehicles(d.state),0);
  assert.ok(Math.abs(total+cells[path].exitedTotal+completed-initial-cells[path].offeredTotal)<1e-5);
 }
 assert.ok(firstPrevious!==null&&firstPrevious>5);assert.ok(firstDistant===null||firstDistant>firstPrevious);
});
test('a full-lane accident has no mandatory 100-percent exit; lifting a closure removes the obligation',()=>{
 const path='A3-koeln',closed=closure(path,'38','37'),entries=prepare(closed),demands=defaultDemands();
 const cells={[path]:initialiseCells(routes[path],demands[path])};
 for(const timeline of [[{...closed,kind:'accident'}],[]]){
  for(const entry of entries){const choice=routedDiversionChoice(entry,entries,cells,routes,timeline,exits,demands);
   assert.equal(choice.mandatory,false);assert.equal(choice.percent,0);}
 }
 assert.equal(earlierExitPercent(45,1),0);assert.ok(earlierExitPercent(75,1)>earlierExitPercent(75,2));
});

test('A48 alternatives for an A3 closure are voluntary and ordered Höhr, Bendorf, Koblenz-Nord',()=>{
 const path='A3-frankfurt',source='A48-dernbach',event=closure(path,'40','41'),demands=defaultDemands();
 const merge=buildRampConnections(networkData.ramps,routes).find(c=>c.rampId==='ramp-a48-to-frankfurt');
 const gate=closureGate(routes[path],event,exits),target=diversionJunctions(path,exits,routes[path]).find(j=>j.ref==='41');
 const grid=initialiseCells(routes[path],demands[path]);
 for(const c of grid.cells)if(c.fromM<gate.metre&&c.toM>merge.downstreamMergeM){
  c.vehicles=260*(c.toM-c.fromM)/1000;c.densityVehKm=260;c.speedKmh=2;c.flowVph=520;
 }
 const entries=diversionJunctions(source,exits,routes[source]).filter(j=>!j.isInterchange).map(from=>{
  const id='cross-'+from.ref,config={id,path:source,targetPath:path,fromM:from.metre,toM:target.metre,
   sourceEndM:merge.rampEntryM,targetEntryM:merge.downstreamMergeM,eventId:event.id,
   geometry:bundledDetourGeometry(id,source,from,target,exits)};
  return {config,state:emptyDetour(config)};
 });
 const cells={[source]:initialiseCells(routes[source],demands[source]),[path]:grid};
 const choices=entries.map(entry=>routedDiversionChoice(entry,entries,cells,routes,[event],exits,demands)).reverse();
 assert.deepEqual(choices.map(c=>c.upstreamRank),[1,2,3]);assert.ok(choices.every(c=>!c.mandatory));
 assert.ok(choices[0].percent>choices[1].percent&&choices[1].percent>choices[2].percent);
});
