/** 05_Umleitungen: Zugeordnetes Fachmodul extension-detours. */
import {ringDetours} from '../ring-detours-data.js';
import {leverkusenDetours} from '../leverkusen-detours-data.js';
import {extensionDetours as baseDetours,type ExtensionDetour} from '../extension-detours-data.js';

import type {Exit} from '../core.js';
import type {SimEvent} from '../events.js';
import {eventCapacity,type PathKey} from '../traffic.js';
import {closureGate,positionM,type Corridor} from '../spatial.js';
import {cellQueueSpans,type CellRouteState} from '../traffic-cells.js';
import type {DetourConfig} from '../detour-flow.js';
import type {NetworkConnection} from '../interchange.js';
import {diversionJunctions} from '../diversions.js';
import {junctionAccess} from '../road-controls.js';
import {speedDelayInCells} from '../speed-delay.js';

const extensionDetours=[...baseDetours,...ringDetours,...leverkusenDetours];
const sectionCache=new WeakMap<ExtensionDetour,{id:string;capacityVph:number}[]>();
const indexed=new Map(extensionDetours.map(r=>[r.id,r]));
/** Real directed geometry; route selection and capacities are simulator assumptions. */
export function extensionDetourConfig(record:ExtensionDetour,eventId:string,routes:Record<PathKey,Corridor>,
 events:readonly SimEvent[],exits:readonly Exit[],cells:Partial<Record<PathKey,CellRouteState>>={}):DetourConfig|null{
 const path=record.path as PathKey,target=record.targetPath as PathKey,route=routes[path],destination=routes[target];
 if(!route||!destination)return null;
 const fromM=positionM(route,record.fromPoint,1),toM=record.toRef==='end'?destination.lengthM:positionM(destination,record.toPoint,1);
 if(fromM===null||toM===null||path===target&&toM<=fromM)return null;
 const normalCapacity=record.capacityVph??2000;let capacity=normalCapacity,extraMinutes=0;
 for(const leg of record.legs){
  const key=leg.path as PathKey,r=routes[key];if(!r)continue;
  const a=positionM(r,leg.fromPoint,1),b=positionM(r,leg.toPoint,1);if(a===null||b===null)continue;
  const from=Math.min(a,b),to=Math.max(a,b);
  for(const event of events.filter(e=>e.pathKey===key)){
   const gate=closureGate(r,event,exits,events),at=positionM(r,event.point);
   if(at!==null&&(gate?gate.metre<to&&gate.endM>from:at<to&&at+event.settings.lengthM>from))capacity=Math.min(capacity,eventCapacity(event));
  }
  if(cells[key])extraMinutes+=speedDelayInCells(cells[key]!,from,to,to).delayMin;
 }
 const enabled=junctionAccess(route,events,fromM,record.fromRef).exit&&
  (record.toRef==='end'||junctionAccess(destination,events,toM,record.toRef).entry);
 if(!enabled)capacity=0;
 let sections=sectionCache.get(record);if(!sections){sections=record.wayIds.map(id=>({id:'osm-way:'+id,capacityVph:normalCapacity}));sectionCache.set(record,sections);}
 return {id:record.id,path,targetPath:target,fromM,toM,eventId,exitsNetwork:record.toRef==='end',
  ...(record.motorwayBypass&&target!==path?{sourceEndM:route.lengthM}:{}),motorwayBypass:record.motorwayBypass,exitIsInterchange:record.exitIsInterchange,alternativeGroup:'EXT-choice:'+path+':'+record.fromRef,
  geometry:{id:record.id,path,sourceExitRef:record.fromRef,targetExitRef:record.toRef,points:record.points,
   lengthKm:record.lengthKm,freeMinutes:record.freeMinutes+extraMinutes,roadCapacityVph:capacity,
   junctionCount:2,trafficLightCount:0,source:'simulated-bundled',relationId:null,
   label:record.unmappedBoundary?'OSM-Abfahrtsrampe bis zur Modellgrenze; Weiterfahrt nicht modelliert':record.motorway?'Simulierte OSM-Umfahrung über Nachbarautobahnen':'Simulierte OSM-Ortsumleitung',
   sections:capacity===normalCapacity?sections:sections.map(s=>({...s,capacityVph:capacity}))}};
}
export function refreshExtensionDetour(config:DetourConfig,routes:Record<PathKey,Corridor>,events:readonly SimEvent[],
 exits:readonly Exit[],cells:Partial<Record<PathKey,CellRouteState>>):DetourConfig{
 const record=indexed.get(config.id);if(!record)return config;
 const next=extensionDetourConfig(record,config.eventId,routes,events,exits,cells);
 return next?{...config,geometry:next.geometry}:config;
}
export function planExtensionDetours(events:readonly SimEvent[],routes:Record<PathKey,Corridor>,exits:readonly Exit[],
 cells:Partial<Record<PathKey,CellRouteState>>,connections:readonly NetworkConnection[]):DetourConfig[]{
 const plans=new Map<string,DetourConfig>();
 const queued=new Map(Object.entries(cells).map(([key,grid])=>[key,grid?cellQueueSpans(grid):[]]));
 for(const record of extensionDetours){
  const path=record.path as PathKey,target=record.targetPath as PathKey;
  // Ordinary A3 local routes already have their bundled planner. Add its
  // neighbouring-motorway alternatives to that SAME exit decision family.
  if(path.startsWith('A3')&&path===target&&!record.motorway&&!record.id.startsWith('LEV-'))continue;
  const route=routes[path];if(!route)continue;
  if(path===target&&!events.some(e=>e.pathKey===path)&&!queued.get(path)?.length)continue;
  if(path!==target&&!record.motorwayBypass&&!connections.some(c=>c.from===path&&c.to===target&&events.some(e=>e.pathKey===c.rampId||e.pathKey===target)))continue;
  const config=extensionDetourConfig(record,'queue:'+path,routes,events,exits,cells);if(!config)continue;
  if(path===target||record.motorwayBypass){
   const cause=events.find(e=>{
    if(e.pathKey!==path)return false;
    const at=positionM(route,e.point);if(at===null||config.fromM>at+1)return false;
    const gate=closureGate(route,e,exits,events);
    return gate?config.fromM<=gate.metre+1&&(record.motorwayBypass&&path!==target?route.lengthM:config.toM)>=gate.endM-1:
     config.toM>=Math.min(route.lengthM,at+e.settings.lengthM)-1;
   });
   const queue=queued.get(path)?.some(s=>config.fromM<=s.toM&&config.toM>=s.toM);
   if(!cause&&!queue)continue;
   if(cause){config.eventId=cause.id;const gate=closureGate(route,cause,exits,events);if(record.toRef==='end'&&gate?.endExit)continue;}else if(record.toRef==='end')continue;
   plans.set(config.id,config);
  }else{
   // A blocked connector can be bypassed by rejoining its destination
   // upstream as well: the destination carriageway itself remains open.
   const movement=connections.find(c=>c.from===path&&c.to===target&&(c.downstreamMergeM<=config.toM||
    events.some(e=>e.pathKey===c.rampId&&eventCapacity(e)===0)));
   if(!movement)continue;
   const cause=events.find(e=>e.pathKey===movement.rampId&&eventCapacity(e)===0||e.pathKey===target&&(()=>{
    const gate=closureGate(routes[target],e,exits,events);
    return !!gate&&gate.metre<=movement.downstreamMergeM+1&&gate.endM>movement.downstreamMergeM;
   })());
   if(!cause)continue;
   if(cause.pathKey===target){
    const gate=closureGate(routes[target],cause,exits,events);
    if(gate&&config.toM<gate.endM-1)continue;
   }
   config.eventId=cause.id;config.movementId=movement.rampId;
   config.sourceEndM=Math.max(movement.rampEntryM,config.fromM);config.targetEntryM=movement.downstreamMergeM;
   config.alternativeGroup='EXT-turn:'+movement.rampId+':'+record.fromRef;
   plans.set(config.id,config);
  }
 }
 let output=[...plans.values()];
 // A closed turn can be bypassed by continuing to an ordinary downstream
 // exit (e.g. A560 towards Siegburg), rather than queuing at the ramp.
 for(const movement of connections){
  const family=output.filter(c=>c.movementId===movement.rampId);if(!family.length)continue;
  const reachable=diversionJunctions(movement.from,exits,routes[movement.from]).filter(j=>!j.isInterchange&&
   junctionAccess(routes[movement.from],events,j.metre,j.ref).exit);
  const after=reachable.filter(j=>j.metre>=movement.rampEntryM-1).find(j=>family.some(c=>Math.abs(c.fromM-j.metre)<25));
  const before=reachable.filter(j=>j.metre<movement.rampEntryM&&family.some(c=>Math.abs(c.fromM-j.metre)<25)).at(-1);
  const chosen=after??before;
  output=output.filter(c=>c.movementId!==movement.rampId||!!chosen&&Math.abs(c.fromM-chosen.metre)<25);
 }
 // Keep up to three return junctions per exit; all geometry remains
 // available in the catalogue without running hundreds of idle ledgers.
 return output.filter(config=>{
  const family=output.filter(c=>c.path===config.path&&Math.abs(c.fromM-config.fromM)<1&&c.targetPath===config.targetPath&&c.movementId===config.movementId);
  const returns=[...new Set(family.map(c=>c.toM))].sort((a,b)=>a-b).slice(0,3);
  return returns.includes(config.toM);
 });
}
export {extensionDetours};
