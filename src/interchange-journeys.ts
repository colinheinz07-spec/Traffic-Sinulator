/** Committed journeys through a still-open AD branch. Motorway legs use
 * actual OSM ramps; the following local-road leg keeps the existing
 * explicitly approximate bundled geometry. */
import type {AutomaticDiversion} from './auto-diversions.js';
import type {Exit,Ramp,RoadId} from './core.js';
import type {SimEvent} from './events.js';
import type {DetourConfig} from './detour-flow.js';
import type {CellRouteState} from './traffic-cells.js';
import {INTERCHANGE_DIVERSION_START_MIN,interchangeTrafficShare,type RampConnection} from './interchange.js';
import type {Corridor,Jam} from './spatial.js';
import type {DetourGeometry} from './detour-routing.js';
import {baselineCapacity,eventCapacity,defaultDemand,type PathKey} from './traffic.js';
import {positionM,closureGate,metres} from './spatial.js';
import {cellQueueSpans} from './traffic-cells.js';
import {diversionJunctions,type JunctionAnchor,type DiversionLink} from './diversions.js';
import {bundledTargets,bundledDetourGeometry,isNetworkDestination} from './bundled-detours.js';
import {speedDelayInCells} from './speed-delay.js';
import type {RoutedDetour} from './routed-traffic.js';
import {queueFundamentalDiagram,colorAtSpeed} from './traffic-physics.js';

/** A detour of one configured turn cannot acquire the entire A48's
 * destination mix when its mainline reference volume is larger. */
export function journeyTrafficShare(config:DetourConfig,demands:Readonly<Partial<Record<PathKey,number>>>):number{
 const target=config.journey?.kind==='via'?config.journey.targetPath:config.targetPath;
 if(!config.movementId||!target)return 0;
 const share=interchangeTrafficShare(config.movementId,config.path,target,demands);
 if(config.journey?.kind!=='via')return share;
 const source=Math.max(0,demands[config.path]??defaultDemand(config.path));
 const movement=Math.max(0,demands[config.movementId]??defaultDemand(config.movementId));
 return source>0?Math.min(share,movement/source):0;
}

export function rampCapacity(id:PathKey,events:readonly SimEvent[],demands:Readonly<Partial<Record<PathKey,number>>>):number{
 return Math.min(baselineCapacity(id),...events.filter(e=>e.pathKey===id).map(e=>eventCapacity(e,demands[id])));
}
export function journeyRampCapacity(config:DetourConfig,events:readonly SimEvent[],
 demands:Readonly<Partial<Record<PathKey,number>>>):number{
 const j=config.journey;
 if(j?.kind!=='via'&&j?.kind!=='protected'&&j?.kind!=='evacuation')return config.geometry.roadCapacityVph;
 const total=rampCapacity(j.rampId,events,demands);
 // The alternate Köln ramp also carries its normal Köln traffic. Do not
 // give the additional Frankfurt journey another full copy of its lanes.
 const reserved=j.kind==='via'?(demands[j.rampId]??defaultDemand(j.rampId)):0;
 return Math.max(0,total-reserved);
}
/** Queued cars on a motorway leg already belong to that leg's conserved
 * ledger. Plot them on the real ramp, never again on its feeder motorway;
 * feeder backpressure is owned by the actual mainline cells. */
export function journeyRampJams(entries:readonly RoutedDetour[],routes:Readonly<Record<PathKey,Corridor>>,
 events:readonly SimEvent[],demands:Readonly<Partial<Record<PathKey,number>>>):Jam[]{
 const groups=new Map<PathKey,RoutedDetour[]>();
 for(const e of entries){const j=e.config.journey;
  if(j?.kind==='via'||j?.kind==='protected'||j?.kind==='evacuation')groups.set(j.rampId,[...(groups.get(j.rampId)??[]),e]);
 }
 const result:Jam[]=[];
 for(const [path,group] of groups){
  const waiting=group.reduce((n,e)=>n+e.state.waitingRoad+e.state.waitingMerge,0);
  if(waiting<.01)continue;
  const route=routes[path],anchorM=Math.max(0,route.lengthM-.5);
  const flow=Math.min(rampCapacity(path,events,demands),group.reduce((n,e)=>n+(e.state.travelFlowVph??0),0));
  const base=queueFundamentalDiagram(Math.min(flow,baselineCapacity(path)*.95),1,path);
  const density=Math.max(base.densityVehPerKm,waiting/(anchorM/1000));
  const queueM=waiting/density*1000,speedKmh=flow>0?Math.min(80,flow/density):0;
  result.push({id:'journey-ramp:'+path,pathKey:path,eventKind:null,point:route.points.at(-1)!,anchorM,
   queueVehicles:waiting,queueM,visibleQueueM:queueM,delayMin:flow>0?waiting/flow*60:null,
   capacityVph:flow,speedKmh,color:colorAtSpeed(speedKmh),released:flow>0&&group.every(e=>(e.desiredPercent??0)===0),outOfBoundsM:0});
 }
 return result;
}
function anchor(path:RoadId,ref:string,name:string,position:Exit['position'],metre:number):JunctionAnchor{
 return {road:path.startsWith('A3')?'A3':'A48',ref,name,position,metre,source:'osm-ramp',isInterchange:true};
}
type MotorwayLeg=Pick<Ramp,'id'|'from'|'to'|'points'>;
function motorwayGeometry(id:string,ramp:MotorwayLeg):DetourGeometry{
 const lengthKm=ramp.points.slice(1).reduce((s,p,i)=>s+metres(ramp.points[i]!,p),0)/1000;
 return {id,path:ramp.from,sourceExitRef:'AD',targetExitRef:'AD',points:ramp.points,
  lengthKm,freeMinutes:Math.max(.25,lengthKm/80*60),roadCapacityVph:1500,junctionCount:0,trafficLightCount:0,
  source:'osm-motorway-ramp',relationId:null,label:'OSM-Überleitung am AD Dernbach',
  storageVehicles:Math.max(10,lengthKm*130),sections:[{id:'motorway:'+ramp.id,capacityVph:1500}]};
}
function plan(key:string,source:RoadId,from:JunctionAnchor,target:RoadId,to:JunctionAnchor,
 geometry:DetourGeometry,movementId:PathKey|undefined,event:SimEvent|null):AutomaticDiversion{
 const link:DiversionLink={id:key,code:'AD',path:source,fromRoad:from.road,fromRef:from.ref,
  toRoad:to.road,toRef:to.ref,evidence:'partial',description:'Zielgebundene Fahrt über einen offenen AD-Zweig'};
 return {key,path:source,targetPath:target,from,to,geometry,link,movementId,event,
  causeId:'journey:'+key,delayMin:null};
}
/** A formal closure on the intended arm or ramp requires another route
 * even when its empty closed cells cannot yield a numerical travel loss. */
export function closedMovementEvent(movementId:PathKey,target:RoadId,merge:number,firstExit:number,
 events:readonly SimEvent[],routes:Readonly<Partial<Record<PathKey,Corridor>>>):SimEvent|undefined{
 return events.find(e=>{
  if(e.kind!=='closure')return false;
  if(e.pathKey===movementId)return true;
  if(e.pathKey!==target||!routes[target])return false;
  const at=positionM(routes[target]!,e.point);
  return at!==null&&at<firstExit&&at+e.settings.lengthM>merge;
 });
}
export function viaJourneyUsable(config:DetourConfig,cells:Readonly<Partial<Record<PathKey,CellRouteState>>>,
 routes:Readonly<Partial<Record<PathKey,Corridor>>>,events:readonly SimEvent[],exits:readonly Exit[],
 demands:Readonly<Partial<Record<PathKey,number>>>):boolean{
 const j=config.journey;
 if(j?.kind!=='via'||journeyRampCapacity(config,events,demands)<=0)return false;
 const source=routes[config.path]!,target=routes[config.targetPath!]!;
 for(const e of events){
  if(e.pathKey===config.path){
   const gate=closureGate(source,e,exits),at=positionM(source,e.point);
   if(gate&&gate.metre<config.sourceEndM!&&gate.endM>j.decisionM||
    at!==null&&at>=j.decisionM&&at<config.sourceEndM!&&eventCapacity(e,demands[config.path])===0)return false;
  }
  if(e.pathKey===config.targetPath){
   const gate=closureGate(target,e,exits),at=positionM(target,e.point);
   if(gate&&gate.metre<j.localExitM&&gate.endM>config.toM||
    at!==null&&at>=config.toM&&at<j.localExitM&&eventCapacity(e,demands[config.targetPath!])===0)return false;
  }
 }
 const targetGrid=cells[config.targetPath!];
 if(targetGrid&&speedDelayInCells(targetGrid,config.toM,j.localExitM,j.localExitM).blocked)return false;
 return true;
}
export function interchangeJourneys(events:readonly SimEvent[],routes:Readonly<Record<PathKey,Corridor>>,
 exits:readonly Exit[],cells:Partial<Record<PathKey,CellRouteState>>,connections:readonly RampConnection[],
 turnDelays:Readonly<Partial<Record<PathKey,number>>>={}):AutomaticDiversion[]{
 const result:AutomaticDiversion[]=[];
 const rampFor=(c:RampConnection):MotorwayLeg=>({id:c.rampId,from:c.from,to:c.to,points:routes[c.rampId].points});
 // If the closed A3 arm starts after an open A48 turn, protect that
 // destination between the final regular exit and the real turn node.
 for(const event of events){
  if(event.kind!=='closure'||!event.pathKey.startsWith('A3-'))continue;
  const path=event.pathKey as RoadId,route=routes[path],gate=closureGate(route,event,exits),at=positionM(route,event.point);
  if(!gate?.exit||at===null)continue;
  for(const c of connections.filter(c=>c.from===path&&c.to==='A48-koblenz'&&
   c.rampEntryM>gate.metre+1&&c.rampEntryM<gate.endM)){
   const approachClosed=events.some(e=>{
    if(e.kind!=='closure'||e.pathKey!==path)return false;
    const block=closureGate(route,e,exits),point=positionM(route,e.point);
    return block&&point!==null&&block.metre<c.rampEntryM&&point<=c.rampEntryM;
   });
   if(approachClosed||rampCapacity(c.rampId,events,{})<=0){
    const from=diversionJunctions(path,exits,route).find(j=>j.ref===gate.exit!.ref)!;
    const to=bundledTargets(c.to,exits,routes[c.to]).find(j=>j.metre>c.downstreamMergeM)!;
    const key='CLOSED-TURN-'+event.id+'-'+c.rampId;
    const option=plan(key,path,from,c.to,to,bundledDetourGeometry(key,path,from,to,exits),c.rampId,event);
    option.sourceEndM=c.rampEntryM;option.targetEntryM=c.downstreamMergeM;
    option.journey={kind:'closure-bypass',forcedByEventId:event.id};result.push(option);continue;
   }
   const ramp=rampFor(c);
   const key='OPEN-TURN-'+event.id+'-'+c.rampId,token='open:'+key;
   const from=anchor(path,'AD-'+c.rampId,'AD Dernbach · A48-Abzweig',ramp.points[0]!,c.rampEntryM);
   const to=anchor(c.to,'merge-'+c.rampId,'AD Dernbach · A48 Koblenz',ramp.points.at(-1)!,c.downstreamMergeM);
   const option=plan(key,path,from,c.to,to,motorwayGeometry(key,ramp),c.rampId,event);
   option.sourceEndM=c.rampEntryM;option.targetEntryM=c.downstreamMergeM;
   option.journey={kind:'protected',token,rampId:c.rampId,closureEventId:event.id,gateM:gate.metre,forcedByEventId:event.id};
   result.push(option);
   // Only cars already PAST the last regular exit and still BEFORE the
   // open AD branch can leave the closed arm this way. New through trips
   // use the mandatory regular exit. No backward motorway jump is allowed.
   const localFrom=diversionJunctions(c.to,exits,routes[c.to]).find(j=>!j.isInterchange&&j.metre>c.downstreamMergeM);
   const localTo=bundledTargets(path,exits,route).find(j=>j.metre>=gate.endM-1);
   if(localFrom&&localTo){
    const key='EVACUATE-'+event.id+'-'+c.rampId+'-'+localTo.ref,token='evacuation:'+key;
    const escape=plan(key,path,from,c.to,to,motorwayGeometry(key,ramp),undefined,event);
    escape.sourceEndM=c.rampEntryM;escape.targetEntryM=c.downstreamMergeM;
    escape.journey={kind:'evacuation',token,rampId:c.rampId,closureEventId:event.id,gateM:gate.metre,forcedByEventId:event.id};
    result.push(escape);
    const localKey=key+'-LOCAL',local=plan(localKey,c.to,localFrom,path,localTo,
     bundledDetourGeometry(localKey,c.to,localFrom,localTo,exits),undefined,event);
    local.journey={kind:'continuation',token};result.push(local);
   }
  }
 }
 const intended=connections.find(c=>c.rampId==='ramp-a48-to-frankfurt');
 const alternate=connections.find(c=>c.rampId==='ramp-a48-to-koeln');
 if(!intended||!alternate)return result;
 const source=intended.from,target=intended.to,sourceRoute=routes[source],targetRoute=routes[target];
 const from=diversionJunctions(source,exits,sourceRoute).filter(e=>!e.isInterchange&&e.metre<intended.rampEntryM).at(-1)!;
 const localFrom=diversionJunctions(alternate.to,exits,routes[alternate.to]).find(e=>!e.isInterchange&&e.metre>alternate.downstreamMergeM)!;
 const targets=bundledTargets(target,exits,targetRoute),first=targets.find(e=>e.metre>intended.downstreamMergeM)!;
 const relevant=cells[target]?cellQueueSpans(cells[target]!).filter(s=>s.fromM<first.metre&&s.toM>intended.downstreamMergeM):[];
 const related=events.filter(e=>e.pathKey===intended.rampId||e.pathKey===target&&(()=>{
  const at=positionM(targetRoute,e.point);return at!==null&&at<Math.max(first.metre,...relevant.map(s=>s.toM))&&at+e.settings.lengthM>intended.downstreamMergeM;})());
 if(!related.length&&!relevant.length&&(turnDelays[intended.rampId]??0)<INTERCHANGE_DIVERSION_START_MIN)return result;
 let end=Math.max(intended.downstreamMergeM,...relevant.map(s=>s.toM));
 for(const e of related)if(e.pathKey===target){const at=positionM(targetRoute,e.point)!;
  end=Math.max(end,closureGate(targetRoute,e,exits)?.endM??at+e.settings.lengthM+50);}
 const localTo=targets.find(e=>isNetworkDestination(e)||e.metre>=end-1&&e.metre>intended.downstreamMergeM)!;
 const token='via-frankfurt:'+localTo.ref,key='A48-VIA-KOELN-TO-'+localTo.ref;
 const ramp=rampFor(alternate);
 const rampFrom=anchor(source,'AD-'+alternate.rampId,'AD Dernbach · Köln-Rampe',ramp.points[0]!,Math.min(alternate.rampEntryM,sourceRoute.lengthM-.1));
 const rampTo=anchor(alternate.to,'merge-'+alternate.rampId,'AD Dernbach · A3 Köln',ramp.points.at(-1)!,alternate.downstreamMergeM);
 const localKey='A3-RANSBACH-VIA-FRANKFURT-'+localTo.ref;
 const localGeometry=bundledDetourGeometry(localKey,alternate.to,localFrom,localTo,exits);
 const geometry=motorwayGeometry(key,ramp);
 const forced=closedMovementEvent(intended.rampId,target,intended.downstreamMergeM,first.metre,events,routes);
 const via=plan(key,source,rampFrom,alternate.to,rampTo,geometry,intended.rampId,null);
 via.sourceEndM=intended.rampEntryM;via.targetEntryM=alternate.downstreamMergeM;
 via.journey={kind:'via',token,rampId:alternate.rampId,decisionM:from.metre,targetPath:target,
  targetEntryM:intended.downstreamMergeM,toM:localTo.metre,localExitM:localFrom.metre,
  choiceMinutes:geometry.freeMinutes+(localFrom.metre-alternate.downstreamMergeM)/1000/130*60+localGeometry.freeMinutes,
  forcedByEventId:forced?.id};
 result.push(via);
 const continuation=plan(localKey,alternate.to,localFrom,target,localTo,localGeometry,intended.rampId,null);
 continuation.journey={kind:'continuation',token};
 result.push(continuation);
 return result;
}
