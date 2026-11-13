/** 05_Umleitungen – forced motorway exits at an administrative closure.
 * Uses ONLY retained, directed OSM ramp geometry. No vehicle teleportation:
 * advanceRoutedNetwork owns the source withdrawal, transit stock and the
 * target motorway return in one conserved vehicle ledger.
 */
import type {SimEvent} from '../events.js';
import type {Exit} from '../core.js';
import type {Corridor} from '../spatial.js';
import {closureGate,metres,positionM} from '../spatial.js';
import {routeDescriptor} from '../network-catalog.js';
import {extensionRoute} from '../network-extensions.js';
import {closedNetworkSpans} from '../closure-network.js';
import {ringDetours} from '../ring-detours-data.js';
import type {NetworkConnection} from '../interchange.js';
import type {MainlineMerge} from '../network-receiving.js';
import type {DetourConfig} from '../detour-flow.js';

const pointKey=(p:readonly number[])=>p.join(',');
const motorway=(key:string)=>routeDescriptor(key)?.kind==='motorway';
const lengthKm=(points:readonly [number,number][])=>
 points.slice(1).reduce((sum,p,i)=>sum+metres(points[i]!,p),0)/1000;

export function closureForkDetours(
 events:readonly SimEvent[],
 routes:Readonly<Record<string,Corridor>>,
 exits:readonly Exit[],
 links:readonly NetworkConnection[],
 merges:readonly MainlineMerge[]
):DetourConfig[]{
 const spans=closedNetworkSpans(events,routes,exits,links);
 const forbidden=(key:string,at:number)=>spans.some(s=>s.pathKey===key&&
  at>=s.fromM-2&&at<s.toM-1);
 const result:DetourConfig[]=[];
 const offered=new Set<string>();
 const add=(event:SimEvent,source:string,target:string,fromM:number,toM:number,
  points:[number,number][],wayIds:readonly number[],sourceRamp:string,
  closureTurnSharePercent=100)=>{
  const sender=routes[source],receiver=routes[target];
  if(!sender||!receiver||!motorway(source)||!motorway(target)||source===target||
   !Number.isFinite(fromM)||!Number.isFinite(toM)||fromM<0||
   fromM>=sender.lengthM||toM<0||toM>=receiver.lengthM||
   forbidden(target,toM)||forbidden(sourceRamp,0))return;
  const id='CLOSURE-FORK-'+event.id+':'+source+':'+sourceRamp;
  if(offered.has(id))return;
  offered.add(id);
  const km=lengthKm(points);
  // Do not turn a two-lane OSM motorway ramp into a one-lane bottleneck.
  // 1,500 veh/h per ramp lane is the declared simulation assumption.
  const capacity=1500*Math.max(1,Math.min(3,extensionRoute(sourceRamp)?.lanes??1));
  if(km<=.005||km>80)return;
  result.push({
   id,path:source,targetPath:target,fromM,toM,sourceEndM:fromM,
   targetEntryM:toM,eventId:event.id,
   motorwayBypass:true,exitIsInterchange:true,closureTurnSharePercent,
   alternativeGroup:'CLOSURE-FORK:'+event.id+':'+source,
   geometry:{id,path:source,sourceExitRef:'AD/AK',targetExitRef:'OSM',
    points,lengthKm:km,freeMinutes:Math.max(.2,km/70*60),
    roadCapacityVph:capacity,junctionCount:0,trafficLightCount:0,
    source:'osm-motorway-ramp',relationId:null,
    label:'Gerichtete OSM-Autobahnumleitung an Vollsperrung',
    sections:wayIds.length?[...new Set(wayIds)].map(way=>({id:'osm-way:'+way,capacityVph:capacity})):
     [{id:'osm-trace-prefix:'+sourceRamp,capacityVph:capacity}]}
  });
 };
 const uniqueLinks=new Map<string,NetworkConnection>();
 for(const link of links){
  const ramp=routes[link.rampId];
  if(!ramp||!motorway(link.from)||!motorway(link.to)||link.from===link.to)continue;
  const id=[link.from,link.to,pointKey(ramp.points[0]!),pointKey(ramp.points.at(-1)!)].join('|');
  // Multiple aliases for the same OSM ramp do not multiply its throughput.
  if(!uniqueLinks.has(id)||link.rampId.startsWith('extra-turn-'))
   uniqueLinks.set(id,link);
 }
 const physicalLinks=[...uniqueLinks.values()];
 const linkRoute=(event:SimEvent,link:NetworkConnection,share=100)=>{
  const ramp=routes[link.rampId]!;
  add(event,link.from,link.to,link.rampEntryM,link.downstreamMergeM,
   ramp.points,extensionRoute(link.rampId)?.wayIds??[],link.rampId,share);
 };
 for(const event of events){
  if(event.kind!=='closure'||!motorway(event.pathKey))continue;
  const closed=routes[event.pathKey];if(!closed)continue;
  const gate=closureGate(closed,event,exits,events);if(!gate)continue;
  // At the last open motorway fork, give drivers a conserved exit into the
  // OPEN branch before the closure face. The branch is not a normal AS.
  if(gate.exit&&/^(AD |AK )/.test(gate.exit.name)){
   const options=physicalLinks.filter(c=>c.from===event.pathKey&&
    c.to!==event.pathKey&&c.rampEntryM<=gate.metre+70&&
    c.rampEntryM>=gate.metre-1000&&!forbidden(c.rampId,0)&&
    !forbidden(c.to,c.downstreamMergeM))
    .sort((a,b)=>b.rampEntryM-a.rampEntryM);
   const latest=options[0]?.rampEntryM;
   for(const link of options)if(latest!==undefined&&latest-link.rampEntryM<200)
    linkRoute(event,link);
  }
  // Feeders to the blocked motorway must leave at their own LAST usable
  // motorway fork. This prevents waiting at a forbidden A4 -> A3 ramp.
  const blocked=links.filter(c=>motorway(c.from)&&c.from!==event.pathKey&&
   c.rampId!==c.from&&forbidden(c.rampId,0));
  const feeders=new Set(blocked.map(c=>c.from));
  for(const feeder of feeders){
   const blockedAt=Math.min(...blocked.filter(c=>c.from===feeder).map(c=>c.rampEntryM));
   // Prefer an alternative autobahn instead of a U-turn into the opposite
   // direction of the closed motorway (A4 -> A559, not A4 -> A3 Frankfurt).
   const closedRef=routeDescriptor(event.pathKey)?.motorway;
   const open=physicalLinks.filter(c=>c.from===feeder&&c.to!==event.pathKey&&
    routeDescriptor(c.to)?.motorway!==closedRef&&
    c.rampEntryM<=blockedAt+1&&!forbidden(c.to,c.downstreamMergeM)&&
    !forbidden(c.rampId,0)).sort((a,b)=>b.rampEntryM-a.rampEntryM);
   if(open.length){
    const closedDestinations=new Set(blocked.filter(c=>c.from===feeder).map(c=>c.to));
    const openDestinations=new Set(links.filter(c=>c.from===feeder&&motorway(c.to)&&
     !closedDestinations.has(c.to)&&Math.abs(c.rampEntryM-blockedAt)<80&&
     !forbidden(c.rampId,0)).map(c=>c.to));
    // Preserve traffic for still-open destinations instead of routing every
    // A4 vehicle through A559 simply because A3 Koeln is closed.
    const share=100*closedDestinations.size/
     Math.max(1,closedDestinations.size+openDestinations.size);
    linkRoute(event,open[0]!,share);
   }
  }
  // A motorway can physically merge into a closed A3 without a separately
  // tagged motorway_link (A59 Heumar). Reuse verified OSM ring geometry,
  // truncated at an OPEN receiving motorway. Never return into the closure.
  for(const merge of merges.filter(m=>m.to===event.pathKey&&forbidden(m.to,m.mergeM))){
   for(const ring of ringDetours.filter(r=>r.path===merge.from&&r.targetPath===event.pathKey)){
    const source=routes[ring.path];if(!source)continue;
    const fromM=positionM(source,ring.fromPoint,2);if(fromM===null)continue;
    const landings:{path:string;toM:number;index:number}[]=[];
    for(const leg of ring.legs){
     if(!motorway(leg.path)||leg.path===event.pathKey)continue;
     const target=routes[leg.path];if(!target)continue;
     // A ring OSM trace can pass through A559 and then A4 toward the
     // closed A3. Transfer at the FIRST safe motorway on the trace.
     for(let index=3;index<ring.points.length;index++){
      const toM=positionM(target,ring.points[index]!,0.10);
      if(toM===null||toM<80||toM>=target.lengthM-40||
       forbidden(leg.path,toM))continue;
      landings.push({path:leg.path,toM,index});break;
     }
    }
    landings.sort((a,b)=>a.index-b.index);
    const earliest=landings[0];
    if(!earliest)continue;
    const geometry=ring.points.slice(0,earliest.index+1) as [number,number][];
    // Original full-route wayIds include later blocked arms, and cannot
    // consume road capacity that the truncated journey never traverses.
    add(event,merge.from,earliest.path,fromM,earliest.toM,geometry,[],
     ring.id+':'+earliest.path);
   }
  }
 }
 return result;
}
