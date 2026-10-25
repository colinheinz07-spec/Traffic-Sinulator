/** Time loss ahead of an AS triggers voluntary diversion from 45 minutes.
 * Every prepared bypass compares that remaining motorway delay with its
 * own extra journey. Queue position never unlocks an earlier exit.
 */
import type {Exit,RoadId} from './core.js';
import type {SimEvent} from './events.js';
import type {DetourConfig,DetourState} from './detour-flow.js';
import type {CellRouteState} from './traffic-cells.js';
import type {PathKey} from './traffic.js';
import {closureGate,positionM,type Corridor} from './spatial.js';
import {diversionJunctions,potentialDiversionPercent} from './diversions.js';
import {speedDelayInCells} from './speed-delay.js';
import {freeSpeedKmh} from './traffic-physics.js';

interface ChoiceRoute {config:DetourConfig;state:DetourState;enabled?:boolean}
export interface DiversionChoice {percent:number;mandatory:boolean;delayMin:number;upstreamRank:number}
/** A formal closure requires a working route at its exit even when that
 * route was paused for an earlier incident. A return inside the closed
 * section cannot serve as the mandatory route. */
export function requiredDiversionGate(config:DetourConfig,route:Corridor,
 events:readonly SimEvent[],exits:readonly Exit[]){
 if((config.targetPath??config.path)!==config.path)return null;
 for(const event of events){
  const gate=closureGate(route,event,exits);
  if(gate?.exit&&Math.abs(config.fromM-gate.metre)<=25&&
   (config.exitsNetwork||config.toM>=gate.endM-1))return gate;
 }
 return null;
}
/** Small uptake at 45 minutes, rising with delay. A costly/full bypass
 * reduces willingness. Neither incident age nor a blocked-speed flag is
 * interpreted as infinite delay or as a mandatory off-ramp movement.
 */
export function voluntaryDiversionPercent(delayMin:number,extraMinutes=0):number{
 if(delayMin<45-1e-9||!Number.isFinite(delayMin))return 0;
 delayMin=Math.max(45,delayMin);
 const saving=Math.max(0,delayMin-Math.max(0,extraMinutes))/delayMin;
 return Math.round((potentialDiversionPercent(delayMin,false)??0)*saving*10)/10;
}
function excessQueue(state:CellRouteState,fromM:number,toM:number,demandVph:number):number{
 const freeDensity=demandVph/freeSpeedKmh(state.pathKey);let vehicles=0;
 for(const cell of state.cells){
  const length=Math.max(0,Math.min(toM,cell.toM)-Math.max(fromM,cell.fromM));
  if(length<=0||cell.speedKmh>65)continue;
  vehicles+=Math.max(0,cell.vehicles-freeDensity*(cell.toM-cell.fromM)/1000)*length/(cell.toM-cell.fromM);
 }
 return vehicles;
}
export function routedDiversionChoice(entry:ChoiceRoute,entries:readonly ChoiceRoute[],
 cells:Readonly<Partial<Record<PathKey,CellRouteState>>>,routes:Readonly<Partial<Record<PathKey,Corridor>>>,
 events:readonly SimEvent[],exits:readonly Exit[],demands:Readonly<Partial<Record<PathKey,number>>>):DiversionChoice{
 const {config,state}=entry,path=config.path,target=config.targetPath??path;
 const source=cells[path],destination=cells[target],route=routes[path];
 if(!source||!destination||!route)throw Error('Umleitungsentscheidung ohne verbundenen Fahrbahnzustand');
 const event=events.find(e=>e.id===config.eventId),cross=target!==path;
 const gate=event?.kind==='closure'&&!cross?closureGate(route,event,exits):null;
 const mandatory=requiredDiversionGate(config,route,events,exits)!==null;
 if(mandatory){
  // Retain old route inventories, but admit new traffic to exactly one
  // usable route. If all were paused, the formal closure still exits cars.
  const preferred=entries.filter(e=>e.config.path===path&&
   Math.abs(e.config.fromM-config.fromM)<=25&&requiredDiversionGate(e.config,route,events,exits))
   .sort((a,b)=>Number(a.enabled===false)-Number(b.enabled===false)||
    b.config.toM-a.config.toM||a.config.id.localeCompare(b.config.id))[0];
  return {percent:preferred?.config.id===config.id?100:0,mandatory:true,delayMin:0,upstreamRank:0};
 }
 if(entry.enabled===false)return {percent:0,mandatory:false,delayMin:0,upstreamRank:0};
 const eventM=event&&event.pathKey===path?positionM(route,event.point):null;
 const approachEnd=gate?.metre??(cross?config.sourceEndM??route.lengthM:eventM??config.toM);
 const upstreamRank=route.key.startsWith('ramp-')?0:diversionJunctions(path as RoadId,exits,route)
  .filter(j=>!j.isInterchange&&j.metre>config.fromM+25&&j.metre<=approachEnd+25).length+1;
 const eligible=config.fromM<=approachEnd+25;
 // Only time still ahead can be avoided by leaving or by declining to
 // enter here. Moving the tail across any AS must not change eligibility
 // or add delay already spent behind the driver's current position.
 const decisionFrom=config.fromM;
 if(gate&&config.fromM<gate.metre){
  const normal=entries.find(e=>e.enabled!==false&&e.config.path===path&&e.config.eventId===config.eventId&&
   (e.config.targetPath??path)===path&&Math.abs(e.config.fromM-gate.metre)<=25);
  const service=Math.max(1,Math.min(1200,normal?.config.geometry.roadCapacityVph??config.geometry.roadCapacityVph));
  const measured=speedDelayInCells(source,decisionFrom,Math.min(route.lengthM,gate.metre+source.cellM));
  const approachWait=measured.diversionExitRef&&!measured.blocked?measured.delayMin:
   excessQueue(source,decisionFrom,gate.metre,demands[path]??0)/service*60;
  const offRampWait=normal?(normal.state.waitingRoad+normal.state.waitingMerge)/service*60:0;
  const normalFree=(gate.metre-config.fromM)/1000/freeSpeedKmh(path)*60+
   (normal?.config.geometry.freeMinutes??0);
  const ownWait=(state.waitingRoad+state.waitingMerge)/Math.max(1,config.geometry.roadCapacityVph)*60;
  const extra=Math.max(0,config.geometry.freeMinutes-normalFree)+ownWait;
  // The working mandatory exit is the reference, not the prohibited road.
  const delayMin=approachWait+offRampWait;
  return {percent:eligible?voluntaryDiversionPercent(delayMin,extra):0,mandatory:false,delayMin,upstreamRank};
 }
 const sourceEnd=cross?config.sourceEndM??route.lengthM:config.toM;
 const first=speedDelayInCells(source,decisionFrom,sourceEnd);
 const last=cross?speedDelayInCells(destination,config.targetEntryM??0,config.toM):null;
 const service=Math.max(1,Math.min(1200,config.geometry.roadCapacityVph));
 const queueWait=(excessQueue(source,decisionFrom,sourceEnd,demands[path]??0)+
  (cross?excessQueue(destination,config.targetEntryM??0,config.toM,demands[target]??0):0))/service*60;
 // The visible motorway estimate is the 45-minute decision input. A
 // side-road service rate must not inflate it and recruit cars earlier.
 const visibleDelay=first.delayMin+(last?.delayMin??0);
 const delayMin=first.blocked||last?.blocked?Math.max(visibleDelay,queueWait):visibleDelay;
 const motorwayFree=cross?(sourceEnd-config.fromM)/1000/freeSpeedKmh(path)*60+
  (config.toM-(config.targetEntryM??0))/1000/freeSpeedKmh(target)*60:
  (config.toM-config.fromM)/1000/freeSpeedKmh(path)*60;
 const extra=Math.max(0,config.geometry.freeMinutes-motorwayFree)+
  (state.waitingRoad+state.waitingMerge)/service*60;
 return {percent:eligible?voluntaryDiversionPercent(delayMin,extra):0,mandatory:false,delayMin,upstreamRank};
}
