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
export function exitRampVehicles(state:JunctionTrafficState):number{
 return (state.exitQueue?.normal??0)+Object.values(state.exitQueue?.detours??{}).reduce((n,v)=>n+v,0);
}
export function normalJunctionTraffic(route:Corridor,exits:readonly Exit[],demandVph:number,moment?:Date):JunctionTrafficDemand[]{
 if(route.key.startsWith('ramp-'))return [];
 return diversionJunctions(route.key as RoadId,exits,route).filter(j=>!j.isInterchange).map(j=>{
  // 4–8% local turnover per AS. Balanced ordinary entry/exit at the
  // reference free flow avoids artificially growing demand at every node.
  const share=4+Number(j.ref)%5;
  return {id:route.key+':local:'+j.ref,ref:j.ref,metre:j.metre,
   entryVph:Math.min(700,demandVph*share/100),exitPercent:share,
   entryCapacityVph:900,exitCapacityVph:1800,
   exitTerminalVph:Math.min(1000,DEFAULT_EXIT_TERMINAL_VPH*localRoadAvailability(moment)),exitStorageVehicles:DEFAULT_EXIT_STORAGE_VEHICLES};
 });
}
