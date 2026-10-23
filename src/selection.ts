/** Map hit-testing remains separate from rendering and transport logic.
 * All snapped positions are interpolated ONLY on verified OSM road geometries.
 */
import {nearestPolyline,exitPosition,type Point,type Road,type Ramp,type Exit,type RoadId} from './core.js';

export type MapHit =
  | {kind:'road';road:Road;ramp?:never;point:Point;distance:number;fraction:number;key:RoadId}
  | {kind:'ramp';road?:never;ramp:Ramp;point:Point;distance:number;fraction:number;key:string};

/** Reduce hundreds of OSM ways to one candidate for each motorway direction and each ramp. */
export function mapCandidates(roads:readonly Road[],ramps:readonly Ramp[],tap:[number,number],project:(p:Point)=>[number,number],tolerance=18):MapHit[]{
 const hits=new Map<string,MapHit>();
 for(const road of roads){
  const h=nearestPolyline(road.points,tap,project);
  if(h.distance>tolerance)continue;
  const candidate:MapHit={kind:'road',road,point:h.point,distance:h.distance,fraction:h.fraction,key:road.road};
  const existing=hits.get(candidate.key);
  if(!existing||h.distance<existing.distance)hits.set(candidate.key,candidate);
 }
 for(const ramp of ramps){
  const h=nearestPolyline(ramp.points,tap,project);
  if(h.distance>tolerance)continue;
  const candidate:MapHit={kind:'ramp',ramp,point:h.point,distance:h.distance,fraction:h.fraction,key:ramp.id};
  const existing=hits.get(candidate.key);
  if(!existing||h.distance<existing.distance)hits.set(candidate.key,candidate);
 }
 return [...hits.values()].sort((a,b)=>a.distance-b.distance||a.key.localeCompare(b.key));
}

/** If nearby physically overlapping carriageways cannot be resolved from a finger tap,
 * explicitly ask which one; never silently choose the wrong direction. */
export function chooseMapHits(hits:readonly MapHit[],ambiguityPx=7):MapHit[]{
 if(!hits.length)return [];
 return hits.filter(hit=>hit.distance-hits[0]!.distance<=ambiguityPx);
}

/** Geodesic proximity is approximate; do not label as motorway driving distance. */
export function airDistanceMetres(a:Point,b:Point):number{
 const rad=Math.PI/180;
 const p1=a[0]*rad,p2=b[0]*rad,dp=(b[0]-a[0])*rad,dl=(b[1]-a[1])*rad;
 const t=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
 return 6371000*2*Math.atan2(Math.sqrt(t),Math.sqrt(Math.max(0,1-t)));
}
export function closestJunction(hit:MapHit,exits:readonly Exit[]):{exit:Exit;distanceKm:number}|null{
 if(hit.kind==='ramp')return null; // AD Dernbach is the known junction of every ramp.
 const motorway=hit.road.road.startsWith('A3')?'A3':'A48';
 let best:{exit:Exit;distanceKm:number}|null=null;
 for(const exit of exits){
  if(exit.road!==motorway)continue;
  const distanceKm=airDistanceMetres(hit.point,exitPosition(exit,hit.key))/1000;
  if(!best||distanceKm<best.distanceKm)best={exit,distanceKm};
 }
 return best;
}

/** Purely ordinal names: no unsupported assumptions about hard shoulders or lane use. */
export function lanePositions(count:number):string[]{
 if(!Number.isInteger(count)||count<1||count>7)return [];
 if(count===1)return ['Fahrstreifen'];
 if(count===2)return ['Rechts','Links'];
 const names=['Rechts'];
 for(let i=1;i<count-1;i++)names.push(count===3?'Mitte':`Mitte ${i}`);
 names.push('Links');
 return names;
}

export function hitLabel(hit:MapHit):string{
 if(hit.kind==='ramp')return hit.ramp.name;
 const titles:Record<RoadId,string>={'A3-koeln':'A3 → Köln','A3-frankfurt':'A3 → Frankfurt','A48-dernbach':'A48 → Dernbach','A48-koblenz':'A48 → Koblenz'};
 return titles[hit.road.road];
}
