/** Route choice is separate from route availability. A formal closure has
 * exactly one mandatory local exit on its own carriageway. Earlier exits
 * become attractive in stages as the queue at that exit actually grows.
 */
import type {Exit} from './core.js';
import type {SimEvent} from './events.js';
import type {DetourConfig,DetourState} from './detour-flow.js';
import type {CellRouteState} from './traffic-cells.js';
import type {PathKey} from './traffic.js';
import {closureGate,type Corridor} from './spatial.js';
import {diversionJunctions,potentialDiversionPercent} from './diversions.js';
import {speedDelayInCells} from './speed-delay.js';
import {freeSpeedKmh} from './traffic-physics.js';

interface ChoiceRoute {config:DetourConfig;state:DetourState;enabled?:boolean}
export interface DiversionChoice {percent:number;mandatory:boolean;delayMin:number;upstreamRank:number}
/** Forty-five minutes before the previous exit starts to become attractive;
 * each further AS needs another fifteen minutes of net queue disadvantage.
 * These are explicit simulator assumptions, not measured driver statistics.
 */
export function earlierExitPercent(delayMin:number,upstreamRank:number,extraMinutes=0):number{
 const threshold=45+15*Math.max(0,upstreamRank-1);
 return potentialDiversionPercent(Math.max(0,delayMin-Math.max(0,extraMinutes)-threshold),false)??0;
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
 const mandatory=!!gate?.exit&&Math.abs(config.fromM-gate.metre)<=25;
 if(entry.enabled===false)return {percent:0,mandatory,delayMin:0,upstreamRank:0};
 if(mandatory)return {percent:100,mandatory:true,delayMin:0,upstreamRank:0};
 if(gate&&config.fromM<gate.metre){
  const normal=entries.find(e=>e.enabled!==false&&e.config.path===path&&e.config.eventId===config.eventId&&
   (e.config.targetPath??path)===path&&Math.abs(e.config.fromM-gate.metre)<=25);
  const service=Math.max(1,Math.min(1200,normal?.config.geometry.roadCapacityVph??config.geometry.roadCapacityVph));
  const approachWait=excessQueue(source,config.fromM,gate.metre,demands[path]??0)/service*60;
  const offRampWait=normal?(normal.state.waitingRoad+normal.state.waitingMerge)/service*60:0;
  // Compare with reaching the mandatory exit and taking its bypass, never
  // with driving through the prohibited carriageway (which has no ETA).
  const normalFree=(gate.metre-config.fromM)/1000/freeSpeedKmh(path)*60+
   (normal?.config.geometry.freeMinutes??0);
  const ownWait=(state.waitingRoad+state.waitingMerge)/Math.max(1,config.geometry.roadCapacityVph)*60;
  const extra=Math.max(0,config.geometry.freeMinutes-normalFree)+ownWait;
  const upstreamRank=Math.max(1,diversionJunctions(path,exits,route).filter(j=>!j.isInterchange&&
   j.metre>config.fromM+25&&j.metre<=gate.metre+25).length);
  // The closed motorway gate has zero through-speed by definition. Its
  // inverse speed is not the wait for taking the working off-ramp.
  const delayMin=approachWait+offRampWait;
  return {percent:earlierExitPercent(delayMin,upstreamRank,extra),mandatory:false,delayMin,upstreamRank};
 }
 const sourceEnd=cross?config.sourceEndM??route.lengthM:config.toM;
 const first=speedDelayInCells(source,config.fromM,sourceEnd);
 const last=cross?speedDelayInCells(destination,config.targetEntryM??0,config.toM):null;
 const service=Math.max(1,Math.min(1200,config.geometry.roadCapacityVph));
 const queueWait=(excessQueue(source,config.fromM,sourceEnd,demands[path]??0)+
  (cross?excessQueue(destination,config.targetEntryM??0,config.toM,demands[target]??0):0))/service*60;
 const delayMin=Math.max(first.delayMin+(last?.delayMin??0),queueWait);
 const motorwayFree=cross?(sourceEnd-config.fromM)/1000/freeSpeedKmh(path)*60+
  (config.toM-(config.targetEntryM??0))/1000/freeSpeedKmh(target)*60:
  (config.toM-config.fromM)/1000/freeSpeedKmh(path)*60;
 const extra=Math.max(0,config.geometry.freeMinutes-motorwayFree)+
  (state.waitingRoad+state.waitingMerge)/service*60;
 // A block, or an accident affecting every lane, does not make every
 // remote exit mandatory. Cross-motorway alternatives are voluntary too.
 const upstreamRank=cross?1+diversionJunctions(path,exits,route).filter(j=>!j.isInterchange&&
  j.metre>config.fromM+25&&j.metre<sourceEnd-25).length:0;
 const percent=event?.kind==='closure'?earlierExitPercent(delayMin,Math.max(1,upstreamRank),extra):
  potentialDiversionPercent(Math.max(0,delayMin-extra),false)??0;
 return {percent,mandatory:false,delayMin,upstreamRank};
}
