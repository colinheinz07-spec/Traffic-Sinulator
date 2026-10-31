import {networkData} from './geodata.js';
/** Physical lane restrictions and directional AS access on actual road
 * intervals. Administrative closures keep their separate exit-gate rule. */
import {exitPosition,type Exit,type RoadId} from './core.js';
import {suggestedSpeed,type SimEvent} from './events.js';
import {positionM,type Corridor} from './spatial.js';
export interface RoadSection {fromM:number;toM:number;event:SimEvent;openLanes:number[];shoulderOpen:boolean;queueLanes:number}
export function roadSections(route:Corridor,events:readonly SimEvent[]):RoadSection[]{
 const located=events.filter(e=>e.pathKey===route.key&&e.kind!=='closure').flatMap(event=>{
  const fromM=positionM(route,event.point);return fromM===null?[]:[{event,fromM,toM:Math.min(route.lengthM,fromM+event.settings.lengthM)}];
 });
 const boundaries=[...new Set(located.flatMap(e=>[e.fromM,e.toM]))].sort((a,b)=>a-b),result:RoadSection[]=[];
 for(let i=1;i<boundaries.length;i++){
  const fromM=boundaries[i-1]!,toM=boundaries[i]!,active=located.filter(e=>e.fromM<toM-.001&&e.toM>fromM+.001);
  if(!active.length||toM-fromM<.001)continue;
  const base=active.at(-1)!.event,count=Math.max(...active.map(e=>e.event.laneCount));
  const closedLanes=[...new Set(active.flatMap(e=>e.event.closedLanes))].sort((a,b)=>a-b);
  const shoulderOpen=active.some(e=>e.event.settings.shoulder==='open')&&!active.some(e=>e.event.settings.shoulder==='blocked');
  const openLanes=Array.from({length:count},(_,i)=>i).filter(i=>!closedLanes.includes(i));
  const speed=Math.min(...active.map(e=>e.event.settings.speedKmh).filter(v=>v>0));
  const speedKmh=openLanes.length||shoulderOpen?Number.isFinite(speed)?speed:suggestedSpeed(base.kind,count,closedLanes,shoulderOpen?'open':'normal'):0;
  const remaining=active.map(e=>e.event.laneCount-e.event.closedLanes.length+Number(e.event.settings.shoulder==='open')).filter(n=>n>0);
  const queueLanes=Math.min(count,...remaining);
  result.push({fromM,toM,openLanes,shoulderOpen,queueLanes,event:{...base,laneCount:count,closedLanes,
   settings:{...base.settings,speedKmh,shoulder:shoulderOpen?'open':active.some(e=>e.event.settings.shoulder==='blocked')?'blocked':'normal'}}});
 }
 return result;
}
/** A new restriction begins at one of these original event heads. Apply
 * the union there without inventing another independent braking head. */
export function physicalEvents(route:Corridor,events:readonly SimEvent[],sections=roadSections(route,events)):SimEvent[]{
 return events.map(event=>{
  if(event.pathKey!==route.key||event.kind==='closure')return event;
  const at=positionM(route,event.point),section=at===null?undefined:sections.find(s=>s.fromM<=at+.001&&s.toM>at+.001);
  return section?{...section.event,id:event.id,kind:event.kind,point:event.point,
   settings:{...event.settings,speedKmh:section.event.settings.speedKmh,shoulder:section.event.settings.shoulder},createdAt:event.createdAt}:event;
 });
}
export function junctionAccess(route:Corridor,events:readonly SimEvent[],metre:number,ref:string):{entry:boolean;exit:boolean}{
 const base=networkData.exits.find(e=>e.road===(route.key.startsWith('A3')?'A3':'A48')&&e.ref===ref)?.access?.[route.key as RoadId];
 let entry=base?.entry??true,exit=base?.exit??true;
 for(const e of events){
  if(e.pathKey!==route.key||e.kind!=='roadworks')continue;
  const mode=e.settings.junctionClosures?.[ref];if(!mode)continue;
  const from=positionM(route,e.point);if(from===null||metre<from-1||metre>from+e.settings.lengthM+1)continue;
  if(mode==='entry'||mode==='both')entry=false;
  if(mode==='exit'||mode==='both')exit=false;
 }
 return {entry,exit};
}
export function accessibleExits(route:Corridor,events:readonly SimEvent[],exits:readonly Exit[],access:'entry'|'exit'):Exit[]{

 const road=route.key.startsWith('A3')?'A3':'A48';
 return exits.filter(e=>{
  if(e.road!==road)return true;
  const at=positionM(route,exitPosition(e,route.key as RoadId),900);
  return at===null||junctionAccess(route,events,at,e.ref)[access];
 });
}
