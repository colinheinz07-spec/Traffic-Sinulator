/** Directional choices at every reachable normal exit, including network
 * boundaries. Every choice has an offline simulated side-road corridor.
 * This planner itself never removes vehicles.
 */
import type {Exit,RoadId} from './core.js';
import type {SimEvent} from './events.js';
import {positionM,closureGate,type Corridor} from './spatial.js';
import {DIVERSION_LINKS,diversionJunctions,type DiversionLink,type JunctionAnchor} from './diversions.js';
import {speedDelayInCells} from './speed-delay.js';
import type {CellRouteState} from './traffic-cells.js';
import type {PathKey} from './traffic.js';
import type {RampConnection} from './interchange.js';
import {bundledTargets,isNetworkDestination} from './bundled-detours.js';
export interface AutomaticDiversion {
 key:string;event:SimEvent;path:RoadId;from:JunctionAnchor;to:JunctionAnchor;link:DiversionLink;
 delayMin:number|null;
 targetPath?:RoadId;sourceEndM?:number;targetEntryM?:number;
}
export function automaticDiversions(events:readonly SimEvent[],corridors:Readonly<Record<PathKey,Corridor>>,
 exits:readonly Exit[],cells:Partial<Record<PathKey,CellRouteState>>,connections:readonly RampConnection[]=[]):AutomaticDiversion[]{
 const plans=new Map<string,AutomaticDiversion>();
 for(const event of events){
  if(event.pathKey.startsWith('ramp-'))continue;
  const path=event.pathKey as RoadId,route=corridors[path],at=positionM(route,event.point);
  if(at===null)continue;
  const targets=bundledTargets(path,exits,route),all=targets.filter(x=>!isNetworkDestination(x));
  const section=closureGate(route,event,exits);
  const end=Math.min(route.lengthM,at+event.settings.lengthM+50);
  const after=targets.filter(x=>isNetworkDestination(x)||(section?x.metre>=section.endM-1:x.metre>end));
  for(const connection of connections.filter(c=>c.to===path&&at>c.downstreamMergeM)){
   // Prepare cross-motorway alternatives before the target queue reaches
   // the AD. The remaining journey's delay controls whether anyone uses it.
   const source=connection.from,to=after[0]!;
   const sources=diversionJunctions(source,exits,corridors[source]).filter(x=>!x.isInterchange&&x.metre<connection.rampEntryM-50);
   for(const from of sources){
    const link:DiversionLink={id:source+'-BUNDLED-'+from.ref+'-to-'+path,code:'SIM',path:source,
     fromRoad:from.road,fromRef:from.ref,toRoad:to.road,toRef:to.ref,evidence:'partial',
     description:'Enthaltene simulierte Umfahrung des blockierten Autobahnknotens'};
    const key=link.id+':'+to.ref;
    plans.set(source+':'+from.ref,{key,event,path:source,from,to,link,targetPath:path,
     sourceEndM:connection.rampEntryM,targetEntryM:connection.downstreamMergeM,delayMin:null});
   }
  }
  for(const from of all.filter(x=>section?x.metre<=section.metre+1:x.metre<at-50)){
   const documented=DIVERSION_LINKS.find(l=>l.path===path&&l.fromRef===from.ref);
   const officialTarget=after.find(x=>x.ref===documented?.toRef);
   const to=officialTarget??after[0]!;
   const link=officialTarget?documented!:{id:path+'-BUNDLED-'+from.ref,code:'SIM',path,
    fromRoad:from.road,fromRef:from.ref,toRoad:to.road,toRef:to.ref,evidence:'partial' as const,
    description:'Enthaltene simulierte Umleitung mit angenähertem Verlauf'};
   const time=cells[path]?speedDelayInCells(cells[path]!,from.metre,to.metre):null;
   // Prepare roads when a lane closes, before a long queue has formed.
   // Loading geometry itself never makes drivers leave: the cell node's
   // delay/extra-journey comparison still controls actual departures.
   if(event.kind!=='closure'&&event.closedLanes.length===0&&(!time||!time.blocked&&time.delayMin<5))continue;
   const key=link.id+':'+to.ref,choice={key,event,path,from,to,link,delayMin:time?.blocked?null:time?.delayMin??null};
   const old=plans.get(path+':'+from.ref);
   if(!old||to.metre>old.to.metre)plans.set(path+':'+from.ref,choice);
  }
 }
 // The closest usable exit is loaded first, then earlier alternatives.
 return [...plans.values()].sort((a,b)=>a.path.localeCompare(b.path)||b.from.metre-a.from.metre);
}
