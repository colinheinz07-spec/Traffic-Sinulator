/** Shared endpoint index for all motorway corridors.
 * Uses exact OSM geometry (5 cm proximity), never guesses a connection from
 * visually intersecting roads. Both interchange and receiving solvers use it.
 */
import type {Point} from './core.js';
import type {Corridor} from './spatial.js';
type Hit={key:string;metre:number;point:Point};
export interface MotorwayEndpointIndex {at(point:Point):Hit[]}
const cache=new WeakMap<object,WeakMap<object,MotorwayEndpointIndex>>();
const SCALE=1e6;
function bucket(p:Point):[number,number]{
 return [Math.round(p[0]*SCALE),Math.round(p[1]*SCALE)];
}
function distance(a:Point,b:Point):number{
 const x=(a[1]-b[1])*111195*Math.cos((a[0]+b[0])*Math.PI/360);
 return Math.hypot(x,(a[0]-b[0])*111195);
}
export function motorwayEndpointIndex(routes:Readonly<Record<string,Corridor>>,mainlines:readonly string[]):MotorwayEndpointIndex{
 const cached=cache.get(routes)?.get(mainlines);if(cached)return cached;
 const buckets=new Map<string,Hit[]>();
 for(const key of mainlines){
  const route=routes[key];if(!route)continue;
  for(let i=0;i<route.points.length;i++){
   const point=route.points[i]!,metre=route.metres[i]!,b=bucket(point),k=b.join(',');
   const list=buckets.get(k)??[];list.push({key,metre,point});buckets.set(k,list);
  }
 }
 const index:MotorwayEndpointIndex={
  at(point:Point):Hit[]{
   const [x,y]=bucket(point),matched:Hit[]=[];
   for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
    for(const hit of buckets.get((x+dx)+','+(y+dy))??[])
     if(distance(hit.point,point)<.05)matched.push(hit);
   }
   return matched;
  }
 };
 let perRoute=cache.get(routes);if(!perRoute){perRoute=new WeakMap();cache.set(routes,perRoute);}
 perRoute.set(mainlines,index);
 return index;
}
