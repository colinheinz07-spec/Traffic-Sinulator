/** One motorway edge has one physical owner, including legacy ramp aliases. */
import {networkData} from './geodata.js';
import {extensionRoutes,extensionRoute} from './network-extensions.js';
import {normalThroughLanes} from './lane-info.js';
import type {Point} from './core.js';
import type {PathKey} from './traffic.js';
import type {SimEvent} from './events.js';
type Owner={key:PathKey;lanes:number};
const edge=(a:Point,b:Point)=>[a.join(','),b.join(',')].sort().join('|');
const distance=(a:Point,b:Point)=>Math.hypot((a[0]-b[0])*111195,(a[1]-b[1])*111195*Math.cos((a[0]+b[0])*Math.PI/360));
let owners:Map<string,Owner>|undefined;
function motorwayOwners():Map<string,Owner>{
 if(owners)return owners;owners=new Map();
 for(const r of networkData.roads)for(let i=1;i<r.points.length;i++)owners.set(edge(r.points[i-1]!,r.points[i]!),{key:r.road,lanes:normalThroughLanes(r)});
 for(const r of extensionRoutes.filter(r=>r.kind==='motorway')){
  let at=0;for(let i=1;i<r.points.length;i++){const a=r.points[i-1]!,b=r.points[i]!,key=edge(a,b),lanes=r.laneSegments.find(s=>s.fromM<=at+.1&&s.toM>at+.1)?.lanes??r.lanes;
   if(!owners.has(key))owners.set(key,{key:r.id,lanes});at+=distance(a,b);}
 }
 return owners;
}
export interface VisibleRange {fromM:number;toM:number;points:Point[]}
const rangesCache=new WeakMap<Point[],{key:string;ranges:VisibleRange[]}>();
export function visibleRanges(key:string,points:Point[]):VisibleRange[]{
 const old=rangesCache.get(points);if(old?.key===key)return old.ranges;
 const map=motorwayOwners(),result:VisibleRange[]=[];let metre=0,range:VisibleRange|undefined;
 const ramp=extensionRoute(key)?.kind==='ramp';
 for(let i=1;i<points.length;i++){
  const a=points[i-1]!,b=points[i]!,end=metre+distance(a,b),owner=map.get(edge(a,b));
  if(!ramp||!owner||owner.key===key){
   if(!range){range={fromM:metre,toM:end,points:[a,b]};result.push(range);}else{range.toM=end;range.points.push(b);}
  }else range=undefined;
  metre=end;
 }
 if(result.length===1&&result[0]!.fromM===0&&Math.abs(result[0]!.toM-metre)<.01)result[0]!.points=points;
 rangesCache.set(points,{key,ranges:result});return result;
}
export function physicalOwnerAt(key:string,point:Point):Owner|null{
 const route=extensionRoute(key);if(route?.kind!=='ramp')return null;
 let best=.25,found:Owner|null=null;
 for(let i=1;i<route.points.length;i++){
  const a=route.points[i-1]!,b=route.points[i]!,owner=motorwayOwners().get(edge(a,b));if(!owner||owner.key===key)continue;
  const scale=Math.cos(point[0]*Math.PI/180),dx=(b[1]-a[1])*scale,dy=b[0]-a[0],d=dx*dx+dy*dy;
  const t=d?Math.max(0,Math.min(1,((point[1]-a[1])*scale*dx+(point[0]-a[0])*dy)/d)):0;
  const error=distance(point,[a[0]+dy*t,a[1]+(b[1]-a[1])*t]);if(error<best){best=error;found=owner;}
 }
 return found;
}
export function canonicalPhysicalEvent(event:SimEvent):SimEvent{
 const owner=physicalOwnerAt(event.pathKey,event.point);if(!owner)return event;
 const lanes=(closed:readonly number[])=>closed.length===event.laneCount?Array.from({length:owner.lanes},(_,i)=>i):closed.filter(i=>i<owner.lanes);
 return {...event,pathKey:owner.key,laneCount:owner.lanes,closedLanes:lanes(event.closedLanes),
  ...(event.schedule?{schedule:{...event.schedule,phases:event.schedule.phases.map(p=>({...p,closedLanes:lanes(p.closedLanes)}))}}:{})};
}
