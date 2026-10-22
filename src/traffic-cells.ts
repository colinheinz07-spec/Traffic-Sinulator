/** Experimental first-order cell-transmission traffic on real OSM carriageways.
 * Mainline cells and simulator detours share mass-conserving transfers. Their
 * local speeds determine map shading, queue lengths and travel-time loss.
 * The legacy AD ramp turn-demand solver remains a separate approximation.
 *
 * Model: triangular fundamental diagram, homogeneous 450-500m cells,
 * 10-second time steps (CFL safe at up to 120km/h), deterministic fluxes.
 * Every cell stores VEHICLES rather than a cosmetic pulse phase.
 */
import type {Corridor} from './spatial.js';
import type {Exit} from './core.js';
import {positionM,closureGate} from './spatial.js';
import type {SimEvent} from './events.js';
import {baselineCapacity,eventCapacity,type PathKey,type TrafficColor} from './traffic.js';
import {flowPolicy} from './events.js';
import {colorAtSpeed,freeSpeedKmh} from './traffic-physics.js';

export interface TrafficCell {
 fromM:number;toM:number;vehicles:number;flowVph:number;speedKmh:number;densityVehKm:number;
}
export interface CellRouteState {
 pathKey:PathKey;minute:number;cellM:number;cells:TrafficCell[];
 backlog:number;initialVehicles:number;offeredTotal:number;exitedTotal:number;
 divertedTotal?:number;rejoinedTotal?:number;lastTransfers?:CellTransfer[];
 dischargeVph?:number;capacityVph?:number;
}
export interface CellDetourPort {
 id:string;fromM:number|null;toM:number|null;interestPercent:number;
 exitCapacityVph:number;returnVehicles:number;
}
export interface CellTransfer {id:string;leaveVpm:number;joinVpm:number}
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
 const lhs=cellInventory(state)+state.exitedTotal+(state.divertedTotal??0);
 const rhs=state.initialVehicles+state.offeredTotal+(state.rejoinedTotal??0);
 const tolerance=1e-5*Math.max(1,rhs);
 if(!Number.isFinite(lhs)||!Number.isFinite(rhs)||Math.abs(lhs-rhs)>tolerance)
  throw Error('Zellmodell hat Fahrzeuge verloren oder dupliziert');
}
function localControls(route:Corridor,events:readonly SimEvent[],demandVph:number,count:number,cellM:number,exits:readonly Exit[]=[]){
 const free=freeSpeedKmh(route.key),laneCount=cellLanes(route.key);
 const speeds=Array(count).fill(free) as number[];
 const faceCapacity=Array(count+1).fill(Infinity) as number[];
 const releases:{face:number;event:SimEvent;maximum:number}[]=[];
 for(const event of events){
  if(event.pathKey!==route.key)continue;
  const at=positionM(route,event.point);
  if(at===null)continue;
  const from=Math.max(0,at),to=Math.min(route.lengthM,from+event.settings.lengthM);
  // An administrative closure forbids entry at the last exit, NOT travel
  // for cars already in the road segment after that exit. Do not reduce
  // free speeds downstream of that gate.
  if(event.kind==='closure'&&exits.length){
   const gate=closureGate(route,event,exits);
   if(!gate)continue;
   const face=Math.max(1,Math.min(count,Math.round(gate.metre/cellM)));
   faceCapacity[face]=0;
   continue;
  }
  for(let c=Math.floor(from/cellM);c<Math.min(count,Math.ceil(to/cellM));c++){
   speeds[c]=Math.min(speeds[c]!,event.settings.speedKmh===0?free:event.settings.speedKmh);
  }
  const face=Math.max(1,Math.min(count,Math.round((from+Math.min(150,event.settings.lengthM))/cellM)));
  faceCapacity[face]=Math.min(faceCapacity[face]!,eventCapacity(event,demandVph));
  const policy=flowPolicy(event);
  if(event.closedLanes.length&&policy.openMainLanes>0)
   releases.push({face,event,maximum:1800*(policy.openMainLanes+(event.settings.shoulder==='open'?.65:0))});
 }
 const jam=JAM_PER_LANE*laneCount;
 const capacity=speeds.map(v=>Math.min(baselineCapacity(route.key),v*WAVE_KMH*jam/(v+WAVE_KMH)));
 return {speeds,capacity,faceCapacity,jam,releases};
}
/** Driver/platoon discharge at an occupied lane bottleneck. This modulates
 * actual transferred vehicles, never just map colors. Mean service stays
 * near the sustained capacity; short braking phases and larger releases
 * create density waves that propagate through the conserved cell fluxes.
 */
interface DischargeEpisode {start:number;stop:number;rise:number;flow:number;fall:number;low:number;high:number}
const dischargeHistories=new Map<string,{seed:number;end:number;episodes:DischargeEpisode[]}>();
function dischargeSeed(id:string):number{
 let seed=2166136261;for(const c of id)seed=Math.imul(seed^c.charCodeAt(0),16777619);
 return seed>>>0;
}
function dischargeRandom(seed:number,index:number,channel:number):number{
 let x=seed^Math.imul(index+37,0x9e3779b9)^Math.imul(channel+1,0x85ebca6b);
 x=Math.imul(x^(x>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);
 return ((x^(x>>>16))>>>0)/4294967296;
}
export function platoonServiceFactor(id:string,minute:number):number{
 if(!Number.isFinite(minute))throw Error('Ungültige Anfahrzeit');
 // Generate a reproducible history with independently varying episode
 // duration, braking depth and recovery. There is no repeating pulse period.
 let history=dischargeHistories.get(id);
 if(!history){history={seed:dischargeSeed(id),end:-300,episodes:[]};dischargeHistories.set(id,history);}
 if(minute<-300)return 1;
 while(history.end<=minute){
  const i=history.episodes.length,r=(channel:number)=>dischargeRandom(history!.seed,i,channel);
  const stop=.28+.95*r(0),rise=.22+.6*r(1),flow=2+5.1*r(2),fall=.20+.65*r(3),low=.12+.32*r(4);
  const total=stop+rise+flow+fall,lowWeight=stop+(rise+fall)/2;
  // Mean requested service is sustained capacity, with physical free-lane
  // capacity still limiting the actual transfer at each substep.
  const high=(total-low*lowWeight)/(total-lowWeight);
  history.episodes.push({start:history.end,stop,rise,flow,fall,low,high});history.end+=total;
 }
 let lo=0,hi=history.episodes.length-1;
 while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(history.episodes[mid]!.start<=minute)lo=mid;else hi=mid-1;}
 const e=history.episodes[lo]!,t=minute-e.start;
 if(t<e.stop)return e.low;
 if(t<e.stop+e.rise)return e.low+(e.high-e.low)*(t-e.stop)/e.rise;
 if(t<e.stop+e.rise+e.flow)return e.high;
 return e.high-(e.high-e.low)*(t-e.stop-e.rise-e.flow)/e.fall;
}
/** Correlated spatial differences in reaction time stretch/compress packets
 * along a queue. Adjacent cells do not get independent cosmetic noise. */
function reactionTravelMinutes(id:string,distanceM:number):number{
 const seed=dischargeSeed(id),sectionM=2700;let time=0;
 for(let from=0,index=0;from<distanceM;from+=sectionM,index++){
  const speed=16+8*dischargeRandom(seed,index,9);
  time+=Math.min(sectionM,distanceM-from)/(speed*1000/60);
 }
 return time;
}
/** Advance exactly one model minute, including six stable 10-second updates.
 * Domain demand not admitted at the map entry is retained in backlog.
 * Outflow is discharged at the far end. No arbitrary time-loss surcharges.
 */
export function advanceCells(previous:CellRouteState,route:Corridor,events:readonly SimEvent[],
 demandVph:number,exits:readonly Exit[]=[],ports:readonly CellDetourPort[]=[]):CellRouteState{
 if(previous.pathKey!==route.key||!Number.isFinite(demandVph)||demandVph<0||demandVph>8000)
  throw Error('Zellmodell: Richtung oder Zufluss ungültig');
 const n=previous.cells.length,dx=previous.cellM/1000;
 const controls=localControls(route,events,demandVph,n,previous.cellM,exits);
 const {speeds,capacity,faceCapacity,jam,releases}=controls;
 const routed=ports.map(port=>{
  if(!((port.fromM===null||port.fromM>=0&&port.fromM<route.lengthM)&&
   (port.toM===null||port.toM>=0&&port.toM<=route.lengthM)&&
   (port.fromM===null||port.toM===null||port.toM>port.fromM)&&
   Number.isFinite(port.interestPercent)&&port.interestPercent>=0&&port.interestPercent<=100&&
   Number.isFinite(port.exitCapacityVph)&&port.exitCapacityVph>=0&&
   Number.isFinite(port.returnVehicles)&&port.returnVehicles>=0))throw Error('Ungültiger Umleitungsanschluss');
  return {...port,from:port.fromM===null?-1:Math.max(1,Math.min(n-1,Math.round(port.fromM/previous.cellM))),
   to:port.toM===null?-1:Math.max(1,Math.min(n-1,Math.round(port.toM/previous.cellM))),left:0,joined:0};
 });
 const occupancy=previous.cells.map(c=>c.vehicles);
 let backlog=previous.backlog,offeredTotal=previous.offeredTotal,exitedTotal=previous.exitedTotal;
 const cumulativeOut=Array(n).fill(0) as number[];
 const through=Array(n+1).fill(0) as number[];
 for(let sub=0;sub<SUBSTEPS;sub++){
  const density=occupancy.map(x=>x/dx);
  const send=density.map((k,i)=>Math.min(speeds[i]!*k,capacity[i]!)*DT_MIN/60);
  // Slow-to-start/platoon reaction inside an ACTUAL dense queue. The
  // bottleneck signal travels upstream at finite wave speed and limits
  // actual sending flow. Released gaps and braking packets therefore
  // change cell vehicle counts, local speeds and subsequent queue length.
  for(let i=0;i<n;i++){
   if(density[i]!<=jam*WAVE_KMH/(freeSpeedKmh(route.key)+WAVE_KMH)*1.15)continue;
   const next=releases.filter(r=>r.face>i).sort((a,b)=>a.face-b.face)[0];
   if(!next)continue;
   const distance=(next.face-i-.5)*previous.cellM;
   const signal=previous.minute+sub*DT_MIN-reactionTravelMinutes(next.event.id,distance);
   const reaction=Math.min(1,platoonServiceFactor(next.event.id,signal));
   send[i]=Math.min(send[i]!,capacity[i]!*reaction*DT_MIN/60);
  }
  const receive=density.map((k,i)=>Math.min(WAVE_KMH*Math.max(0,jam-k),capacity[i]!)*DT_MIN/60);
  const face=Array(n+1).fill(0) as number[];
  const leaving=Array(n).fill(0) as number[],joining=Array(n).fill(0) as number[];
  const currentCapacity=[...faceCapacity];
  for(const release of releases){
   const densityBefore=density[release.face-1]??0;
   if(densityBefore>jam*WAVE_KMH/(freeSpeedKmh(route.key)+WAVE_KMH)*1.15){
    currentCapacity[release.face]=Math.min(currentCapacity[release.face]!*platoonServiceFactor(
     release.event.id,previous.minute+sub*DT_MIN),release.maximum);
   }
  }
  const arrived=demandVph/60*DT_MIN;
  offeredTotal+=arrived;
  const available=arrived+backlog;
  face[0]=Math.min(available,receive[0]!);
  backlog=Math.max(0,available-face[0]!);
  for(let i=1;i<n;i++){
   const departures=routed.filter(p=>p.from===i&&p.interestPercent>0);
   const fraction=Math.min(1,departures.reduce((s,p)=>s+p.interestPercent/100,0));
   const totalInterest=departures.reduce((s,p)=>s+p.interestPercent,0);
   for(const p of departures){
    const requested=send[i-1]!*fraction*p.interestPercent/totalInterest;
    const accepted=Math.min(requested,p.exitCapacityVph*DT_MIN/60,
     Math.max(0,p.exitCapacityVph/60-p.left));
    p.left+=accepted;leaving[i-1]+=accepted;
   }
   const mainSend=send[i-1]!*(1-fraction);
   const returns=routed.filter(p=>p.to===i&&p.returnVehicles-p.joined>1e-9);
   const mergeDemand=returns.reduce((s,p)=>s+Math.min(p.returnVehicles-p.joined,1200*DT_MIN/60),0);
   const room=Math.min(receive[i]!,currentCapacity[i]!*DT_MIN/60);
   let main=Math.min(mainSend,room),merge=0;
   if(mergeDemand>0){
    merge=Math.min(mergeDemand,room*.22);main=Math.min(mainSend,room-merge);
    merge=Math.min(mergeDemand,room-main);
   }
   for(const p of returns){
    const accepted=merge*Math.min(p.returnVehicles-p.joined,1200*DT_MIN/60)/mergeDemand;
    p.joined+=accepted;joining[i]+=accepted;
   }
   face[i]=main;
  }
  face[n]=Math.min(send[n-1]!,currentCapacity[n]!*DT_MIN/60);
  exitedTotal+=face[n]!;
  for(let i=0;i<n;i++){
   occupancy[i]=Math.max(0,occupancy[i]!+face[i]!+joining[i]!-face[i+1]!-leaving[i]!);
   cumulativeOut[i]+=face[i+1]!+leaving[i]!;
   if(occupancy[i]>jam*dx+1e-5)throw Error('Zellmodell: Speicherdichte überschritten');
  }
  for(let i=0;i<=n;i++)through[i]+=face[i]!;
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
 const limiting=faceCapacity.reduce((best,c,i)=>c<faceCapacity[best]!?i:best,0);
 const next={...previous,cells,minute:previous.minute+1,backlog,offeredTotal,exitedTotal,
  divertedTotal:(previous.divertedTotal??0)+routed.reduce((s,p)=>s+p.left,0),
  rejoinedTotal:(previous.rejoinedTotal??0)+routed.reduce((s,p)=>s+p.joined,0),
  lastTransfers:routed.map(p=>({id:p.id,leaveVpm:p.left,joinVpm:p.joined})),
  dischargeVph:through[Number.isFinite(faceCapacity[limiting])?limiting:n]!*60,
  capacityVph:Math.min(baselineCapacity(route.key),...faceCapacity)};
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
