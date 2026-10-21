/** Real OpenStreetMap streets for detours. Never build fictitious straight
 * connectors: a detour is usable only with a connected route over OSM ways.
 * Official sources are OSM relations identified in the German U-route wiki.
 * An incomplete relation can be filled with a cost-weighted path on existing
 * non-motorway OSM ways (and MUST be marked "simulated OSM connection").
 * Requests occur on user action; no continuous Overpass polling.
 */
import type {Point,Exit,RoadId} from './core.js';
import {metres} from './spatial.js';
import type {DiversionLink} from './diversions.js';
export interface OSMWay {id:number;nodes:number[];tags:Record<string,string>;geometry:{lat:number;lon:number}[]}
export interface Segment {from:number;to:number;lengthM:number;weight:number;roadClass:string;points:Point[]}
export interface RoadGraph {adjacency:Map<number,Segment[]>;coordinates:Map<number,Point>}
export interface DetourGeometry {
 id:string;path:RoadId;sourceExitRef:string;targetExitRef:string;points:Point[];
 lengthKm:number;freeMinutes:number;roadCapacityVph:number;source:'osm-official-relation'|'osm-routed-infill';
 relationId:number|null;label:string;
}
export const OFFICIAL_OSM_RELATION_IDS:Readonly<Record<string,number>>={
 'A3-koeln-U72':186925,'A3-koeln-U74':186902,
 'A3-koeln-U1':186894,'A3-koeln-U3':398045,'A3-koeln-U5':398046,
 'A3-koeln-U7':398057,'A3-koeln-U9':398059,'A3-koeln-U11':398061,
 'A3-frankfurt-U4':186645,'A3-frankfurt-U6':186644,
 'A3-frankfurt-U8':398709,'A3-frankfurt-U10':186855,
 'A3-frankfurt-U12':186892,'A3-frankfurt-U51':170950,
 'A3-frankfurt-U53':186895,'A48-dernbach-U95':6806117,
 'A48-dernbach-U97':6806118,'A48-dernbach-U99':6806119,
 'A48-koblenz-U42':7330760
};
const admissible=new Set(['primary','primary_link','secondary','secondary_link',
 'tertiary','tertiary_link','trunk','trunk_link','residential','unclassified',
 'living_street','service']);
const speed:Record<string,number>={trunk:75,trunk_link:38,primary:65,primary_link:35,
 secondary:55,secondary_link:30,tertiary:47,tertiary_link:25,
 unclassified:35,residential:25,living_street:10,service:12};
const penalty:Record<string,number>={trunk:1,trunk_link:1.55,primary:1,
 primary_link:1.50,secondary:1.13,secondary_link:1.65,tertiary:1.27,
 tertiary_link:1.85,unclassified:1.6,residential:2.1,living_street:5,service:9};
const noCar=new Set(['no','private','agricultural','forestry']);
export function validCarWay(w:OSMWay):boolean{
 const tags=w.tags??{},h=tags.highway;
 return admissible.has(h)&&!noCar.has(tags.access)&&!noCar.has(tags.motor_vehicle)&&
  !noCar.has(tags.motorcar)&&!(tags.service==='parking_aisle')&&
  w.nodes.length>=2&&w.geometry.length===w.nodes.length;
}
export function graphFromWays(ways:readonly OSMWay[]):RoadGraph{
 const adjacency=new Map<number,Segment[]>(),coordinates=new Map<number,Point>();
 const add=(edge:Segment)=>{
  const arr=adjacency.get(edge.from)??[];arr.push(edge);adjacency.set(edge.from,arr);
 };
 for(const way of ways){
  if(!validCarWay(way))continue;
  const highway=way.tags.highway,oneway=way.tags.oneway,roundabout=way.tags.junction==='roundabout';
  const backward=oneway==='-1',forward=oneway==='yes'||oneway==='1'||roundabout;
  for(let i=1;i<way.nodes.length;i++){
   const a=way.nodes[i-1]!,b=way.nodes[i]!,pa:Point=[way.geometry[i-1]!.lat,way.geometry[i-1]!.lon],
    pb:Point=[way.geometry[i]!.lat,way.geometry[i]!.lon];
   const d=metres(pa,pb);if(d<.1||!Number.isFinite(d))continue;
   coordinates.set(a,pa);coordinates.set(b,pb);
   const weight=d*penalty[highway];
   if(!backward)add({from:a,to:b,lengthM:d,weight,roadClass:highway,points:[pa,pb]});
   if(!forward)add({from:b,to:a,lengthM:d,weight,roadClass:highway,points:[pb,pa]});
  }
 }
 return {adjacency,coordinates};
}
function nearestNode(graph:RoadGraph,point:Point):{id:number;distanceM:number}|null{
 let id=0,distanceM=Infinity;
 for(const [node,coord] of graph.coordinates){
  const d=metres(coord,point);
  if(d<distanceM){id=node;distanceM=d;}
 }
 return Number.isFinite(distanceM)?{id,distanceM}:null;
}
export interface GraphRoute {points:Point[];lengthM:number;freeMinutes:number;startGapM:number;endGapM:number}
export function shortestOSMRoute(graph:RoadGraph,from:Point,to:Point,maxSnapM=1900):GraphRoute|null{
 const source=nearestNode(graph,from),target=nearestNode(graph,to);
 if(!source||!target||source.distanceM>maxSnapM||target.distanceM>maxSnapM||source.id===target.id)return null;
 const distances=new Map<number,number>([[source.id,0]]),previous=new Map<number,Segment>(),
  heap:{id:number;cost:number}[]=[];
 function push(id:number,cost:number){
  heap.push({id,cost});let i=heap.length-1;
  while(i>0){const p=(i-1)>>1;if(heap[p]!.cost<=cost)break;heap[i]=heap[p]!;i=p;}heap[i]={id,cost};
 }
 function pop():{id:number;cost:number}|undefined{
  if(!heap.length)return;
  const head=heap[0]!,last=heap.pop()!;
  if(heap.length){
   let i=0;while(i*2+1<heap.length){
    let child=i*2+1;
    if(child+1<heap.length&&heap[child+1]!.cost<heap[child]!.cost)child++;
    if(heap[child]!.cost>=last.cost)break;
    heap[i]=heap[child]!;i=child;
   }heap[i]=last;
  }
  return head;
 }
 push(source.id,0);
 let iterations=0;
 while(heap.length&&iterations++<240000){
  const next=pop()!;
  if(next.cost>(distances.get(next.id)??Infinity)+.001)continue;
  if(next.id===target.id)break;
  for(const edge of graph.adjacency.get(next.id)??[]){
   const cost=next.cost+edge.weight;
   if(cost<(distances.get(edge.to)??Infinity)){
    distances.set(edge.to,cost);previous.set(edge.to,edge);push(edge.to,cost);
   }
  }
 }
 if(!distances.has(target.id))return null;
 const edges:Segment[]=[];
 let at=target.id;
 for(let i=0;i<200000&&at!==source.id;i++){
  const e=previous.get(at);if(!e)return null;edges.push(e);at=e.from;
 }
 if(at!==source.id)return null;
 edges.reverse();
 const points=[graph.coordinates.get(source.id)!],lengthM=edges.reduce((a,b)=>a+b.lengthM,0);
 let freeMinutes=0;
 for(const e of edges){points.push(e.points[1]!);freeMinutes+=e.lengthM/1000/(speed[e.roadClass]??30)*60;}
 const straight=metres(from,to);
 if(lengthM<straight*.66||lengthM>Math.max(8000,straight*5)||lengthM>120000)return null;
 return {points,lengthM,freeMinutes,startGapM:source.distanceM,endGapM:target.distanceM};
}
export function parseOSMWays(data:unknown):OSMWay[]{
 if(!data||typeof data!=='object')return [];
 const items=(data as {elements?:unknown}).elements;
 if(!Array.isArray(items))return [];
 const byId=new Map<number,OSMWay>();
 const add=(id:number,nodes:unknown,tags:unknown,geometry:unknown)=>{
  if(!Array.isArray(nodes)||!Array.isArray(geometry)||nodes.length!==geometry.length)return;
  if(!nodes.every(x=>typeof x==='number')||!geometry.every(x=>x&&
   typeof x==='object'&&Number.isFinite((x as {lat:number}).lat)&&Number.isFinite((x as {lon:number}).lon)))return;
  byId.set(id,{id,nodes:nodes as number[],tags:tags&&typeof tags==='object'?tags as Record<string,string>:{},
   geometry:geometry as {lat:number;lon:number}[]});
 };
 for(const v of items){
  if(!v||typeof v!=='object')continue;
  const item=v as {type:string;id:number;nodes?:unknown;tags?:unknown;geometry?:unknown;
   members?:{type:string;ref:number;geometry?:unknown}[]};
  if(item.type==='way')add(item.id,item.nodes,item.tags,item.geometry);
  if(item.type==='relation')for(const mem of item.members??[]){
   // Relation out geom provides coordinates but not node ids; only these members
   // cannot create reliable shared-node topological connections.
   // Fetch the member ways including node IDs instead.
   if(mem.type==='way'&&Array.isArray(mem.geometry))continue;
  }
 }
 return [...byId.values()];
}
export function relationQuery(id:number):string{
 if(!Number.isInteger(id)||id<1)throw Error('Ungültige OSM-Relation');
 return `[out:json][timeout:25];relation(${id});way(r);out body geom;`;
}
export function bboxQuery(from:Point,to:Point):string{
 const minLat=Math.max(50.25,Math.min(from[0],to[0])-.038),maxLat=Math.min(50.8,Math.max(from[0],to[0])+.038);
 const minLon=Math.max(7.17,Math.min(from[1],to[1])-.052),maxLon=Math.min(8.23,Math.max(from[1],to[1])+.052);
 return `[out:json][timeout:25];way["highway"~"^(primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|trunk|trunk_link|residential|unclassified|living_street|service)$"](${minLat.toFixed(5)},${minLon.toFixed(5)},${maxLat.toFixed(5)},${maxLon.toFixed(5)});out body geom;`;
}
export const OSM_OVERPASS_API='https://overpass.kumi.systems/api/interpreter';
export const OSM_OVERPASS_FALLBACKS=[
 OSM_OVERPASS_API,'https://overpass-api.de/api/interpreter',
 'https://overpass.private.coffee/api/interpreter'
];
export async function fetchOSMWays(query:string,fetcher:typeof fetch=fetch):Promise<OSMWay[]>{
 let lastError='Keine Overpass-Verbindung';
 for(const endpoint of OSM_OVERPASS_FALLBACKS){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),28000);
  try{
   const response=await fetcher(endpoint,{method:'POST',body:'data='+encodeURIComponent(query),
    headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},signal:controller.signal});
   if(!response.ok)throw Error('HTTP '+response.status);
   const obj:unknown=await response.json();
   const ways=parseOSMWays(obj);
   if(!ways.length)throw Error('Keine befahrbaren OSM-Straßendaten gefunden');
   return ways;
  }catch(e){
   lastError=e instanceof Error?e.message:'OSM-Netzwerkfehler';
  }finally{clearTimeout(timer);}
 }
 throw Error('OSM-Straßen derzeit nicht abrufbar ('+lastError+'). Keine simulierte Verbindung aktiviert.');
}
function roadClassCapacity(ways:readonly OSMWay[]):number{
 // Conservative 1-lane-equivalent discharge on mixed local roads.
 const share=ways.filter(w=>validCarWay(w));
 const primary=share.filter(w=>['primary','trunk'].includes(w.tags.highway)).length;
 return primary>share.length*.65?1100:700;
}
export async function loadDetourGeometry(
 link:DiversionLink,from:Exit,to:Exit,fetcher:typeof fetch=fetch
):Promise<DetourGeometry>{
 if(from.road!==link.fromRoad||from.ref!==link.fromRef||!to||from.road!==to.road)throw Error('U-Route und Ausfahrten passen nicht');
 if(link.toRef!==null&&link.toRef!==to.ref)throw Error('U-Route endet an einer anderen Anschlussstelle');
 const relationId=OFFICIAL_OSM_RELATION_IDS[link.id]??null;
 let official:null|{route:GraphRoute;ways:OSMWay[]}=null;
 if(relationId!==null){
  try{
   const ways=await fetchOSMWays(relationQuery(relationId),fetcher);
   const route=shortestOSMRoute(graphFromWays(ways),from.position,to.position);
   if(route&&route.startGapM<1300&&route.endGapM<1300)official={route,ways};
  }catch{/* fallback on genuinely mapped local-road graph only */}
 }
 let route=official?.route,ways=official?.ways,source:DetourGeometry['source']='osm-official-relation';
 if(!route){
  ways=await fetchOSMWays(bboxQuery(from.position,to.position),fetcher);
  route=shortestOSMRoute(graphFromWays(ways),from.position,to.position);
  source='osm-routed-infill';
 }
 if(!route||route.startGapM>1900||route.endGapM>1900)
  throw Error('OSM-Straßennetz nicht durchgehend verbunden: Route nicht freigegeben');
 if(!Number.isFinite(route.lengthM)||!Number.isFinite(route.freeMinutes)||route.freeMinutes<=0)throw Error('Ungültige Umleitungsstrecke');
 return {id:link.id,path:link.path,sourceExitRef:from.ref,targetExitRef:to.ref,points:route.points,
  lengthKm:route.lengthM/1000,freeMinutes:route.freeMinutes,roadCapacityVph:roadClassCapacity(ways!),
  source,relationId:source==='osm-official-relation'?relationId:null,
  label:source==='osm-official-relation'?link.code+' · OSM-U-Relation':link.code+' · simulierte OSM-Verbindung'};
}
