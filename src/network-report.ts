/** All UI and map traffic values read the same physical queue ledger. */
import type {Jam} from './spatial.js';
import type {Spillback} from './interchange.js';
import {pathBottleneck,type PathKey,type TrafficColor} from './traffic.js';
import type {SimEvent} from './events.js';

export interface RouteReport {
  key:PathKey;
  /** Actual queues owned by this roadway's bottlenecks. */
  ownVehicles:number;
  /** Vehicles owned by ramps but physically occupying this feeder motorway. */
  sharedRampVehicles:number;
  /** Physical vehicles on the chosen road; do not sum this across all paths. */
  queueVehicles:number;
  queueKm:number;
  delayMin:number|null;
  capacityVph:number;
  color:TrafficColor;
  countedQueueIds:string[];
}
const rank:Record<TrafficColor,number>={free:0,slow:1,jam:2,standstill:3};
export function routeReport(key:PathKey,jams:readonly Jam[],spillbacks:readonly Spillback[],events:readonly SimEvent[]):RouteReport{
  const own=jams.filter(j=>j.pathKey===key);
  const shared=spillbacks.filter(s=>s.source===key);
  const ownVehicles=own.reduce((sum,j)=>sum+j.queueVehicles,0);
  const sharedRampVehicles=shared.reduce((sum,s)=>sum+s.queuedVehiclesOnMotorway,0);
  // This count is a physical LOCATION count, not extra vehicles created in the simulator.
  const queueVehicles=ownVehicles+sharedRampVehicles;
  const maxLength=Math.max(0,...own.map(j=>j.visibleQueueM),...shared.map(s=>s.lengthM));
  const bottleneck=pathBottleneck(key,events);
  const cap=Math.min(bottleneck.capacityVph,...own.filter(j=>!j.released).map(j=>j.capacityVph));
  const delays=[...own.map(j=>j.delayMin),...shared.map(s=>s.delayMin)];
  const delayMin=delays.some(d=>d===null)?null:Math.max(0,...delays.filter((d):d is number=>d!==null));
  const color=[...own.map(j=>j.color),...shared.map(s=>s.color)]
   .reduce<TrafficColor>((c,next)=>rank[next]>rank[c]?next:c,'free');
  return {key,ownVehicles,sharedRampVehicles,queueVehicles,queueKm:maxLength/1000,
   delayMin,capacityVph:cap,color,countedQueueIds:own.map(j=>j.id)};
}
