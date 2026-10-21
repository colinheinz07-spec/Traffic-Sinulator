/** Direction-specific entrance/exit situation for the A3/A48 simulator.
 * Targets are PLANNED route-choice percentages, not counted departures.
 * Counted values come only from validated, activated OSM detour ledgers.
 * Every normal AS is covered; AK/AD are separate motorway nodes and cannot
 * be misrepresented as exits onto local roads.
 */
import type {RoadId} from './core.js';
import type {Corridor} from './spatial.js';
import type {SimEvent} from './events.js';
import type {Exit} from './core.js';
import {positionM} from './spatial.js';
import {diversionJunctions,potentialDiversionPercent,type JunctionAnchor} from './diversions.js';

export interface JunctionMovement {
 path:RoadId;exit:JunctionAnchor;
 desiredPercent:number;mandatory:boolean;eventId:string|null;
 distanceBeforeClosureKm:number|null;
 outVph:number;inVph:number;vehiclesOnDetour:number;
 waitingAtReentry:number;validatedRouteActive:boolean;
}
export interface RealDetourFlow {
 path:RoadId;fromM:number;toM:number;eventId:string;
 outVph:number;inVph:number;vehiclesOnDetour:number;waitingAtReentry:number;
}
/** 100% is reserved for the LAST normal exit that can be reached before
 * a formal complete road closure. Earlier exits remain alternative choices
 * with unquantified demand unless a distinct incident affects their traffic.
 * The 100% value is the requested exit intention, never a claim that a
 * ramp can absorb an unlimited traffic stream.
 */
export function junctionMovements(path:RoadId,route:Corridor,exits:readonly Exit[],
 events:readonly SimEvent[],delayMin:number|null,real:readonly RealDetourFlow[]=[]):JunctionMovement[]{
 const junctions=diversionJunctions(path,exits,route);
 const rows=junctions.map((exit):JunctionMovement=>({
  path,exit,desiredPercent:0,mandatory:false,eventId:null,distanceBeforeClosureKm:null,
  outVph:0,inVph:0,vehiclesOnDetour:0,waitingAtReentry:0,validatedRouteActive:false
 }));
 for(const event of events.filter(x=>x.pathKey===path)){
  const at=positionM(route,event.point);
  if(at===null)continue;
  const upstream=rows.filter(r=>!r.exit.isInterchange&&r.exit.metre<at-50).reverse();
  if(!upstream.length)continue;
  if(event.kind==='closure'){
   const nearest=upstream[0]!;
   nearest.desiredPercent=100;nearest.mandatory=true;nearest.eventId=event.id;
   nearest.distanceBeforeClosureKm=(at-nearest.exit.metre)/1000;
  }else{
   // The percentage is an explicitly modelled route-choice desire, NOT actual
   // diverted volume. Only the nearest three relevant exits are considered.
   const desired=potentialDiversionPercent(delayMin,false)??0;
   for(let i=0;i<Math.min(3,upstream.length);i++){
    const row=upstream[i]!;
    if(row.mandatory)continue;
    const estimate=Math.round(desired*[1,.60,.30][i]!*10)/10;
    if(estimate<=row.desiredPercent)continue;
    row.desiredPercent=estimate;row.eventId=event.id;
   }
  }
 }
 for(const flow of real.filter(f=>f.path===path)){
  const from=rows.find(r=>!r.exit.isInterchange&&Math.abs(r.exit.metre-flow.fromM)<=25);
  const to=rows.find(r=>!r.exit.isInterchange&&Math.abs(r.exit.metre-flow.toM)<=25);
  if(from){
   from.outVph+=flow.outVph;
   from.vehiclesOnDetour+=flow.vehiclesOnDetour;
   from.validatedRouteActive=true;
  }
  if(to){
   to.inVph+=flow.inVph;
   to.waitingAtReentry+=flow.waitingAtReentry;
   to.validatedRouteActive=true;
  }
 }
 return rows;
}
