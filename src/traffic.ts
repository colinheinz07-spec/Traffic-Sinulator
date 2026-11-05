import {profileFactor,profileIdentity} from './traffic-profiles.js';
import {LEGACY_ROUTE_KEYS,NETWORK_ROUTE_KEYS,ROUTE_CATALOG,routeDescriptor} from './network-catalog.js';
/** Deliberately isolated, macroscopic first-pass traffic-flow simulation.
 * Traffic volumes, capacities, and queue density are modelling assumptions,
 * NOT measured flows, road regulations, official diversion routes, or observed jams.
 * One controlling bottleneck per directional path; no A3/A48 ramp transfer yet.
 */
import {flowPolicy,type SimEvent} from './events.js';
import {baseLaneCapacity,QUEUE_JAM_DENSITY_PER_LANE} from './traffic-physics.js';

export const PATHS:readonly string[]=LEGACY_ROUTE_KEYS;
export const NETWORK_PATHS:readonly string[]=NETWORK_ROUTE_KEYS;
export type PathKey=string;
export type TrafficColor='free'|'slow'|'jam'|'standstill';
export type TrafficState={minute:number;vehiclesWaiting:Record<PathKey,number>};
export interface TrafficEstimate {
 pathKey:PathKey;
 demandVph:number;
 capacityVph:number;
 dischargedVph:number;
 queueVehicles:number;
 queueKm:number;
 delayMin:number|null;
 speedKmh:number;
 color:TrafficColor;
 bottleneckId:string|null;
 eventCount:number;
 officiallyClosed:boolean;
}
const demandDefaults:Record<PathKey,number>=Object.fromEntries(
 ROUTE_CATALOG.map(r=>[r.key,r.demandVph]));
const defaultKmH=(key:PathKey)=>routeDescriptor(key)?.freeKmh??130;
export function defaultDemand(key:PathKey):number{return demandDefaults[key]??0}
export function baselineCapacity(key:PathKey):number{
 const route=routeDescriptor(key);
 if(!route)throw Error('Fahrweg unbekannt: '+key);
 return baseLaneCapacity(key)*route.lanes;
}
export function emptyTraffic():TrafficState{
 return {minute:0,vehiclesWaiting:Object.fromEntries(NETWORK_PATHS.map(p=>[p,0])) as Record<PathKey,number>};
}
/** A3/A48 scenario assumptions (NOT actual freight counts). The vehicle
 * composition can be supplied by subsequent route/time-based demand models.
 */
export function defaultHeavyShare(key:PathKey):number{
 return routeDescriptor(key)?.heavyShare??.15;
}
/** Shares ordered RIGHT -> LEFT, from car- and HGV-specific lane choices.
 * Heavy trucks are predominantly right; cars are more evenly distributed.
 * Expose heavyFraction so an automated or measured fleet mix can replace the
 * synthetic reference. This is not a measured lane occupation distribution.
 */
export function laneDemandShares(n:number,heavyFraction=.23):number[]{
 if(!Number.isInteger(n)||n<1||n>7||!Number.isFinite(heavyFraction)||heavyFraction<0||heavyFraction>1)
  throw Error('Ungültige Fahrstreifenanzahl oder Schwerlastanteil');
 if(n===1)return [1];
 const cars=n===2?[.53,.47]:n===3?[.38,.36,.26]:
  Array.from({length:n},(_,i)=>1.10-.40*i/(n-1));
 const trucks=n===2?[.96,.04]:n===3?[.90,.10,0]:
  Array.from({length:n},(_,i)=>i===0?.89:i===1?.09:.02/(n-2));
 const carTotal=cars.reduce((a,b)=>a+b,0),truckTotal=trucks.reduce((a,b)=>a+b,0);
 return cars.map((v,i)=> (1-heavyFraction)*v/carTotal + heavyFraction*trucks[i]!/truckTotal);
}
export function closedDemandShare(e:SimEvent,heavyFraction=defaultHeavyShare(e.pathKey as PathKey)):number{
 const shares=laneDemandShares(e.laneCount,heavyFraction);
 return e.closedLanes.reduce((sum,lane)=>sum+(shares[lane]??0),0);
}
/** Relative closure sensitivity: with more HGVs, closing the truck-heavy
 * right lane causes additional merging disturbance at saturated demand.
 * This *reduces effective capacity*, never adds fictional queued vehicles.
 */
export function eventCapacity(e:SimEvent,
 volumeVph=defaultDemand(e.pathKey as PathKey),
 heavyFraction=defaultHeavyShare(e.pathKey as PathKey)):number{
 const policy=flowPolicy(e);
 if(!policy.canEnter)return 0;
 if(!Number.isFinite(volumeVph)||volumeVph<0||volumeVph>16000)throw Error('Ungültiger Zufluss');
 if(!Number.isFinite(heavyFraction)||heavyFraction<0||heavyFraction>1)throw Error('Ungültiger Schwerlastanteil');
 const perLane=baseLaneCapacity(e.pathKey as PathKey);
 const laneCapacity=perLane*(policy.openMainLanes+(e.settings.shoulder==='open'?.65:0));
 // 0,5 km/h ist Kriechverkehr, keine typische Fahrstreifenkapazität.
 if(policy.speedKmh===0.5)return Math.max(1,Math.floor(.5*QUEUE_JAM_DENSITY_PER_LANE*policy.openTotalLanes));
 const normalSpeed=defaultKmH(e.pathKey as PathKey);
 const parallel=policy.openMainLanes>=2&&e.closedLanes.length>0;
 // The 2000 veh/h/lane motorway reference is a saturated service headway, not
 // 130 km/h times a fixed density. Two usable lanes can still serve that
 // headway at 60 km/h. Do not penalize them against free motorway speed
 // and then apply the same merge disturbance a second and third time.
 const speedRatio=Math.min(1,policy.speedKmh/(parallel?60:normalSpeed));
 const speedAt40=parallel?.80+.20*(40/60):.86+.14*Math.min(1,40/normalSpeed);
 const speedFactor=policy.speedKmh<40
  ?speedAt40*(.45+.55*policy.speedKmh/40)
  :parallel?Math.min(1,.80+.20*speedRatio):.86+.14*speedRatio;
 // Two usable lanes can sustain orderly parallel discharge. The per-lane
 // reference already represents a sustained flow; avoid stacking the full
 // single-lane speed/merging penalty onto both available lanes again.
 const baseMerge=e.closedLanes.length===0?1:parallel?(e.kind==='roadworks'?.999:.997):e.kind==='roadworks'?.92:.87;
 const shares=laneDemandShares(e.laneCount,heavyFraction);
 const hgvDistribution=laneDemandShares(e.laneCount,1);
 const affectedShare=e.closedLanes.reduce((sum,i)=>sum+shares[i]!,0);
 const divertedHeavyShare=e.closedLanes.reduce((sum,i)=>sum+hgvDistribution[i]!*heavyFraction,0);
 // When only one lane remains, vehicles have no further alternative merge
 // lane. Avoid multiplying the loss as if every truck changes lanes twice.
 const remaining=Math.max(0,policy.openMainLanes);
 const constrained=remaining<=1?.45:1;
 const loading=Math.min(1,volumeVph/Math.max(1,laneCapacity));
 const extraMergeLoss=e.closedLanes.length===0?0:
  constrained*loading*(parallel?(.008*affectedShare+.012*divertedHeavyShare):(.10*affectedShare+.14*divertedHeavyShare));
 const mergeFactor=baseMerge*Math.max(.72,1-extraMergeLoss);
 return Math.max(0,Math.round(laneCapacity*speedFactor*mergeFactor));
}
export function pathBottleneck(key:PathKey,events:readonly SimEvent[],volumeVph=defaultDemand(key)):{
 capacityVph:number;event:SimEvent|null;count:number;speedKmh:number
}{
 const relevant=events.filter(e=>e.pathKey===key);
 let capacity=baselineCapacity(key),critical:SimEvent|null=null;
 for(const e of relevant){const c=eventCapacity(e,volumeVph);
  if(c<capacity||(c===capacity&&critical===null)){capacity=c;critical=e;}
 }
 return {capacityVph:capacity,event:critical,count:relevant.length,speedKmh:critical?.settings.speedKmh??defaultKmH(key)};
}
export function trafficEstimate(state:TrafficState,key:PathKey,events:readonly SimEvent[],inputVph:number):TrafficEstimate{
 if(!Number.isFinite(inputVph)||inputVph<0||inputVph>8000)throw Error('Zufluss muss zwischen 0 und 8000 Fahrzeugen/h liegen');
 const bn=pathBottleneck(key,events,inputVph),queue=Math.max(0,state.vehiclesWaiting[key]);
 const capacity=bn.capacityVph;
 // Long queues spread across available approach lanes, using a declared illustrative density.
 const approachLanes=routeDescriptor(key)?.lanes??1;
 const queueKm=queue/(QUEUE_JAM_DENSITY_PER_LANE*approachLanes);
 // Queue delay is unknowable when a closure has zero discharge; never display a finite prediction.
 const physicalWait=capacity===0?null:queue/capacity*60;
 const eventDelay=bn.event&&capacity>0?
  Math.max(0,bn.event.settings.lengthM/1000*(1/bn.event.settings.speedKmh-1/defaultKmH(key))*60):0;
 const delayMin=physicalWait===null?null:Math.max(0,physicalWait+eventDelay);
 let color:TrafficColor='free';
 if(capacity===0)color='standstill';
 else if(queueKm>=1.5||(delayMin!==null&&delayMin>=10))color='jam';
 else if(queue>5||inputVph>capacity*.91||(delayMin!==null&&delayMin>.8))color='slow';
 const dischargedVph=Math.min(capacity,inputVph+queue*60);
 return {pathKey:key,demandVph:inputVph,capacityVph:capacity,dischargedVph,
  queueVehicles:queue,queueKm,delayMin,speedKmh:bn.speedKmh,color,
  bottleneckId:bn.event?.id??null,eventCount:bn.count,
  officiallyClosed:bn.event?.kind==='closure'||false};
}
export function advanceTraffic(state:TrafficState,events:readonly SimEvent[],demands:Readonly<Record<PathKey,number>>,minutes:number):TrafficState{
 if(!Number.isInteger(minutes)||minutes<1||minutes>60)throw Error('Zeitschritt muss 1 bis 60 Minuten betragen');
 const waiting={...state.vehiclesWaiting};
 // Minute-by-minute conservation: queued vehicles + arrivals - discharged vehicles.
 // Deliberately NO fake ramp interchanges, departures or fictional detours.
 for(let minute=0;minute<minutes;minute++)for(const key of NETWORK_PATHS){
  const volume=demands[key];
  if(!Number.isFinite(volume)||volume<0||volume>8000)throw Error('Zufluss außerhalb des zulässigen Bereichs');
  const capacity=pathBottleneck(key,events,volume).capacityVph;
  const available=waiting[key]+volume/60;
  const discharged=Math.min(available,capacity/60);
  waiting[key]=Math.max(0,available-discharged);
 }
 return {minute:state.minute+minutes,vehiclesWaiting:waiting};
}
export function defaultDemands():Record<PathKey,number>{return {...demandDefaults}}

/** Local calendar profiles vary by motorway and direction. References are
 * peak-hour model inputs, not DTV or current measured hourly counts. */
export function demandAtClock(base:Readonly<Record<PathKey,number>>,moment:Date):Record<PathKey,number>{
 if(!Number.isFinite(moment.getTime()))throw Error('Ungültiges Simulationsdatum');
 const factors=new Map<string,number>();
 return Object.fromEntries(NETWORK_PATHS.map(key=>{
  // Most ramps share one family. Cache the result per profile/direction
  // inside this minute rather than recomputing a curve for every fragment.
  const id=profileIdentity(key);let factor=factors.get(id);if(factor===undefined){factor=profileFactor(key,moment);factors.set(id,factor);}
  return [key,Math.max(0,Math.min(8000,Math.round(base[key]*factor)))];
 })) as Record<PathKey,number>;
}

export type DemandMode='wave'|'constant'|'clock';
/** Synthetic ending of a traffic peak. No measured traffic; no arbitrary delay cap. */
export function demandScale(minute:number,mode:DemandMode):number{
 if(!Number.isFinite(minute)||minute<0)throw Error('Ungültige Modellzeit');
 if(mode==='constant')return 1;
 const t=Math.max(0,Math.min(1,(minute-10)/90));
 return 1-.77*t*t*(3-2*t);
}
export function demandAtMinute(base:Readonly<Record<PathKey,number>>,minute:number,mode:DemandMode):Record<PathKey,number>{
 const factor=demandScale(minute,mode);
 return Object.fromEntries(NETWORK_PATHS.map(key=>[key,Math.round(base[key]*factor)])) as Record<PathKey,number>;
}
