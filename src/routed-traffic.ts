/** Motorway cells and multiple verified local routes share ONE vehicle budget.
 * Side-road admission is limited by cars reaching the real exit cell; cars
 * return only after their local journey and when the merge accepts them.
 */
import {advanceCells,cellInventory,type CellRouteState,type CellDetourPort} from './traffic-cells.js';
import {advanceDetour,detourVehicles,type DetourConfig,type DetourState} from './detour-flow.js';
import {potentialDiversionPercent} from './diversions.js';
import {speedDelayInCells} from './speed-delay.js';
import {freeSpeedKmh} from './traffic-physics.js';
import type {Corridor} from './spatial.js';
import type {Exit} from './core.js';
import type {SimEvent} from './events.js';
import type {PathKey} from './traffic.js';
import type {SpatialTransfer} from './spatial.js';

export interface RoutedDetour {config:DetourConfig;state:DetourState;enabled?:boolean;desiredPercent?:number}
export function detourReadyToReturn(state:DetourState,minute:number):number{
 return state.waitingMerge+state.transit.filter(x=>x.minute<=minute).reduce((n,x)=>n+x.vehicles,0);
}
export function advanceRoutedPath(previous:CellRouteState,route:Corridor,
 events:readonly SimEvent[],demandVph:number,exits:readonly Exit[],detours:readonly RoutedDetour[]){
 const ports:CellDetourPort[]=detours.map(({config,state,enabled})=>{
  const event=events.find(e=>e.id===config.eventId&&e.pathKey===route.key);
  const time=speedDelayInCells(previous,config.fromM,config.toM);
  const motorwayFree=(config.toM-config.fromM)/1000/freeSpeedKmh(route.key)*60;
  const localQueue=state.waitingRoad/Math.max(1,config.geometry.roadCapacityVph)*60;
  const extra=Math.max(0,config.geometry.freeMinutes-motorwayFree)+localQueue;
  const wanted=enabled===false?0:event?.kind==='closure'||time.blocked?100:
   potentialDiversionPercent(Math.max(0,time.delayMin-extra),false)??0;
  const storage=Math.max(80,config.geometry.lengthKm*90);
  return {id:config.id,fromM:config.fromM,toM:config.toM,interestPercent:wanted,
   exitCapacityVph:Math.min(1200,Math.max(0,storage-detourVehicles(state))*60),
   returnVehicles:detourReadyToReturn(state,previous.minute)};
 });
 const cells=advanceCells(previous,route,events,demandVph,exits,ports);
 const updated=detours.map(entry=>{
  const actual=cells.lastTransfers!.find(x=>x.id===entry.config.id)!;
  const flow=advanceDetour(entry.state,entry.config,previous.minute,
   actual.leaveVpm*60,100,actual.joinVpm*60);
  if(Math.abs(flow.entered-actual.leaveVpm)>1e-6||Math.abs(flow.rejoined-actual.joinVpm)>1e-6)
   throw Error('Hauptfahrbahn und Umleitung widersprechen sich beim Fahrzeugtransfer');
  return {...entry,state:flow.state,desiredPercent:ports.find(p=>p.id===entry.config.id)!.interestPercent};
 });
 const before=cellInventory(previous)+detours.reduce((n,e)=>n+detourVehicles(e.state),0);
 const after=cellInventory(cells)+updated.reduce((n,e)=>n+detourVehicles(e.state),0);
 const expected=before+(cells.offeredTotal-previous.offeredTotal)-(cells.exitedTotal-previous.exitedTotal);
 if(Math.abs(after-expected)>1e-5*Math.max(1,expected))throw Error('Gemeinsame Hauptfahrbahn-/Umleitungsbilanz verletzt');
 return {cells,detours:updated,transfers:cells.lastTransfers!.map((x,i)=>({
  ...x,path:route.key,fromM:detours[i]!.config.fromM,toM:detours[i]!.config.toM
 }))};
}
/** Network variant also supports leaving A48 and returning on A3 (or the
 * reverse) via a verified side-road route that bypasses AD Dernbach.
 */
export function advanceRoutedNetwork(previous:Partial<Record<PathKey,CellRouteState>>,
 routes:Readonly<Record<PathKey,Corridor>>,events:readonly SimEvent[],
 demands:Readonly<Record<PathKey,number>>,exits:readonly Exit[],detours:readonly RoutedDetour[]){
 const ports=new Map<PathKey,CellDetourPort[]>();
 const add=(path:PathKey,port:CellDetourPort)=>ports.set(path,[...(ports.get(path)??[]),port]);
 for(const entry of detours){
  const {config,state,enabled}=entry,target=config.targetPath??config.path;
  const sourceGrid=previous[config.path],targetGrid=previous[target];
  if(!sourceGrid||!targetGrid)throw Error('Umleitung hat keinen verbundenen Fahrbahnzustand');
  const cross=target!==config.path;
  const first=speedDelayInCells(sourceGrid,config.fromM,cross?config.sourceEndM??Infinity:config.toM);
  const last=cross?speedDelayInCells(targetGrid,config.targetEntryM??0,config.toM):null;
  const lost=first.delayMin+(last?.delayMin??0),blocked=first.blocked||last?.blocked;
  const free=cross?((config.sourceEndM??routes[config.path].lengthM)-config.fromM)/1000/freeSpeedKmh(config.path)*60+
   (config.toM-(config.targetEntryM??0))/1000/freeSpeedKmh(target)*60:
   (config.toM-config.fromM)/1000/freeSpeedKmh(config.path)*60;
  const roadQueue=state.waitingRoad/Math.max(1,config.geometry.roadCapacityVph)*60;
  const extra=Math.max(0,config.geometry.freeMinutes-free)+roadQueue;
  const closed=events.some(e=>e.id===config.eventId&&e.kind==='closure');
  const interest=enabled===false?0:closed||blocked?100:potentialDiversionPercent(Math.max(0,lost-extra),false)??0;
  const capacity=Math.min(1200,Math.max(0,Math.max(80,config.geometry.lengthKm*90)-detourVehicles(state))*60);
  add(config.path,{id:config.id,fromM:config.fromM,toM:cross?null:config.toM,
   interestPercent:interest,exitCapacityVph:capacity,returnVehicles:cross?0:detourReadyToReturn(state,sourceGrid.minute)});
  if(cross)add(target,{id:config.id,fromM:null,toM:config.toM,interestPercent:0,
   exitCapacityVph:0,returnVehicles:detourReadyToReturn(state,targetGrid.minute)});
 }
 const cells:Partial<Record<PathKey,CellRouteState>>={};
 for(const key of Object.keys(previous) as PathKey[])
  cells[key]=advanceCells(previous[key]!,routes[key],events,demands[key],exits,ports.get(key)??[]);
 const transfers:SpatialTransfer[]=[];
 const updated=detours.map(entry=>{
  const {config}=entry,target=config.targetPath??config.path,cross=target!==config.path;
  const left=cells[config.path]!.lastTransfers!.find(x=>x.id===config.id)?.leaveVpm??0;
  const joined=cells[target]!.lastTransfers!.find(x=>x.id===config.id)?.joinVpm??0;
  const result=advanceDetour(entry.state,config,previous[config.path]!.minute,left*60,100,joined*60);
  if(Math.abs(result.entered-left)>1e-6||Math.abs(result.rejoined-joined)>1e-6)
   throw Error('Vernetzte Umleitung hat Fahrzeuge dupliziert oder verloren');
  transfers.push({id:config.id,path:config.path,fromM:config.fromM,
   toM:cross?routes[config.path].lengthM:config.toM,leaveVpm:left,joinVpm:cross?0:joined});
  if(cross)transfers.push({id:config.id+':return',path:target,fromM:0,toM:config.toM,leaveVpm:0,joinVpm:joined});
  return {...entry,state:result.state,desiredPercent:ports.get(config.path)!.find(p=>p.id===config.id)!.interestPercent};
 });
 let before=detours.reduce((n,e)=>n+detourVehicles(e.state),0),after=updated.reduce((n,e)=>n+detourVehicles(e.state),0),arrived=0,left=0;
 for(const key of Object.keys(cells) as PathKey[]){
  before+=cellInventory(previous[key]!);after+=cellInventory(cells[key]!);
  arrived+=cells[key]!.offeredTotal-previous[key]!.offeredTotal;
  left+=cells[key]!.exitedTotal-previous[key]!.exitedTotal;
 }
 if(Math.abs(after-before-arrived+left)>1e-5*Math.max(1,after))throw Error('Gemeinsame A3/A48-/Umleitungsbilanz verletzt');
 return {cells,detours:updated,transfers};
}
