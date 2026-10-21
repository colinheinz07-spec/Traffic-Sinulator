/** Experimental first-order cell-transmission traffic on real OSM carriageways.
 * This is a SEPARATE mass-conserving traffic ledger. Only its local SPEED
 * is used for motorway shading until the legacy node/ramps/detours solver
 * can be switched to the same ledger without double counting.
 *
 * Model: triangular fundamental diagram, homogeneous 450-500m cells,
 * 10-second time steps (CFL safe at up to 120km/h), deterministic fluxes.
 * Every cell stores VEHICLES rather than a cosmetic pulse phase.
 */
import type {Corridor} from './spatial.js';
import {positionM} from './spatial.js';
import type {SimEvent} from './events.js';
import {baselineCapacity,eventCapacity,type PathKey,type TrafficColor} from './traffic.js';
import {colorAtSpeed,freeSpeedKmh} from './traffic-physics.js';

export interface TrafficCell {
 fromM:number;toM:number;vehicles:number;flowVph:number;speedKmh:number;densityVehKm:number;
}
export interface CellRouteState {
 pathKey:PathKey;minute:number;cellM:number;cells:TrafficCell[];
 backlog:number;initialVehicles:number;offeredTotal:number;exitedTotal:number;
}
export interface CellSpeedBand {fromM:number;toM:number;speedKmh:number;color:TrafficColor;source:'cell'}
const SUBSTEPS=6,DT_MIN=1/SUBSTEPS,WAVE_KMH=22,JAM_PER_LANE=95;
export function cellLanes(path:PathKey):number{
 return path.startsWith('ramp-')?1:path.startsWith('A48')?2:3;
}
export function initialiseCells(route:Corridor,initialDemandVph:number):CellRouteState{
 if(!Number.isFinite(initialDemandVph)||initialDemandVph<0||initialDemandVph>8000)
  throw Error('Ungültiger Zufluss für Zellmodell');
 const count=Math.ceil(route.lengthM/500);
 const cellM=route.lengthM/count,dx=cellM/1000;
 const v=freeSpeedKmh(route.key),lanes=cellLanes(route.key);
 const jam=JAM_PER_LANE*lanes;
 const cap=Math.min(baselineCapacity(route.key),v*WAVE_KMH*jam/(v+WAVE_KMH));
 const equilibriumDensity=Math.min(.96*jam,Math.min(initialDemandVph,cap)/v);
 const cells=Array.from({length:count},(_,i):TrafficCell=>{
  const fromM=i*cellM,toM=(i+1)*cellM;
  return {fromM,toM,vehicles:equilibriumDensity*dx,
   flowVph:Math.min(initialDemandVph,cap),speedKmh:v,densityVehKm:equilibriumDensity};
 });
 return {pathKey:route.key,minute:0,cellM,cells,backlog:0,initialVehicles:cells.reduce((s,c)=>s+c.vehicles,0),
  offeredTotal:0,exitedTotal:0};
}
export function cellInventory(state:CellRouteState):number{
 return state.backlog+state.cells.reduce((s,c)=>s+c.vehicles,0);
}
export function assertCellConservation(state:CellRouteState):void{
 const lhs=cellInventory(state)+state.exitedTotal;
 const rhs=state.initialVehicles+state.offeredTotal;
 const tolerance=1e-5*Math.max(1,rhs);
 if(!Number.isFinite(lhs)||!Number.isFinite(rhs)||Math.abs(lhs-rhs)>tolerance)
  throw Error('Zellmodell hat Fahrzeuge verloren oder dupliziert');
}
function localControls(route:Corridor,events:readonly SimEvent[],demandVph:number,count:number,cellM:number){
 const free=freeSpeedKmh(route.key),laneCount=cellLanes(route.key);
 const speeds=Array(count).fill(free) as number[];
 const faceCapacity=Array(count+1).fill(Infinity) as number[];
 for(const event of events){
  if(event.pathKey!==route.key)continue;
  const at=positionM(route,event.point);
  if(at===null)continue;
  const from=Math.max(0,at),to=Math.min(route.lengthM,from+event.settings.lengthM);
  for(let c=Math.floor(from/cellM);c<Math.min(count,Math.ceil(to/cellM));c++){
   speeds[c]=Math.min(speeds[c]!,event.settings.speedKmh===0?free:event.settings.speedKmh);
  }
  const face=Math.max(1,Math.min(count,Math.round((from+Math.min(150,event.settings.lengthM))/cellM)));
  faceCapacity[face]=Math.min(faceCapacity[face]!,eventCapacity(event,demandVph));
 }
 const jam=JAM_PER_LANE*laneCount;
 const capacity=speeds.map(v=>Math.min(baselineCapacity(route.key),v*WAVE_KMH*jam/(v+WAVE_KMH)));
 return {speeds,capacity,faceCapacity,jam};
}
/** Advance exactly one model minute, including six stable 10-second updates.
 * Domain demand not admitted at the map entry is retained in backlog.
 * Outflow is discharged at the far end. No arbitrary time-loss surcharges.
 */
export function advanceCells(previous:CellRouteState,route:Corridor,events:readonly SimEvent[],
 demandVph:number):CellRouteState{
 if(previous.pathKey!==route.key||!Number.isFinite(demandVph)||demandVph<0||demandVph>8000)
  throw Error('Zellmodell: Richtung oder Zufluss ungültig');
 const n=previous.cells.length,dx=previous.cellM/1000;
 const controls=localControls(route,events,demandVph,n,previous.cellM);
 const {speeds,capacity,faceCapacity,jam}=controls;
 const occupancy=previous.cells.map(c=>c.vehicles);
 let backlog=previous.backlog,offeredTotal=previous.offeredTotal,exitedTotal=previous.exitedTotal;
 const cumulativeOut=Array(n).fill(0) as number[];
 for(let sub=0;sub<SUBSTEPS;sub++){
  const density=occupancy.map(x=>x/dx);
  const send=density.map((k,i)=>Math.min(speeds[i]!*k,capacity[i]!)*DT_MIN/60);
  const receive=density.map((k,i)=>Math.min(WAVE_KMH*Math.max(0,jam-k),capacity[i]!)*DT_MIN/60);
  const face=Array(n+1).fill(0) as number[];
  const arrived=demandVph/60*DT_MIN;
  offeredTotal+=arrived;
  const available=arrived+backlog;
  face[0]=Math.min(available,receive[0]!);
  backlog=Math.max(0,available-face[0]!);
  for(let i=1;i<n;i++){
   face[i]=Math.min(send[i-1]!,receive[i]!,faceCapacity[i]!*DT_MIN/60);
  }
  face[n]=Math.min(send[n-1]!,faceCapacity[n]!*DT_MIN/60);
  exitedTotal+=face[n]!;
  for(let i=0;i<n;i++){
   occupancy[i]=Math.max(0,occupancy[i]!+face[i]!-face[i+1]!);
   cumulativeOut[i]+=face[i+1]!;
   if(occupancy[i]>jam*dx+1e-5)throw Error('Zellmodell: Speicherdichte überschritten');
  }
 }
 const cells=previous.cells.map((c,i)=>{
  const densityVehKm=occupancy[i]!/dx;
  const outflowVph=cumulativeOut[i]!*60;
  // Density/flow give local velocity. The physically clear free-flow state
  // remains green when the cell has no vehicles or is initially settling.
  const speedKmh=densityVehKm<.05?freeSpeedKmh(route.key):
   Math.min(speeds[i]!,outflowVph/Math.max(.05,densityVehKm));
  return {...c,vehicles:occupancy[i]!,flowVph:outflowVph,
   speedKmh:Math.max(0,speedKmh),densityVehKm};
 });
 const next={...previous,cells,minute:previous.minute+1,backlog,offeredTotal,exitedTotal};
 assertCellConservation(next);return next;
}
/** Display colors only where actual congested density exists; not an
 * arbitrary static strip. A separate speed-limit overlay covers worksites.
 */
export function cellSpeedBands(state:CellRouteState):CellSpeedBand[]{
 const free=freeSpeedKmh(state.pathKey),jam=JAM_PER_LANE*cellLanes(state.pathKey);
 const critical=jam*WAVE_KMH/(free+WAVE_KMH);
 const bands:CellSpeedBand[]=[];
 for(const c of state.cells){
  if(c.densityVehKm<critical*1.10||c.speedKmh>65)continue;
  const color=colorAtSpeed(c.speedKmh);
  if(color==='free')continue;
  const last=bands.at(-1);
  if(last?.color===color&&Math.abs(last.toM-c.fromM)<.1){
   last.toM=c.toM;last.speedKmh=Math.min(last.speedKmh,c.speedKmh);
  }else bands.push({fromM:c.fromM,toM:c.toM,speedKmh:c.speedKmh,color,source:'cell'});
 }
 return bands;
}
