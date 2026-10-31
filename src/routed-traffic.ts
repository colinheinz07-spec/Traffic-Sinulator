import {localRoadAvailability} from './calendar-traffic.js';
/** Motorway cells and multiple local simulator routes share ONE vehicle budget.
 * Side-road admission is limited by cars reaching the real exit cell; cars
 * return only after their local journey and when the merge accepts them.
 */
import {advanceCells,cellInventory,type CellRouteState,type CellDetourPort} from './traffic-cells.js';
import {advanceDetour,detourVehicles,detourStorage,type DetourConfig,type DetourState} from './detour-flow.js';
import {routedDiversionChoice,requiredDiversionGate} from './diversion-policy.js';
import type {Corridor} from './spatial.js';
import type {Exit} from './core.js';
import type {SimEvent} from './events.js';
import type {PathKey} from './traffic.js';
import type {SpatialTransfer} from './spatial.js';
import {journeyRampCapacity,journeyTrafficShare} from './interchange-journeys.js';
import {interchangeTrafficShare} from './interchange.js';
import {normalJunctionTraffic} from './junction-traffic.js';

export interface RoutedDetour {config:DetourConfig;state:DetourState;enabled?:boolean;desiredPercent?:number}
/** The remaining legacy turn solver must not offer a second copy of trips
 * that chose a side-road/alternate-ramp journey. Existing ramp inventories
 * remain in that solver and finish normally when their control permits it. */
export function remainingInterchangeDemands(demands:Readonly<Record<PathKey,number>>,
 entries:readonly RoutedDetour[],events:readonly SimEvent[]):Record<PathKey,number>{
 const result={...demands};
 for(const id of Object.keys(demands).filter(k=>k.startsWith('ramp-')) as PathKey[]){
  let avoided=0,owned=0;
  for(const entry of entries.filter(e=>e.config.movementId===id)){
   const j=entry.config.journey;
   if(j?.kind==='continuation')continue;
   if(j?.kind==='protected'){
    if(entry.enabled!==false&&events.some(e=>e.id===j.closureEventId))owned=demands[id];
    else owned=Math.max(owned,entry.state.lastDeparture*60);
    continue;
   }
   const target=j?.kind==='via'?j.targetPath:entry.config.targetPath;
   if(!target)continue;
   const share=journeyTrafficShare(entry.config,demands);
   if(share>0)avoided=Math.max(avoided,Math.min(1,(entry.desiredPercent??0)/100/share));
  }
  result[id]=Math.max(0,demands[id]-Math.max(demands[id]*avoided,owned));
 }
 return result;
}
/** Progressive fair service over the retained directional side-road
 * sections. Two destinations using Höhr–Ransbach do not each get a fresh
 * copy of that road's capacity. Old trips continue when a route is paused. */
function sharedRoadService(entries:readonly RoutedDetour[],departures:ReadonlyMap<string,number>):Map<string,number>{
 const demand=entries.map(e=>Math.min(e.config.geometry.roadCapacityVph,
  (e.state.waitingRoad+(departures.get(e.config.id)??0))*60));
 const resources=new Map<string,{capacity:number;users:number[];used:number}>();
 entries.forEach((e,i)=>{
  const sections=[{id:'route:'+e.config.id,capacityVph:e.config.geometry.roadCapacityVph},
   ...(e.config.geometry.sections??[])];
  for(const s of sections){
   const key=s.id.startsWith('route:')?s.id:'road:'+s.id;
   const old=resources.get(key);
   if(old){old.capacity=Math.min(old.capacity,s.capacityVph);old.users.push(i);}
   else resources.set(key,{capacity:s.capacityVph,users:[i],used:0});
  }
 });
 const allocated=entries.map(()=>0),active=new Set(demand.map((v,i)=>v>1e-9?i:-1).filter(i=>i>=0));
 while(active.size){
  let increment=Math.min(...[...active].map(i=>demand[i]!-allocated[i]!));
  for(const r of resources.values()){
   const count=r.users.filter(i=>active.has(i)).length;
   if(count)increment=Math.min(increment,Math.max(0,r.capacity-r.used)/count);
  }
  for(const i of active)allocated[i]+=increment;
  for(const r of resources.values())r.used+=increment*r.users.filter(i=>active.has(i)).length;
  const full=new Set<number>();
  for(const r of resources.values())if(r.capacity-r.used<1e-8)for(const i of r.users)full.add(i);
  const before=active.size;
  for(const i of active)if(demand[i]!-allocated[i]!<1e-8||full.has(i))active.delete(i);
  if(active.size===before)throw Error('Gemeinsame Nebenstraßenkapazität konnte nicht verteilt werden');
 }
 return new Map(entries.map((e,i)=>[e.config.id,allocated[i]!]));
}
export function detourReadyToReturn(state:DetourState,minute:number):number{
 return state.waitingMerge+state.transit.filter(x=>x.minute<=minute).reduce((n,x)=>n+x.vehicles,0);
}
export function advanceRoutedPath(previous:CellRouteState,route:Corridor,
 events:readonly SimEvent[],demandVph:number,exits:readonly Exit[],detours:readonly RoutedDetour[]){
 const ports:CellDetourPort[]=detours.map(entry=>{
  const {config,state}=entry;
  const wanted=routedDiversionChoice(entry,detours,{[route.key]:previous},{[route.key]:route},
   events,exits,{[route.key]:demandVph}).percent;
  const storage=detourStorage(config);
  return {id:config.id,fromM:config.fromM,toM:config.exitsNetwork?null:config.toM,interestPercent:wanted,
   exitCapacityVph:Math.max(0,storage-detourVehicles(state))*60,
   returnVehicles:config.exitsNetwork?0:detourReadyToReturn(state,previous.minute)};
 });
 const cells=advanceCells(previous,route,events,demandVph,exits,ports);
 const roadService=sharedRoadService(detours,new Map(cells.lastTransfers!.map(t=>[t.id,t.leaveVpm])));
 const updated=detours.map(entry=>{
  const actual=cells.lastTransfers!.find(x=>x.id===entry.config.id)!;
  const flow=advanceDetour(entry.state,entry.config,previous.minute,
   actual.leaveVpm*60,100,actual.joinVpm*60,roadService.get(entry.config.id));
  if(Math.abs(flow.entered-actual.leaveVpm)>1e-6||Math.abs(flow.rejoined-actual.joinVpm)>1e-6)
   throw Error('Hauptfahrbahn und Umleitung widersprechen sich beim Fahrzeugtransfer');
  const desiredPercent=ports.find(p=>p.id===entry.config.id)!.interestPercent;
  return {...entry,state:{...flow.state,choicePercent:desiredPercent},desiredPercent};
 });
 const before=cellInventory(previous)+detours.reduce((n,e)=>n+detourVehicles(e.state),0);
 const after=cellInventory(cells)+updated.reduce((n,e)=>n+detourVehicles(e.state),0);
 const networkExits=updated.reduce((n,e,i)=>n+(e.state.exitedNetworkTotal??0)-(detours[i]!.state.exitedNetworkTotal??0),0);
 const expected=before+(cells.offeredTotal-previous.offeredTotal)-(cells.exitedTotal-previous.exitedTotal)-networkExits;
 if(Math.abs(after-expected)>1e-5*Math.max(1,expected))throw Error('Gemeinsame Hauptfahrbahn-/Umleitungsbilanz verletzt');
 return {cells,detours:updated,transfers:cells.lastTransfers!.map((x,i)=>({
  ...x,path:route.key,fromM:detours[i]!.config.fromM,toM:detours[i]!.config.toM
 }))};
}
/** Network variant also supports leaving A48 and returning on A3 (or the
 * reverse) via a side-road route that bypasses AD Dernbach.
 */
export function advanceRoutedNetwork(previous:Partial<Record<PathKey,CellRouteState>>,
 routes:Readonly<Record<PathKey,Corridor>>,events:readonly SimEvent[],
 demands:Readonly<Record<PathKey,number>>,exits:readonly Exit[],detours:readonly RoutedDetour[],
 turnDelays:Readonly<Partial<Record<PathKey,number>>>={},moment?:Date){
 const ports=new Map<PathKey,CellDetourPort[]>();
 const intentions=new Map<string,number>();
 const localOffers=new Map<PathKey,ReturnType<typeof normalJunctionTraffic>>();
 const add=(path:PathKey,port:CellDetourPort)=>ports.set(path,[...(ports.get(path)??[]),port]);
 for(const entry of detours){
  const {config,state}=entry,target=config.targetPath??config.path;
  const sourceGrid=previous[config.path],targetGrid=previous[target];
  if(!sourceGrid||!targetGrid)throw Error('Umleitung hat keinen verbundenen Fahrbahnzustand');
  const cross=target!==config.path;
  const interest=routedDiversionChoice(entry,detours,previous,routes,events,exits,demands,turnDelays).percent;
  intentions.set(config.id,interest);
  const journey=config.journey,motorway=journey?.kind==='via'||journey?.kind==='protected'||journey?.kind==='evacuation';
  const committed=journey&&journey.kind!=='closure-bypass'?journey:undefined;
  const roadLimit=journeyRampCapacity(config,events,demands);
  const rampSiblings=motorway?detours.filter(e=>{
   const j=e.config.journey;return (j?.kind==='via'||j?.kind==='protected'||j?.kind==='evacuation')&&j.rampId===journey.rampId;
  }):[];
  const rampRoom=motorway?Math.max(0,Math.min(...rampSiblings.map(e=>detourStorage(e.config)))-
   rampSiblings.reduce((n,e)=>n+detourVehicles(e.state),0))/rampSiblings.length:Infinity;
  const capacity=Math.min(motorway?1500:Infinity,Math.min(rampRoom,Math.max(0,detourStorage(config)-detourVehicles(state)))*60,
   motorway?roadLimit:Infinity);
  if(journey?.kind==='protected'&&!localOffers.has(config.path))
   localOffers.set(config.path,normalJunctionTraffic(routes[config.path],exits,demands[config.path]));
  const sourceOffers=demands[config.path]+(localOffers.get(config.path)??[])
   .filter(j=>j.metre<config.fromM).reduce((n,j)=>n+j.entryVph,0);
  const passage=journey?.kind==='protected'&&roadLimit>0&&entry.enabled!==false&&
   events.some(e=>e.id===journey.closureEventId&&e.kind==='closure')?{
   eventId:journey.closureEventId,vehicleClass:journey.token,
   sharePercent:sourceOffers>0?Math.min(1,demands[config.movementId!]/sourceOffers)*100:0}:undefined;
  const untilM=Math.max(1,Math.min(sourceGrid.cells.length-1,Math.round(config.fromM/sourceGrid.cellM)))*sourceGrid.cellM;
  const classifyAt=journey?.kind==='via'?{metre:journey.decisionM,sharePercent:interest,vehicleClass:journey.token,untilM}:
   passage?{metre:0,sharePercent:passage.sharePercent,vehicleClass:passage.vehicleClass,untilM}:
   journey?.kind==='evacuation'&&events.some(e=>e.id===journey.closureEventId&&e.kind==='closure')?
    {metre:Math.round(journey.gateM/sourceGrid.cellM)*sourceGrid.cellM,sharePercent:100,vehicleClass:journey.token,untilM,seedOnly:true}:undefined;
  const protectedExit=!config.movementId&&requiredDiversionGate(config,routes[config.path],events,exits)&&
   detours.some(e=>e.config.path===config.path&&e.config.journey?.kind==='protected'&&e.enabled!==false&&
    Math.abs(e.config.journey.gateM-config.fromM)<25&&journeyRampCapacity(e.config,events,demands)>0);
  add(config.path,{id:config.id,fromM:config.fromM,toM:cross||config.exitsNetwork?null:config.toM,
   interestPercent:committed||protectedExit?100:interest,vehicleClass:committed?.token,motorway,closurePassage:passage,classifyAt,
   exitCapacityVph:capacity,returnVehicles:cross||config.exitsNetwork?0:detourReadyToReturn(state,sourceGrid.minute)});
  if(cross&&!config.exitsNetwork)add(target,{id:config.id,fromM:null,toM:config.toM,interestPercent:0,
   returnClass:journey?.kind==='via'||journey?.kind==='protected'||journey?.kind==='evacuation'?journey.token:undefined,
   exitCapacityVph:0,returnVehicles:detourReadyToReturn(state,targetGrid.minute)});
 }
 // Route intentions are revisable until the physical motorway fork.
 // Release only the source-road tag, never cars already on the Köln ramp,
 // A3 Köln, or the Ransbach–Montabaur continuation. Inventories are intact.
 const sourceStates={...previous};
 for(const entry of detours){
  const j=entry.config.journey;
  if(j?.kind!=='via'||(intentions.get(entry.config.id)??0)>0||
   j.forcedByEventId&&events.some(e=>e.id===j.forcedByEventId&&e.kind==='closure'))continue;
  const grid=sourceStates[entry.config.path];if(!grid)continue;
  const without=(tags:Record<string,number>|undefined)=>{
   if(!tags?.[j.token])return tags;
   const copy={...tags};delete copy[j.token];return copy;
  };
  sourceStates[entry.config.path]={...grid,routedBacklog:without(grid.routedBacklog),
   cells:grid.cells.map(c=>c.fromM<entry.config.fromM?{...c,routedVehicles:without(c.routedVehicles)}:c),
   classifiedJourneys:grid.classifiedJourneys?.filter(token=>token!==j.token)};
 }
 const cells:Partial<Record<PathKey,CellRouteState>>={};
 for(const key of Object.keys(previous) as PathKey[])
  cells[key]=advanceCells(sourceStates[key]!,routes[key],events,demands[key],exits,ports.get(key)??[],
   normalJunctionTraffic(routes[key],exits,demands[key],moment));
 const effective=detours.map(e=>{
  const j=e.config.journey,motorway=j?.kind==='via'||j?.kind==='protected'||j?.kind==='evacuation';
  const factor=motorway?1:localRoadAvailability(moment);
  const capacity=motorway?journeyRampCapacity(e.config,events,demands):e.config.geometry.roadCapacityVph*factor;
  return {...e,config:{...e.config,geometry:{...e.config.geometry,roadCapacityVph:capacity,
   sections:e.config.geometry.sections?.map(s=>({...s,capacityVph:Math.min(s.capacityVph*factor,capacity)}))}}};
 });
 const roadService=sharedRoadService(effective,new Map(detours.map(e=>[e.config.id,
  cells[e.config.path]!.lastTransfers!.find(t=>t.id===e.config.id)?.leaveVpm??0])));
 const transfers:SpatialTransfer[]=[];
 const updated=detours.map(entry=>{
  const {config}=entry,target=config.targetPath??config.path,cross=target!==config.path;
  const left=cells[config.path]!.lastTransfers!.find(x=>x.id===config.id)?.leaveVpm??0;
  const joined=config.exitsNetwork?0:cells[target]!.lastTransfers!.find(x=>x.id===config.id)?.joinVpm??0;
  const serviceConfig=effective.find(e=>e.config.id===config.id)!.config;
  const result=advanceDetour(entry.state,serviceConfig,previous[config.path]!.minute,left*60,100,joined*60,roadService.get(config.id));
  if(Math.abs(result.entered-left)>1e-6||Math.abs(result.rejoined-joined)>1e-6)
   throw Error('Vernetzte Umleitung hat Fahrzeuge dupliziert oder verloren');
  transfers.push({id:config.id,path:config.path,fromM:config.fromM,
   toM:cross?routes[config.path].lengthM:config.toM,leaveVpm:left,joinVpm:cross?0:joined});
  if(cross&&!config.exitsNetwork)transfers.push({id:config.id+':return',path:target,fromM:0,toM:config.toM,leaveVpm:0,joinVpm:joined});
  const desiredPercent=intentions.get(config.id)!;
  return {...entry,state:{...result.state,choicePercent:desiredPercent},desiredPercent};
 });
 let before=detours.reduce((n,e)=>n+detourVehicles(e.state),0),after=updated.reduce((n,e)=>n+detourVehicles(e.state),0),arrived=0,left=0;
 for(const key of Object.keys(cells) as PathKey[]){
  before+=cellInventory(previous[key]!);after+=cellInventory(cells[key]!);
  arrived+=cells[key]!.offeredTotal-previous[key]!.offeredTotal;
  left+=cells[key]!.exitedTotal-previous[key]!.exitedTotal;
 }
 const networkExits=updated.reduce((n,e,i)=>n+(e.state.exitedNetworkTotal??0)-(detours[i]!.state.exitedNetworkTotal??0),0);
 if(Math.abs(after-before-arrived+left+networkExits)>1e-5*Math.max(1,after))throw Error('Gemeinsame A3/A48-/Umleitungsbilanz verletzt');
 return {cells,detours:updated,transfers};
}
