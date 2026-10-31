import {junctionAccess} from './road-controls.js';
import {localRoadAvailability} from './calendar-traffic.js';
/** Ordinary local trips, independent of incidents and simulator detours.
 * The rates are explicit scenario assumptions, scaled with the selected
 * direction's demand profile; they are not traffic counts. AK/AD turn flows
 * remain in the separate interchange solver.
 */
import type {Exit,RoadId} from './core.js';
import type {Corridor} from './spatial.js';
import {diversionJunctions} from './diversions.js';

export interface JunctionTrafficDemand {
 id:string;ref:string;metre:number;entryVph:number;exitPercent:number;
 entryCapacityVph:number;exitCapacityVph:number;
 /** Scenario averages for the ramp terminal (signals / conflicting turns)
  * and its SHORT approach storage, independent of the bypass's length. */
 exitTerminalVph?:number;exitStorageVehicles?:number;
}
export interface JunctionTrafficState extends JunctionTrafficDemand {
 waiting:number;offeredTotal:number;enteredTotal:number;exitedTotal:number;
 lastEntered:number;lastExited:number;
 /** Exit requests, including drivers waiting for side-road receiving room. */
 lastExitDemand?:number;
 exitQueue?:{normal:number;detours:Record<string,number>};
 /** Actual cars crossing the motorway's diverge, before terminal service. */
 lastExitAdmitted?:number;
 /** New local trips choosing another road before entering the ramp.
  * Existing ramp inventory and returning detour vehicles stay conserved. */
 entryAvoidancePercent?:number;
}
// No surveyed AS signal plans or local off-ramp lengths are bundled. These
// are explicit defaults: roughly one 300 m queue lane, and ~39% effective
// green at 1800 veh/h/lane. They are not measured AS-specific capacities.
export const DEFAULT_EXIT_TERMINAL_VPH=700,DEFAULT_EXIT_STORAGE_VEHICLES=40;
/** Directional interchange aggregates, explicit scenario assumptions rather
 * than surveyed counts. Larger urban distributors have more than one
 * usable movement and more ramp storage than the generic short exit. */
export function junctionCapacityProfile(road:string,ref:string){
 const profiles:Record<string,{terminal:number;storage:number;exit:number;entry:number}>={
  'A3:40':{terminal:1500,storage:120,exit:3000,entry:1800},
  'A3:42':{terminal:1500,storage:120,exit:2800,entry:1800},
  'A48:10':{terminal:1600,storage:140,exit:3000,entry:1800},
  'A48:11':{terminal:1500,storage:120,exit:2800,entry:1800}
 };
 return profiles[road+':'+ref]??{terminal:DEFAULT_EXIT_TERMINAL_VPH,storage:DEFAULT_EXIT_STORAGE_VEHICLES,exit:1800,entry:900};
}
export function exitRampVehicles(state:JunctionTrafficState):number{
 return (state.exitQueue?.normal??0)+Object.values(state.exitQueue?.detours??{}).reduce((n,v)=>n+v,0);
}
export function normalJunctionTraffic(route:Corridor,exits:readonly Exit[],demandVph:number,moment?:Date):JunctionTrafficDemand[]{
 if(route.key.startsWith('ramp-'))return [];
 return diversionJunctions(route.key as RoadId,exits,route).filter(j=>!j.isInterchange).map(j=>{
  // 4–8% local turnover per AS. Balanced ordinary entry/exit at the
  // reference free flow avoids artificially growing demand at every node.
  const share=4+Number.parseInt(j.ref,10)%5,profile=junctionCapacityProfile(route.key.startsWith('A3')?'A3':'A48',j.ref);
  const access=junctionAccess(route,[],j.metre,j.ref);
  return {id:route.key+':local:'+j.ref,ref:j.ref,metre:j.metre,
   entryVph:access.entry?Math.min(700,demandVph*share/100):0,exitPercent:access.exit?share:0,
   entryCapacityVph:profile.entry,exitCapacityVph:profile.exit,
   exitTerminalVph:Math.min(profile.exit,profile.terminal*localRoadAvailability(moment)),exitStorageVehicles:profile.storage};
 });
}
