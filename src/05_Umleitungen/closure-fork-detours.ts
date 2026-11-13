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
  points:[number,number][],wayIds:readonly number[],sourceRamp:string)=>{
  const sender=routes[source],receiver=routes[target];
  if(!sender||!receiver||!motorway(source)||!motorway(target)||source===target||
   !Number.isFinite(fromM)||!Number.isFinite(toM)||fromM<0||
   fromM>=sender.lengthM||toM<0||toM>=receiver.lengthM||
   forbidden(target,toM)||forbidden(sourceRamp,0))return;
  const id='CLOSURE-FORK-'+event.id+':'+source+':'+sourceRamp;
  if(offered.has(id))return;
  offered.add(id);
  const km=lengthKm(points),capacity=1500;
  if(km<=.005||km>80)return;
  result.push({
   id,path:source,targetPath:target,fromM,toM,sourceEndM:fromM,
   targetEntryM:toM,eventId:event.id,
   motorwayBypass:true,exitIsInterchange:true,
   alternativeGroup:'CLOSURE-FORK:'+event.id+':'+source,
   geometry:{id,path:source,sourceExitRef:'AD/AK',targetExitRef:'OSM',
    points,lengthKm:km,freeMinutes:Math.max(.2,km/70*60),
    roadCapacityVph:capacity,junctionCount:0,trafficLightCount:0,
    source:'osm-motorway-ramp',relationId:null,
    label:'Gerichtete OSM-Autobahnumleitung an Vollsperrung',
    sections:[...new Set(wayIds)].map(way=>({id:'osm-way:'+way,capacityVph:capacity}))}
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
 const linkRoute=(event:SimEvent,link:NetworkConnection)=>{
  const ramp=routes[link.rampId]!;
  add(event,link.from,link.to,link.rampEntryM,link.downstreamMergeM,
   ramp.points,extensionRoute(link.rampId)?.wayIds??[],link.rampId);
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
  const blocked=physicalLinks.filter(c=>c.to===event.pathKey&&
   c.from!==event.pathKey&&forbidden(c.to,c.downstreamMergeM));
  const feeders=new Set(blocked.map(c=>c.from));
  for(const feeder of feeders){
   const blockedAt=Math.min(...blocked.filter(c=>c.from===feeder).map(c=>c.rampEntryM));
   const open=physicalLinks.filter(c=>c.from===feeder&&c.to!==event.pathKey&&
    c.rampEntryM<=blockedAt+1&&!forbidden(c.to,c.downstreamMergeM)&&
    !forbidden(c.rampId,0)).sort((a,b)=>b.rampEntryM-a.rampEntryM);
   if(open.length)linkRoute(event,open[0]!);
  }
  // A motorway can physically merge into a closed A3 without a separately
  // tagged motorway_link (A59 Heumar). Reuse verified OSM ring geometry,
  // truncated at an OPEN receiving motorway. Never return into the closure.
  for(const merge of merges.filter(m=>m.to===event.pathKey&&forbidden(m.to,m.mergeM))){
   for(const ring of ringDetours.filter(r=>r.path===merge.from&&r.targetPath===event.pathKey)){
    const source=routes[ring.path];if(!source)continue;
    const fromM=positionM(source,ring.fromPoint,2);if(fromM===null)continue;
    for(const leg of ring.legs){
     if(!motorway(leg.path)||leg.path===event.pathKey)continue;
     const target=routes[leg.path];if(!target)continue;
     const toM=positionM(target,leg.fromPoint,2);if(toM===null||forbidden(leg.path,toM))continue;
     const end=ring.points.findIndex(p=>pointKey(p)===pointKey(leg.fromPoint));
     if(end<1)continue;
     const geometry=ring.points.slice(0,end+1) as [number,number][];
     add(event,merge.from,leg.path,fromM,toM,geometry,ring.wayIds,ring.id+':'+leg.path);
     break;
    }
   }
  }
 }
 return result;
}
