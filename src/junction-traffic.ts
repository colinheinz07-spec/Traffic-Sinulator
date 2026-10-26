/** Ordinary local trips, independent of incidents and simulator detours.
 * The rates are explicit scenario assumptions, scaled with the selected
 * direction's demand profile; they are not traffic counts. AK/AD turn flows
 * remain in the separate interchange solver.
 */
import type {Exit,RoadId} from './core.js';
import type {Corridor} from './spatial.js';
import {diversionJunctions} from './diversions.js';
import {baselineCapacity} from './traffic.js';

export interface JunctionTrafficDemand {
 id:string;ref:string;metre:number;entryVph:number;exitPercent:number;
 entryCapacityVph:number;exitCapacityVph:number;
}
export interface JunctionTrafficState extends JunctionTrafficDemand {
 waiting:number;offeredTotal:number;enteredTotal:number;exitedTotal:number;
 lastEntered:number;lastExited:number;
 /** Exit requests, including drivers waiting for side-road receiving room. */
 lastExitDemand?:number;
 /** New local trips choosing another road before entering the ramp.
  * Existing ramp inventory and returning detour vehicles stay conserved. */
 entryAvoidancePercent?:number;
}
export function normalJunctionTraffic(route:Corridor,exits:readonly Exit[],demandVph:number):JunctionTrafficDemand[]{
 if(route.key.startsWith('ramp-'))return [];
 return diversionJunctions(route.key as RoadId,exits,route).filter(j=>!j.isInterchange).map(j=>{
  // 4–8% local turnover per AS. Balanced ordinary entry/exit at the
  // reference free flow avoids artificially growing demand at every node.
  const share=4+Number(j.ref)%5;
  return {id:route.key+':local:'+j.ref,ref:j.ref,metre:j.metre,
   entryVph:Math.min(700,demandVph*share/100),exitPercent:share,
   entryCapacityVph:900,exitCapacityVph:baselineCapacity(route.key)};
 });
}
