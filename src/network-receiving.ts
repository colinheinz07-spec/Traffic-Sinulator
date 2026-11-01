/** Endpoint-connected mainlines exchange a receiving signal. This limits
 * actual discharge in the feeder CTM, rather than painting a second queue.
 * Aggregate motorway demands remain calibrated independently (not OD trips). */
import {extensionRoutes} from './network-extensions.js';
import type {PathKey} from './traffic.js';
import {positionM,metres,type Corridor} from './spatial.js';
import type {CellRouteState} from './traffic-cells.js';
import {CONGESTION_WAVE_KMH,QUEUE_JAM_DENSITY_PER_LANE} from './traffic-physics.js';
export interface MainlineMerge {from:PathKey;to:PathKey;mergeM:number}
export function mainlineMerges(routes:Readonly<Record<PathKey,Corridor>>):MainlineMerge[]{
 const mains:PathKey[]=['A3-koeln','A3-frankfurt','A48-dernbach','A48-koblenz',...extensionRoutes.filter(r=>r.kind==='motorway').map(r=>r.id)];
 return mains.flatMap(from=>{const end=routes[from].points.at(-1)!;return mains.filter(to=>to!==from).flatMap(to=>{
  const route=routes[to],at=route.points.findIndex(p=>metres(p,end)<.05);if(at<0)return [];
  const mergeM=positionM(route,end,1)!;return mergeM<route.lengthM-1?[{from,to,mergeM}]:[];
 });});
}
export function downstreamReceiving(cells:Readonly<Partial<Record<PathKey,CellRouteState>>>,merges:readonly MainlineMerge[]):Partial<Record<PathKey,number>>{
 const output:Partial<Record<PathKey,number>>={};
 for(const link of merges){
  const target=cells[link.to];if(!target)continue;
  const i=Math.min(target.cells.length-1,Math.floor(link.mergeM/target.cellM)),cell=target.cells[i]!;
  const lanes=cell.openLanes?.length??Math.max(1,Math.round((cell.jamDensityVehKm??390)/QUEUE_JAM_DENSITY_PER_LANE));
  const jam=cell.jamDensityVehKm??QUEUE_JAM_DENSITY_PER_LANE*lanes;
  const formal=target.closures?.some(g=>link.mergeM>=g.fromM-1&&link.mergeM<g.toM-1);
  if(!formal&&(cell.speedKmh>65||cell.densityVehKm<=(cell.criticalDensityVehKm??20*lanes)*1.1))continue;
  const supply=formal||lanes===0?0:Math.max(0,CONGESTION_WAVE_KMH*(jam-cell.densityVehKm));
  output[link.from]=Math.min(output[link.from]??Infinity,supply);
 }
 return output;
}
