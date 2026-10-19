/** Deliberately isolated, macroscopic first-pass traffic-flow simulation.
 * Traffic volumes, capacities, and queue density are modelling assumptions,
 * NOT measured flows, road regulations, official diversion routes, or observed jams.
 * One controlling bottleneck per directional path; no A3/A48 ramp transfer yet.
 */
import {flowPolicy,type SimEvent} from './events.js';
import type {RoadId} from './core.js';

export const PATHS=[
 'A3-koeln','A3-frankfurt','A48-dernbach','A48-koblenz',
 'ramp-a3-to-a48-from-frankfurt','ramp-a48-to-koeln',
 'ramp-a3-to-a48-from-koeln','ramp-a48-to-frankfurt'
] as const;
export type PathKey=typeof PATHS[number];
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
const demandDefaults:Record<PathKey,number>={
 'A3-koeln':4200,'A3-frankfurt':4100,
 'A48-dernbach':2400,'A48-koblenz':2200,
 'ramp-a3-to-a48-from-frankfurt':700,'ramp-a48-to-koeln':700,
 'ramp-a3-to-a48-from-koeln':700,'ramp-a48-to-frankfurt':700
};
const motorwayBaseLanes:Record<RoadId,number>={
 'A3-koeln':3,'A3-frankfurt':3,'A48-dernbach':2,'A48-koblenz':2
};
const defaultKmH=(key:PathKey)=>key.startsWith('ramp-')?80:key.startsWith('A48')?100:120;
export function defaultDemand(key:PathKey):number{return demandDefaults[key]}
export function baselineCapacity(key:PathKey):number{
 return key.startsWith('ramp-')?1500:1800*motorwayBaseLanes[key as RoadId];
}
export function emptyTraffic():TrafficState{
 return {minute:0,vehiclesWaiting:Object.fromEntries(PATHS.map(p=>[p,0])) as Record<PathKey,number>};
}
export function eventCapacity(e:SimEvent):number{
 const policy=flowPolicy(e);
 if(!policy.canEnter)return 0;
 const ramp=e.pathKey.startsWith('ramp-');
 const perLane=ramp?1500:1800;
 // Standstreifen are explicitly less capable than ordinary traffic lanes.
 const laneCapacity=perLane*(policy.openMainLanes+(e.settings.shoulder==='open'?.65:0));
 const normalSpeed=defaultKmH(e.pathKey as PathKey);
 const speedRatio=Math.min(1,policy.speedKmh/normalSpeed);
 // Scenario assumptions, not calibrated field measurements: below motorway free-flow
 // a posted limit does not reduce peak *throughput* in proportion to speed.
 // Previous 0.42+0.58*ratio combined with hard merging penalties could leave
 // a single lane at 40 km/h with only ~916 veh/h, exaggerating delays.
 // Keep a stronger penalty for very slow (<40 km/h) incident pass-bys.
 const speedAt40=.86+.14*Math.min(1,40/normalSpeed);
 const speedFactor=policy.speedKmh<40
  ?speedAt40*(.45+.55*policy.speedKmh/40)
  :.86+.14*speedRatio;
 const mergeFactor=e.closedLanes.length===0?1:e.kind==='roadworks'?.92:.87;
 return Math.max(0,Math.round(laneCapacity*speedFactor*mergeFactor));
}
export function pathBottleneck(key:PathKey,events:readonly SimEvent[]):{
 capacityVph:number;event:SimEvent|null;count:number;speedKmh:number
}{
 const relevant=events.filter(e=>e.pathKey===key);
 let capacity=baselineCapacity(key),critical:SimEvent|null=null;
 for(const e of relevant){const c=eventCapacity(e);
  if(c<capacity||(c===capacity&&critical===null)){capacity=c;critical=e;}
 }
 return {capacityVph:capacity,event:critical,count:relevant.length,speedKmh:critical?.settings.speedKmh??defaultKmH(key)};
}
export function trafficEstimate(state:TrafficState,key:PathKey,events:readonly SimEvent[],inputVph:number):TrafficEstimate{
 if(!Number.isFinite(inputVph)||inputVph<0||inputVph>8000)throw Error('Zufluss muss zwischen 0 und 8000 Fahrzeugen/h liegen');
 const bn=pathBottleneck(key,events),queue=Math.max(0,state.vehiclesWaiting[key]);
 const capacity=bn.capacityVph;
 // Long queues spread across available approach lanes, using a declared illustrative density.
 const approachLanes=key.startsWith('ramp-')?1:motorwayBaseLanes[key as RoadId];
 const queueKm=queue/(95*approachLanes);
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
 for(let minute=0;minute<minutes;minute++)for(const key of PATHS){
  const volume=demands[key];
  if(!Number.isFinite(volume)||volume<0||volume>8000)throw Error('Zufluss außerhalb des zulässigen Bereichs');
  const capacity=pathBottleneck(key,events).capacityVph;
  const available=waiting[key]+volume/60;
  const discharged=Math.min(available,capacity/60);
  waiting[key]=Math.max(0,available-discharged);
 }
 return {minute:state.minute+minutes,vehiclesWaiting:waiting};
}
export function defaultDemands():Record<PathKey,number>{return {...demandDefaults}}
