/** Administrative motorway closures: one interval on the selected direction,
 * plus only the physical ramps which enter or leave that *closed* section.
 *
 * This is a topology/visual-access rule, NOT a new queue or vehicle stock.
 * Vehicles already inside the section are handled by the conserved CTM.
 * Diverges to another OPEN motorway remain available for evacuation.
 */
import type {Exit} from './core.js';
import type {SimEvent} from './events.js';
import type {NetworkConnection} from './interchange.js';
import type {Corridor} from './spatial.js';
import {closureGate,positionM} from './spatial.js';
import {junctionRampBindings} from './junction-ramp-bindings.js';
import {routeDescriptor} from './network-catalog.js';

export interface ClosedNetworkSpan {
 eventId:string;
 pathKey:string;
 fromM:number;
 toM:number;
 source:'motorway'|'interchange-entry'|'local-entry'|'local-exit'|'direct-ramp';
}
const EPS=2;
/** Actual OSM ramp-to-ramp continuations. One transfer ramp may consist of
 * several directed ways, and a way may branch to both an open and a closed
 * destination. Keep the common approach open whenever ANY legal downstream
 * branch remains open. Unknown external boundaries are treated as open,
 * never guessed to be a prohibited motorway entry.
 */
interface RampEndpointTopology {
 ramps:Corridor[];
 starts:Map<string,Corridor[]>;
 mainlines:Map<string,{key:string;metre:number}[]>;
}
const endpointCache=new WeakMap<object,RampEndpointTopology>();
const pointId=(p:readonly number[])=>p.join(',');
function endpointTopology(routes:Readonly<Record<string,Corridor>>):RampEndpointTopology{
 const cached=endpointCache.get(routes);if(cached)return cached;
 const ramps:Corridor[]=[],starts=new Map<string,Corridor[]>(),
  mainlines=new Map<string,{key:string;metre:number}[]>();
 for(const route of Object.values(routes)){
  if(routeDescriptor(route.key)?.kind==='ramp'||route.key.startsWith('ramp-')){
   ramps.push(route);
   const at=pointId(route.points[0]!);
   starts.set(at,[...(starts.get(at)??[]),route]);
  }else{
   route.points.forEach((point,i)=>{
    const at=pointId(point);
    mainlines.set(at,[...(mainlines.get(at)??[]),{key:route.key,metre:route.metres[i]!}]);
   });
  }
 }
 const result={ramps,starts,mainlines};endpointCache.set(routes,result);return result;
}
const inClosed=(at:number,from:number,to:number,atGate=false)=>
 at >= from-(atGate?EPS:-EPS) && at < to-EPS;

/** A full closure affects only the selected direction and legal movements
 * actually merging into that section, not every arm of the same interchange.
 * Local off-ramps at the last usable exit remain OPEN for the diversion.
 */
export function closedNetworkSpans(
 events:readonly SimEvent[],
 routes:Readonly<Record<string,Corridor>>,
 exits:readonly Exit[],
 connections:readonly NetworkConnection[]
):ClosedNetworkSpan[]{
 const result:ClosedNetworkSpan[]=[];
 const add=(eventId:string,pathKey:string,fromM:number,toM:number,source:ClosedNetworkSpan['source'])=>{
  const route=routes[pathKey];
  if(route&&Number.isFinite(fromM)&&Number.isFinite(toM)&&toM>fromM+0.5)
   result.push({eventId,pathKey,fromM:Math.max(0,fromM),toM:Math.min(route.lengthM,toM),source});
 };
 for(const event of events){
  if(event.kind!=='closure')continue;
  const route=routes[event.pathKey];if(!route)continue;
  if(routeDescriptor(route.key)?.kind==='ramp'){
   // Dedicated ramp closure: its whole directed branch is administratively shut.
   add(event.id,route.key,0,route.lengthM,'direct-ramp');continue;
  }
  const gate=closureGate(route,event,exits,events);if(!gate)continue;
  add(event.id,route.key,gate.metre,gate.endM,'motorway');

  // Physically connected ramps leading INTO the prohibited direction.
  // A diverge OUT of the closure to an open motorway is not blocked;
  // those exits may serve existing traffic/mandatory diversion.
  for(const link of connections){
   if(link.to!==route.key||link.rampId===route.key)continue;
   if(!inClosed(link.downstreamMergeM,gate.metre,gate.endM,true))continue;
   const ramp=routes[link.rampId];if(!ramp)continue;
   add(event.id,link.rampId,0,ramp.lengthM,'interchange-entry');
  }
  // Exit to the LOCAL road network: one endpoint belongs to the closed
  // motorway and the other lies outside our Autobahn simulation. A fork
  // leading to another *mapped motorway* is an open escape route instead.
  for(const link of connections){
   if(link.from!==route.key||link.to!==link.rampId)continue;
   if(!inClosed(link.rampEntryM,gate.metre,gate.endM,false))continue;
   const ramp=routes[link.rampId];if(!ramp)continue;
   add(event.id,link.rampId,0,ramp.lengthM,'local-exit');
  }
  // Ordinary directional AS ramps. Last upstream off-ramp remains open;
  // its paired on-ramp is barred from entering the closed section.
  for(const binding of junctionRampBindings(route,exits)){
   const j=exits.find(e=>e.ref===binding.ref&&e.road===routeDescriptor(route.key)?.motorway);
   if(!j)continue;
   const position=(j.directional?.[route.key]?.position??j.position);
   // The matching ramp's tie-in can be up to 900m away from its label.
   const metre=positionM(route,position,900);
   if(metre===null)continue;
   const permitted=binding.kind==='entry'
    ?inClosed(metre,gate.metre,gate.endM,true)
    :inClosed(metre,gate.metre,gate.endM,false);
   if(!permitted)continue;
   for(const segment of binding.segments){
    add(event.id,segment.ramp.id,segment.rampFromM,
      segment.rampFromM+segment.toM-segment.fromM,
      binding.kind==='entry'?'local-entry':'local-exit');
   }
  }
  // Traverse directed ramp chains back from the prohibited receiving road.
  // A shared feeder at a fork remains OPEN when it can reach an open arm.
  // Direct connections above remain useful for ramps whose OSM endpoints
  // differ from the old motorway geometry; this is an additive audit.
  const topo=endpointTopology(routes),memo=new Map<string,boolean>();
  const leadsOnlyIntoClosure=(ramp:Corridor,visiting:Set<string>):boolean=>{
   const known=memo.get(ramp.key);if(known!==undefined)return known;
   if(visiting.has(ramp.key))return false; // cycle/unknown: fail open
   const nextSeen=new Set(visiting);nextSeen.add(ramp.key);
   const at=pointId(ramp.points.at(-1)!);
   const mainlineHits=topo.mainlines.get(at)??[];
   const closed=mainlineHits.length>0?
    mainlineHits.every(hit=>hit.key===route.key&&
     inClosed(hit.metre,gate.metre,gate.endM,true)):
    (topo.starts.get(at)??[]).filter(next=>next.key!==ramp.key).some(next=>nextSeen.has(next.key))?
     false:(()=>{
      const continuations=(topo.starts.get(at)??[]).filter(next=>next.key!==ramp.key);
      return continuations.length>0&&continuations.every(next=>leadsOnlyIntoClosure(next,nextSeen));
     })();
   memo.set(ramp.key,closed);return closed;
  };
  for(const ramp of topo.ramps)if(leadsOnlyIntoClosure(ramp,new Set()))
   add(event.id,ramp.key,0,ramp.lengthM,'interchange-entry');
 }
 // The same segment must not draw multiple overlapping red/white stripes
 // when two closure rules name the identical directed ramp.
 const uniq=new Map<string,ClosedNetworkSpan>();
 for(const s of result)uniq.set([s.eventId,s.pathKey,s.fromM.toFixed(2),s.toM.toFixed(2)].join(':'),s);
 return [...uniq.values()];
}
