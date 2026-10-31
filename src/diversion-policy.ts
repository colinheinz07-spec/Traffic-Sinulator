/** The queue chooses WHERE to leave: the nearest normal exit before its
 * tail, plus exits still reachable by drivers already inside that queue.
 * Its own time loss chooses WHEN and HOW MANY: voluntary uptake from 45
 * minutes. Remote exits do not inherit a direction-wide delay.
 */
import type {Exit,RoadId} from './core.js';
import type {SimEvent} from './events.js';
import type {DetourConfig,DetourState} from './detour-flow.js';
import {cellQueueSpans,type CellRouteState} from './traffic-cells.js';
import type {PathKey} from './traffic.js';
import {closureGate,type Corridor} from './spatial.js';
import {diversionJunctions,nearestExitBeforeQueue,potentialDiversionPercent} from './diversions.js';
import {speedDelayInCells} from './speed-delay.js';
import {freeSpeedKmh} from './traffic-physics.js';
import {INTERCHANGE_DIVERSION_START_MIN,interchangeTrafficShare} from './interchange.js';
import {closedMovementEvent,viaJourneyUsable,journeyRampCapacity,journeyTrafficShare} from './interchange-journeys.js';
import {accessibleExits,junctionAccess} from './road-controls.js';
import {exitRampVehicles,DEFAULT_EXIT_TERMINAL_VPH} from './junction-traffic.js';

interface ChoiceRoute {config:DetourConfig;state:DetourState;enabled?:boolean}
function exitTerminalWait(source:CellRouteState,metre:number):number{
 const ramp=source.junctions?.find(j=>Math.abs(j.metre-metre)<25);
 return ramp?exitRampVehicles(ramp)/Math.max(1,ramp.exitTerminalVph??DEFAULT_EXIT_TERMINAL_VPH)*60:0;
}
export interface DiversionChoice {percent:number;mandatory:boolean;delayMin:number;upstreamRank:number}
interface JourneyChoice extends DiversionChoice {savingMin:number}
/** A formal closure requires a working route at its exit even when that
 * route was paused for an earlier incident. A return inside the closed
 * section cannot serve as the mandatory route. */
export function requiredDiversionGate(config:DetourConfig,route:Corridor,
 events:readonly SimEvent[],exits:readonly Exit[]){
 const cross=(config.targetPath??config.path)!==config.path;
 if(cross&&config.journey?.kind!=='closure-bypass'&&(!config.movementId||config.path!=='A48-dernbach'))return null;
 for(const event of events){
  const gate=closureGate(route,event,exits,events);
  if(gate?.exit&&Math.abs(config.fromM-gate.metre)<=25&&
   (config.journey?.kind==='closure-bypass'?config.journey.forcedByEventId===event.id:
    cross?(config.sourceEndM??0)>=gate.endM-1:config.exitsNetwork||config.toM>=gate.endM-1))return gate;
 }
 return null;
}
/** Small uptake at 45 minutes, rising with delay. A costly/full bypass
 * reduces willingness. Neither incident age nor a blocked-speed flag is
 * interpreted as infinite delay or as a mandatory off-ramp movement.
 */
export function voluntaryDiversionPercent(delayMin:number,extraMinutes=0,startsAtMin=45):number{
 if(delayMin<startsAtMin-1e-9||!Number.isFinite(delayMin))return 0;
 delayMin=Math.max(startsAtMin,delayMin);
 const saving=Math.max(0,delayMin-Math.max(0,extraMinutes))/delayMin;
 // Keep the small initial uptake and the three-hour upper anchor when a
 // particular movement has a later threshold than ordinary queue bypasses.
 const curveMinute=startsAtMin===45?delayMin:45+Math.max(0,delayMin-startsAtMin)*135/(180-startsAtMin);
 const net=delayMin-Math.max(0,extraMinutes);
 const netMinute=startsAtMin===45?net:45+Math.max(0,net-startsAtMin)*135/(180-startsAtMin);
 // A viable route still saving three hours may attract every traveller.
 // A fixed cost percentage must not make 100% mathematically unreachable.
 const netChoice=net<startsAtMin?0:potentialDiversionPercent(netMinute,false)??0;
 return Math.round(Math.max((potentialDiversionPercent(curveMinute,false)??0)*saving,netChoice)*10)/10;
}
function excessQueue(state:CellRouteState,fromM:number,toM:number,demandVph:number):number{
 const freeDensity=demandVph/freeSpeedKmh(state.pathKey);let vehicles=0;
 for(const cell of state.cells){
  const length=Math.max(0,Math.min(toM,cell.toM)-Math.max(fromM,cell.fromM));
  if(length<=0||cell.speedKmh>65)continue;
  vehicles+=Math.max(0,cell.vehicles-freeDensity*(cell.toM-cell.fromM)/1000)*length/(cell.toM-cell.fromM);
 }
 return vehicles;
}
function interchangeChoice(entry:ChoiceRoute,cells:Readonly<Partial<Record<PathKey,CellRouteState>>>,
 routes:Readonly<Partial<Record<PathKey,Corridor>>>,events:readonly SimEvent[],exits:readonly Exit[],
 demands:Readonly<Partial<Record<PathKey,number>>>,turnDelays:Readonly<Partial<Record<PathKey,number>>>):JourneyChoice{
 const {config,state}=entry,path=config.path,target=config.targetPath!,source=cells[path]!,destination=cells[target]!;
 const route=routes[path]!,targetRoute=routes[target]!,turn=config.sourceEndM!,merge=config.targetEntryM!;
 const share=journeyTrafficShare(config,demands);
 const empty={percent:0,mandatory:false,delayMin:0,upstreamRank:0,savingMin:-Infinity};
 if(share<=0||!Number.isFinite(turn)||!Number.isFinite(merge))return empty;
 const sourceExits=diversionJunctions(path,accessibleExits(route,events,exits,'exit'),route).filter(j=>!j.isInterchange);
 const targetExits=diversionJunctions(target,accessibleExits(targetRoute,events,exits,'exit'),targetRoute).filter(j=>!j.isInterchange);
 const firstTarget=targetExits.find(j=>j.metre>merge+1);
 const lastSource=sourceExits.filter(j=>j.metre<turn-1).at(-1);
 const pastTurn=path==='A3-koeln'&&target==='A48-koblenz';
 const postExit=pastTurn?sourceExits.find(j=>j.metre>turn):undefined;
 if(pastTurn&&(!postExit||Math.abs(postExit.metre-config.fromM)>25))return empty;
 for(const event of events){
  const gate=closureGate(targetRoute,event,exits,events);
  if(gate&&config.toM>=gate.metre-25&&config.toM<gate.endM-25)return empty;
 }
 const service=Math.max(1,config.geometry.roadCapacityVph);
 const loss=(grid:CellRouteState,from:number,to:number)=>{
  const read=speedDelayInCells(grid,from,to,to+grid.cellM);
  return read.blocked?Math.max(read.delayMin,excessQueue(grid,from,to,demands[grid.pathKey]??0)/service*60):read.delayMin;
 };
 const extension=Math.max(0,config.fromM-turn);
 const normalFree=(Math.max(0,turn-config.fromM)+Math.max(0,config.toM-merge))/1000/freeSpeedKmh(path)*60;
 const extra=Math.max(0,config.geometry.freeMinutes+extension/1000/freeSpeedKmh(path)*60-normalFree)+
  (extension>0?loss(source,turn,config.fromM):0)+(state.waitingRoad+state.waitingMerge)/service*60+
  (config.journey?.kind==='via'?0:exitTerminalWait(source,config.fromM));
 const spans=cellQueueSpans(source);
 const approach=spans.find(s=>s.fromM<turn&&s.toM>=turn-source.cellM);
 const sourceAnchor=pastTurn?postExit:nearestExitBeforeQueue(path,route,accessibleExits(route,events,exits,'exit'),approach?.fromM??turn,turn);
 const atAnchor=sourceAnchor&&(Math.abs(sourceAnchor.metre-config.fromM)<=25||!pastTurn&&approach&&
  config.fromM>=sourceAnchor.metre-25&&config.fromM>=approach.fromM&&config.fromM<=turn);
 let delayMin=0,desired=0;
 const consider=(value:number)=>{
  const percentage=voluntaryDiversionPercent(value,extra,INTERCHANGE_DIVERSION_START_MIN)*share;
  if(percentage>desired||percentage===desired&&value>delayMin){desired=percentage;delayMin=value;}
 };
 // A source-side queue is relevant only on the final approach to the AD.
 // Earlier exits can react to their own queue, without borrowing a remote
 // branch's delay through an intervening free exit.
 if(!pastTurn&&config.journey?.kind!=='via')for(const span of spans){
  if(span.toM<(lastSource?.metre??turn)-1)continue;
  const nearest=nearestExitBeforeQueue(path,route,accessibleExits(route,events,exits,'exit'),span.fromM,turn);
  const start=Math.max(span.fromM,config.fromM),end=Math.min(span.toM,turn);
  if(!atAnchor&&start<end&&config.fromM>=(nearest?.metre??span.fromM)-25&&config.fromM<=end+25)
   consider(loss(source,start,end));
 }
 if(atAnchor){
  if(config.journey?.kind!=='via'&&closedMovementEvent(config.movementId!,target,merge,
   firstTarget?.metre??targetRoute.lengthM,events,routes))
   return {percent:100*share,mandatory:true,delayMin:0,upstreamRank:0,savingMin:Infinity};
  let targetEnd=merge;
  for(const span of cellQueueSpans(destination)){
   // A free AS on the target arm is closer to a remote queue. Reach that
   // AS normally instead of diverting many kilometres early on A48/A3.
   if(span.fromM>(firstTarget?.metre??targetRoute.lengthM)+1||config.toM<span.toM-1)continue;
   targetEnd=Math.max(targetEnd,Math.min(span.toM,config.toM));
  }
  // These are consecutive, disjoint legs of ONE remaining journey. A
  // maximum of ramp/target readings misses e.g. 17 + 45 = 62 minutes.
  // Clip the target at its actual merge: A3 traffic waiting BEFORE that
  // merge is not ahead of a driver arriving from A48. A via-Köln choice
  // shares the A48 approach, so that common leg cannot count as a saving.
  const approachLoss=!pastTurn&&config.journey?.kind!=='via'&&config.fromM<turn?
   loss(source,config.fromM,turn):0;
  const rampLoss=Math.max(0,turnDelays[config.movementId!]??0);
  consider(approachLoss+rampLoss+(targetEnd>merge?loss(destination,merge,targetEnd):0));
 }
 return {percent:Math.min(desired,(state.choicePercent??0)+5),mandatory:false,delayMin,upstreamRank:0,savingMin:delayMin-extra};
}
function baseDiversionChoice(entry:ChoiceRoute,entries:readonly ChoiceRoute[],
 cells:Readonly<Partial<Record<PathKey,CellRouteState>>>,routes:Readonly<Partial<Record<PathKey,Corridor>>>,
 events:readonly SimEvent[],exits:readonly Exit[],demands:Readonly<Partial<Record<PathKey,number>>>,
 turnDelays:Readonly<Partial<Record<PathKey,number>>>={}):DiversionChoice{
 const {config,state}=entry,path=config.path,target=config.targetPath??path;
 const source=cells[path],destination=cells[target],route=routes[path];
 if(!source||!destination||!route)throw Error('Umleitungsentscheidung ohne verbundenen Fahrbahnzustand');
 const sourceAS=exits.find(e=>e.road===(path.startsWith('A3')?'A3':'A48')&&e.ref===config.geometry.sourceExitRef);
 const targetAS=exits.find(e=>e.road===(target.startsWith('A3')?'A3':'A48')&&e.ref===config.geometry.targetExitRef);
 if(sourceAS&&!junctionAccess(route,events,config.fromM,sourceAS.ref).exit||
  targetAS&&!junctionAccess(routes[target]!,events,config.toM,targetAS.ref).entry)
  return {percent:0,mandatory:false,delayMin:0,upstreamRank:0};
 const journey=config.journey;
 if(journey?.kind==='protected'||journey?.kind==='evacuation'||journey?.kind==='continuation'){
  const at=Math.max(1,Math.min(source.cells.length-1,Math.round(config.fromM/source.cellM)))-1;
  const cell=source.cells[at]!,tagged=cell.routedVehicles?.[journey.token]??0;
  return {percent:cell.vehicles>0?Math.min(100,tagged/cell.vehicles*100):0,mandatory:true,delayMin:0,upstreamRank:0};
 }
 if(journey?.kind==='via'){
  if(entry.enabled===false||!viaJourneyUsable(config,cells,routes,events,exits,demands))
   return {percent:0,mandatory:false,delayMin:0,upstreamRank:0};
  const share=journeyTrafficShare(config,demands);
  if(journey.forcedByEventId&&events.some(e=>e.id===journey.forcedByEventId&&e.kind==='closure'))
   return {percent:100*share,mandatory:true,delayMin:0,upstreamRank:0};
  const onward=cells[config.targetPath!]!;
  const local=entries.find(e=>e.config.journey?.kind==='continuation'&&e.config.journey.token===journey.token);
  const localService=Math.max(1,local?.config.geometry.roadCapacityVph??config.geometry.roadCapacityVph);
  const alternateLoss=speedDelayInCells(onward,config.toM,journey.localExitM,journey.localExitM).delayMin+
   exitTerminalWait(onward,journey.localExitM)+
   (local?local.state.waitingRoad+local.state.waitingMerge:0)/localService*60;
  const virtual:DetourConfig={...config,fromM:journey.decisionM,targetPath:journey.targetPath,toM:journey.toM,
   targetEntryM:journey.targetEntryM,geometry:{...config.geometry,freeMinutes:journey.choiceMinutes+alternateLoss+
    Math.max(0,config.sourceEndM!-journey.decisionM)/1000/freeSpeedKmh(path)*60,
    roadCapacityVph:Math.max(1,journeyRampCapacity(config,events,demands))}};
  const choice=interchangeChoice({...entry,config:virtual},cells,routes,events,exits,demands,turnDelays);
  // Compare the two complete alternatives at their shared decision point.
  // Höhr avoids a slow A48 approach; via Köln shares that approach and must
  // also pay any Köln-arm/Ransbach/local-road wait. No fixed source-delay
  // cutoff can decide which journey is actually quicker.
  const direct=entries.find(e=>e.enabled!==false&&e.config.path===path&&e.config.targetPath===journey.targetPath&&
   e.config.movementId===config.movementId&&Math.abs(e.config.fromM-journey.decisionM)<25&&e.config.journey?.kind!=='via');
  if(direct&&choice.percent>0){
   const other=interchangeChoice(direct,cells,routes,events,exits,demands,turnDelays);
   if(other.percent>0&&other.savingMin>choice.savingMin)
    return {percent:0,mandatory:false,delayMin:choice.delayMin,upstreamRank:0};
  }
  return choice;
 }
 const event=events.find(e=>e.id===config.eventId),cross=target!==path;
 const gate=event?.kind==='closure'&&!cross?closureGate(route,event,exits,events):null;
 const mandatory=requiredDiversionGate(config,route,events,exits)!==null;
 if(mandatory){
  // Retain old route inventories, but admit new traffic to exactly one
  // usable route. If all were paused, the formal closure still exits cars.
  const family=entries.filter(e=>e.config.path===path&&Math.abs(e.config.fromM-config.fromM)<=25&&
   requiredDiversionGate(e.config,route,events,exits));
  const movements=new Set(family.map(e=>e.config.movementId).filter(Boolean));
  const split=path==='A48-dernbach'&&movements.has('ramp-a48-to-koeln')&&movements.has('ramp-a48-to-frankfurt');
  const preferred=family.filter(e=>split?e.config.movementId===config.movementId:!e.config.movementId)
   .sort((a,b)=>Number(a.enabled===false)-Number(b.enabled===false)||
    b.config.toM-a.config.toM||a.config.id.localeCompare(b.config.id))[0];
  const fallback=family.filter(e=>e.config.journey?.kind==='closure-bypass');
  let share=split?(config.movementId?interchangeTrafficShare(config.movementId,path,target,demands):0):1;
  if(config.journey?.kind==='closure-bypass')share=interchangeTrafficShare(config.movementId!,path,target,demands);
  else if(!config.movementId){
   const gate=requiredDiversionGate(config,route,events,exits)!;
   const open=entries.filter(e=>e.config.path===path&&e.config.journey?.kind==='protected'&&
    e.enabled!==false&&events.some(event=>event.id===e.config.journey!.forcedByEventId)&&
    Math.abs(e.config.journey.gateM-gate.metre)<25&&journeyRampCapacity(e.config,events,demands)>0)
    .reduce((s,e)=>s+interchangeTrafficShare(e.config.movementId!,path,e.config.targetPath!,demands),0);
   const local=fallback.reduce((s,e)=>s+interchangeTrafficShare(e.config.movementId!,path,e.config.targetPath!,demands),0);
   share*=Math.max(0,1-open-local);
  }
  const ownFallback=config.journey?.kind==='closure-bypass'&&family.filter(e=>e.config.journey?.kind==='closure-bypass'&&
   e.config.movementId===config.movementId).sort((a,b)=>a.config.id.localeCompare(b.config.id))[0]?.config.id===config.id;
  return {percent:preferred?.config.id===config.id||ownFallback?100*share:0,mandatory:true,delayMin:0,upstreamRank:0};
 }
 if(entry.enabled===false)return {percent:0,mandatory:false,delayMin:0,upstreamRank:0};
 if(config.movementId&&cross){
  if(config.path==='A48-dernbach'&&config.targetPath==='A3-frankfurt'){
   const alternate=entries.find(e=>e.enabled!==false&&e.config.journey?.kind==='via'&&e.config.movementId===config.movementId);
   if(alternate&&routedDiversionChoice(alternate,entries,cells,routes,events,exits,demands,turnDelays).percent>0)
    return {percent:0,mandatory:false,delayMin:0,upstreamRank:0};
  }
  if(entries.some(e=>!e.config.movementId&&e.config.path===path&&Math.abs(e.config.fromM-config.fromM)<=25&&
   requiredDiversionGate(e.config,route,events,exits)))
   return {percent:0,mandatory:false,delayMin:0,upstreamRank:0};
  return interchangeChoice(entry,cells,routes,events,exits,demands,turnDelays);
 }
 // The A48 ends at the two A3 branches. When both destination routes are
 // available, an additional unspecific "leave the network" route must not
 // absorb those same travellers first at the ordinary 45-minute threshold.
 if(path==='A48-dernbach'&&config.exitsNetwork&&!cross){
  const siblings=entries.filter(e=>e.enabled!==false&&e.config.path===path&&Math.abs(e.config.fromM-config.fromM)<=25);
  if(siblings.some(e=>e.config.movementId==='ramp-a48-to-koeln')&&
   siblings.some(e=>e.config.movementId==='ramp-a48-to-frankfurt'))
   return {percent:0,mandatory:false,delayMin:0,upstreamRank:0};
 }
 const sourceEnd=cross?config.sourceEndM??route.lengthM:config.toM;
 const approachEnd=gate?.metre??sourceEnd;
 const upstreamRank=route.key.startsWith('ramp-')?0:diversionJunctions(path as RoadId,exits,route)
  .filter(j=>!j.isInterchange&&j.metre>config.fromM+25&&j.metre<=approachEnd+25).length+1;
 if(gate&&config.fromM>=gate.metre-25)
  return {percent:0,mandatory:false,delayMin:0,upstreamRank};
 const service=Math.max(1,config.geometry.roadCapacityVph);
 const normal=gate?entries.find(e=>e.enabled!==false&&e.config.path===path&&Math.abs(e.config.fromM-gate.metre)<=25&&
  requiredDiversionGate(e.config,route,events,exits)):undefined;
 const gateService=Math.max(1,normal?.config.geometry.roadCapacityVph??service);
 const motorwayFree=gate?(gate.metre-config.fromM)/1000/freeSpeedKmh(path)*60+
  (normal?.config.geometry.freeMinutes??0):cross?(sourceEnd-config.fromM)/1000/freeSpeedKmh(path)*60+
  (config.toM-(config.targetEntryM??0))/1000/freeSpeedKmh(target)*60:
  (config.toM-config.fromM)/1000/freeSpeedKmh(path)*60;
 const extra=Math.max(0,config.geometry.freeMinutes-motorwayFree)+
  (state.waitingRoad+state.waitingMerge)/service*60+exitTerminalWait(source,config.fromM);
 const spans=cellQueueSpans(source);
 const eligible=(tail:number,end:number,loss=0)=>{
  const nearest=nearestExitBeforeQueue(path,route,accessibleExits(route,events,exits,'exit'),tail,approachEnd);
  if(config.fromM>=(nearest?.metre??tail)-25&&config.fromM<=end+25)return true;
  if(cross||!nearest||nearest.metre-config.fromM>35000)return false;
  const earlier=diversionJunctions(path as RoadId,accessibleExits(route,events,exits,'exit'),route)
   .filter(j=>!j.isInterchange&&j.metre>config.fromM+25&&j.metre<=nearest.metre+25).length;
  // The first choice stays local. Only extreme remaining waits justify
  // leaving one or two junctions earlier on an otherwise free approach.
  return earlier>=1&&earlier<=2&&loss>=150+(earlier-1)*90;
 };
 const measuredLoss=(grid:CellRouteState,start:number,end:number,rate=service)=>{
  const loss=speedDelayInCells(grid,start,end,end+grid.cellM);
  return loss.blocked?Math.max(loss.delayMin,excessQueue(grid,start,end,demands[grid.pathKey]??0)/rate*60):loss.delayMin;
 };
 let delayMin=0,desired=0;
 const consider=(loss:number)=>{
  const percent=voluntaryDiversionPercent(loss,extra);
  if(percent>desired||percent===desired&&loss>delayMin){desired=percent;delayMin=loss;}
 };
 for(const span of spans){
  const end=Math.min(span.toM,gate?gate.metre+source.cellM:sourceEnd);
  const start=Math.max(span.fromM,config.fromM);
  if(start>=end||!cross&&!gate&&config.toM<span.toM-1)continue;
  let loss=measuredLoss(source,start,end,gate?gateService:service);
  if(gate&&span.toM>=gate.metre-source.cellM){
   loss+=(normal?normal.state.waitingRoad+normal.state.waitingMerge:0)/gateService*60;
  }
  if(eligible(span.fromM,end,loss))consider(loss);
 }
 if(cross){
  // Each approaching motorway has its own nearest exit. A queue on A3
  // cannot activate every A48 exit simply because all would avoid it.
  const approach=spans.find(s=>s.fromM<sourceEnd&&s.toM>=sourceEnd-source.cellM);
  const tail=approach?.fromM??sourceEnd;
  if(eligible(tail,sourceEnd))for(const span of cellQueueSpans(destination)){
   const start=Math.max(span.fromM,config.targetEntryM??0),end=Math.min(span.toM,config.toM);
   if(start>=end||config.toM<span.toM-1)continue;
   const sourceLoss=approach?measuredLoss(source,Math.max(config.fromM,approach.fromM),sourceEnd):0;
   consider(sourceLoss+measuredLoss(destination,start,end));
  }
 }
 // A newly selected exit adopts a high target gradually. Remember this
 // only when advancing a model minute; redraw/pause cannot raise it.
 const percent=Math.min(desired,(state.choicePercent??0)+5);
 return {percent,mandatory:false,delayMin,upstreamRank};
}

/** A single diversion decision is distributed over later return junctions.
 * Compare complete trips to a common downstream point. Keep the actual
 * shared side-road resources and each junction's storage in the flow solver.
 */
export function routedDiversionChoice(entry:ChoiceRoute,entries:readonly ChoiceRoute[],
 cells:Readonly<Partial<Record<PathKey,CellRouteState>>>,routes:Readonly<Partial<Record<PathKey,Corridor>>>,
 events:readonly SimEvent[],exits:readonly Exit[],demands:Readonly<Partial<Record<PathKey,number>>>,
 turnDelays:Readonly<Partial<Record<PathKey,number>>>={}):DiversionChoice{
 const group=entry.config.alternativeGroup;
 if(!group)return baseDiversionChoice(entry,entries,cells,routes,events,exits,demands,turnDelays);
 const family=entries.filter(e=>{
  if(e.config.alternativeGroup!==group||e.enabled===false)return false;
  const target=e.config.targetPath??e.config.path,route=routes[target];
  return !!route&&!events.some(event=>{const gate=closureGate(route,event,exits,events);
   return gate&&e.config.toM>=gate.metre-25&&e.config.toM<gate.endM-1;});
 });
 if(!family.length||entry.enabled===false)return {percent:0,mandatory:false,delayMin:0,upstreamRank:0};
 const choices=family.map(e=>baseDiversionChoice({...e,state:{...e.state,choicePercent:100}},entries,cells,routes,events,exits,demands,turnDelays));
 const wanted=Math.max(0,...choices.map(c=>c.percent));
 const mandatory=choices.some(c=>c.mandatory);
 const total=mandatory?wanted:Math.min(wanted,family.reduce((n,e)=>n+(e.state.choicePercent??0),0)+5);
 const horizon=Math.max(...family.map(e=>e.config.toM));
 const costs=family.map(e=>{
  const config=e.config,target=config.targetPath??config.path,grid=cells[target];
  const service=Math.max(1,config.geometry.roadCapacityVph);
  const onward=grid&&config.toM<horizon?speedDelayInCells(grid,config.toM,horizon,horizon):null;
  const freeOnward=(horizon-config.toM)/1000/freeSpeedKmh(target)*60;
  const terminal=cells[config.path]?exitTerminalWait(cells[config.path]!,config.fromM):0;
  return config.geometry.freeMinutes+freeOnward+(onward?.delayMin??0)+terminal+
   (e.state.waitingRoad+e.state.waitingMerge)/service*60;
 });
 const best=Math.min(...costs);
 const weights=costs.map(cost=>Math.exp(-Math.min(60,Math.max(0,cost-best))/15));
 const sum=weights.reduce((n,v)=>n+v,0),index=family.findIndex(e=>e.config.id===entry.config.id);
 const own=choices[Math.max(0,index)]!;
 return {percent:index<0?0:total*weights[index]!/sum,mandatory,delayMin:Math.max(...choices.map(c=>c.delayMin)),upstreamRank:own.upstreamRank};
}
