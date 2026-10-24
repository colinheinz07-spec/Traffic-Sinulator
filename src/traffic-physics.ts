/** Deterministic, speed-based traffic colors and a kinematic-wave approximation.
 * The resulting speeds are MODEL ESTIMATES, not GPS measurements.
 */
import type {PathKey,TrafficColor} from './traffic.js';

export interface SpeedBand {
 fromM:number;toM:number;color:TrafficColor;speedKmh:number;
 source:'queue'|'approach'|'restriction'|'cell';
}
const RANK:Record<TrafficColor,number>={free:0,slow:1,jam:2,standstill:3};
export function freeSpeedKmh(path:PathKey):number{
 return path.startsWith('ramp-')?80:130;
}
/** One consistent definition for UI, queues, ramps and OSM map overlays. */
export function colorAtSpeed(speedKmh:number):TrafficColor{
 if(!Number.isFinite(speedKmh)||speedKmh<0)throw Error('Geschwindigkeit muss nichtnegativ und endlich sein');
 if(speedKmh<=10)return 'standstill';
 if(speedKmh<=30)return 'jam';
 if(speedKmh<=65)return 'slow';
 return 'free';
}
/** Congested branch of a triangular fundamental diagram:
 * Q = w(k_jam - k). On recovery, clip k to critical density.
 * w=22 km/h, jam storage 95 veh/km/lane; scenario assumptions.
 * This ties the queued travel speed, queue length and discharge to ONE density.
 */
export function queueFundamentalDiagram(capacityVph:number,lanes:number,path:PathKey):{
 densityVehPerKm:number;speedKmh:number
}{
 if(!Number.isFinite(capacityVph)||capacityVph<0||!Number.isFinite(lanes)||lanes<=0)
  throw Error('Ungültige Kapazität oder Fahrstreifenanzahl');
 const free=freeSpeedKmh(path),jamDensity=95*lanes,w=22;
 const criticalDensity=jamDensity*w/(free+w);
 const density=Math.max(criticalDensity,jamDensity-capacityVph/w);
 const speedKmh=capacityVph===0?0:Math.min(free,capacityVph/density);
 return {densityVehPerKm:density,speedKmh};
}
/** The back-of-queue transition is derived from a comfortable 1.4m/s^2
 * deceleration, not a fixed orange/red percentage of the queue. The queue
 * itself has a single estimated velocity until cell-based densities exist.
 * No extra vehicles or waiting minutes are created by these approach bands.
 */
export function physicalSpeedBands(jam:{
 anchorM:number;queueM:number;speedKmh:number;pathKey:PathKey
}):SpeedBand[]{
 const tail=Math.max(0,jam.anchorM-jam.queueM);
 const end=jam.anchorM,queuedSpeed=Math.max(0,Math.min(freeSpeedKmh(jam.pathKey),jam.speedKmh));
 if(end-tail<.5)return [];
 const result:SpeedBand[]=[];
 const free=freeSpeedKmh(jam.pathKey),a=1.4;
 const brakeM=Math.min(tail,Math.max(0,((free/3.6)**2-(queuedSpeed/3.6)**2)/(2*a)));
 const cuts=[0,brakeM];
 for(const v of [10,30,65]){
  if(v<=queuedSpeed||v>=free)continue;
  const d=((v/3.6)**2-(queuedSpeed/3.6)**2)/(2*a);
  if(d>0&&d<brakeM)cuts.push(d);
 }
 cuts.sort((a,b)=>a-b);
 for(let i=1;i<cuts.length;i++){
  const near=cuts[i-1]!,far=cuts[i]!;
  if(far-near<.5)continue;
  const midpoint=(near+far)/2;
  const v=Math.min(free,Math.sqrt((queuedSpeed/3.6)**2+2*a*midpoint)*3.6);
  const color=colorAtSpeed(v);
  if(color!=='free')result.push({fromM:tail-far,toM:tail-near,speedKmh:v,color,source:'approach'});
 }
 result.push({fromM:tail,toM:end,color:colorAtSpeed(queuedSpeed),speedKmh:queuedSpeed,source:'queue'});
 return result;
}
/** Choose the slowest physically modelled speed on overlaps, rather than
 * whichever incident happens to be drawn last. Adjacent equal colors merge.
 */
export function resolveSpeedBands(bands:readonly SpeedBand[]):SpeedBand[]{
 if(!bands.length)return [];
 const edges=[...new Set(bands.flatMap(b=>[b.fromM,b.toM]))].sort((a,b)=>a-b);
 const out:SpeedBand[]=[];
 for(let i=1;i<edges.length;i++){
  const fromM=edges[i-1]!,toM=edges[i]!;
  if(toM-fromM<.1)continue;
  const active=bands.filter(b=>b.fromM<toM-.001&&b.toM>fromM+.001);
  if(!active.length)continue;
  const chosen=active.reduce((a,b)=>RANK[b.color]>RANK[a.color]||
   (RANK[b.color]===RANK[a.color]&&b.speedKmh<a.speedKmh)?b:a);
  const last=out.at(-1);
  if(last&&last.color===chosen.color&&last.source===chosen.source&&Math.abs(last.toM-fromM)<.001){
   last.toM=toM;last.speedKmh=Math.min(last.speedKmh,chosen.speedKmh);
  }else out.push({...chosen,fromM,toM});
 }
 return out;
}

/** A finite-speed, deterministic approximation of stop-and-go wave packets.
 * Wave packets are generated near the bottleneck and travel UPSTREAM at
 * about 14 km/h (230 m per model minute). The speed history makes an edited
 * incident take effect near its position before farther-upstream traffic.
 *
 * The packet pulses are NOT an independently mass-conserving CTM: queue
 * vehicle count and waiting minutes remain owned by the conservation solver.
 * This is a speed-field approximation until corridor cells are modelled.
 */
export interface HistoricalSpeed {minute:number;speedKmh:number}
export interface MovingQueue extends Pick<SpeedBand,'speedKmh'> {
 pathKey:PathKey;id?:string;anchorM:number;queueM:number;
 speedHistory?:readonly HistoricalSpeed[];offsetBackM?:number;
}
const WAVE_UPSTREAM_M_PER_MIN=230; // -13.8 km/h kinematic wave assumption
const CELL_M=100;
function sourceSpeed(history:readonly HistoricalSpeed[]|undefined,time:number,fallback:number):number{
 if(!history?.length)return fallback;
 let lo=0,hi=history.length-1;
 if(time<=history[0]!.minute)return history[0]!.speedKmh;
 if(time>=history[hi]!.minute)return history[hi]!.speedKmh;
 while(lo+1<hi){
  const mid=(lo+hi)>>1;
  if(history[mid]!.minute<=time)lo=mid;else hi=mid;
 }
 // In-between source observations are interpolated, avoiding 1-minute jumps.
 const a=history[lo]!,b=history[hi]!,fraction=(time-a.minute)/(b.minute-a.minute);
 return a.speedKmh+(b.speedKmh-a.speedKmh)*fraction;
}
/** Propagation time along the existing queue: a new bottleneck speed
 * reaches a point x metres upstream only after x / 230 model minutes.
 */
export function propagatedBaseSpeed(history:readonly HistoricalSpeed[]|undefined,
 minute:number,backFromBottleneckM:number,fallback:number):number{
 return sourceSpeed(history,minute-Math.max(0,backFromBottleneckM)/WAVE_UPSTREAM_M_PER_MIN,fallback);
}
/** Variable dwell/release episodes, reproducible without global PRNG state.
 * Durations vary by episode: a free-flow burst does not occur every fixed
 * number of minutes. The same timestamp/id always yields the same wave.
 */
export interface WaveEpisode {startMinute:number;riseMin:number;flowMin:number;fallMin:number;stopGapMin:number}
function hashSeed(id:string):number{
 let h=2166136261;
 for(const char of id)h=Math.imul(h^char.charCodeAt(0),16777619);
 return h>>>0;
}
function waveRandom(seed:number,index:number,channel:number):number{
 let x=(seed^Math.imul(index+91,0x9e3779b9)^Math.imul(channel+1,0x85ebca6b))|0;
 x=Math.imul(x^(x>>>16),0x7feb352d);
 x=Math.imul(x^(x>>>15),0x846ca68b);
 return ((x^(x>>>16))>>>0)/4294967296;
}
/** Start times and durations are not periodic. After each episode a variable
 * stop interval follows; prolonged standing is normal in a heavy jam.
 */
export function waveEpisodes(id:string,throughMinute:number):WaveEpisode[]{
 if(!Number.isFinite(throughMinute))throw Error('Ungültige Wellenzeit');
 const seed=hashSeed(id),result:WaveEpisode[]=[];
 let time=-75;
 for(let i=0;i<3000&&time<=throughMinute+18;i++){
  // Rare and varied release episodes, separated by longer settled phases.
  // This is a visual speed perturbation and never creates actual vehicles.
  const riseMin=1.2+2.8*waveRandom(seed,i,1);
  const flowMin=1.2+3.7*waveRandom(seed,i,2);
  const fallMin=1.5+3*waveRandom(seed,i,3);
  const stopGapMin=8+23*waveRandom(seed,i,4);
  result.push({startMinute:time,riseMin,flowMin,fallMin,stopGapMin});
  time+=riseMin+flowMin+fallMin+stopGapMin;
 }
 return result;
}
/** Only modest, local release waves. No artificial 60-km/h surges inside
 * a near-standing queue. The base congestion estimate determines its
 * principal color; sporadic small differences may cross a color boundary.
 */
export function localWaveSpeed(base:number,passedTime:number,id:string,queueKm:number,
 free:number,roadType:'motorway'|'ramp'='motorway'):number{
 const value=Math.max(0,Math.min(free,base));
 if(value<=.001||value>=65||queueKm<.7)return value;
 const seed=hashSeed(id);
 const severity=Math.min(1,queueKm/2.5)*Math.min(1,(65-value)/55);
 const rampScale=roadType==='ramp'?.60:1;
 // Steady low-speed traffic remains low-speed: don't fabricate perpetual
 // standing followed by abrupt orange spikes.
 const resting=value<=10?value*.72:value*.94;
 const episodes=waveEpisodes(id,passedTime);
 for(let i=episodes.length-1;i>=0;i--){
  const e=episodes[i]!,elapsed=passedTime-e.startMinute;
  if(elapsed<0)continue;
  const duration=e.riseMin+e.flowMin+e.fallMin;
  if(elapsed>duration)break;
  const progress=elapsed<e.riseMin?elapsed/e.riseMin:
   elapsed<e.riseMin+e.flowMin?1:
   Math.max(0,1-(elapsed-e.riseMin-e.flowMin)/e.fallMin);
  const boost=severity*rampScale*(6+10*waveRandom(seed,i,7));
  // A 5-km/h jam may locally rise into red, but never orange or green
  // solely because of a scripted wave.
  const ceiling=value<=10?23:value<=30?44:Math.min(free,value+12);
  return Math.max(0,Math.min(ceiling,resting+boost*progress));
 }
 return resting;
}
/** Piecewise per-cell speed estimates, with consistent colorAtSpeed().
 * The fixed cell grid is anchored on OSM route metres, so its edges do not
 * all jump when the queue head/tail changes.
 */
export function stopAndGoBands(jam:MovingQueue,simMinute:number):SpeedBand[]{
 const tail=Math.max(0,jam.anchorM-jam.queueM),end=jam.anchorM;
 if(end-tail<.5)return [];
 if(!Number.isFinite(simMinute)||simMinute<0)throw Error('Ungültige Simulationsminute');
 const free=freeSpeedKmh(jam.pathKey),out:SpeedBand[]=[];
 const beginCell=Math.floor(tail/CELL_M);
 const lastCell=Math.ceil(end/CELL_M);
 for(let c=beginCell;c<lastCell;c++){
  const fromM=Math.max(tail,c*CELL_M),toM=Math.min(end,(c+1)*CELL_M);
  if(toM-fromM<.5)continue;
  const upstreamM=(jam.offsetBackM??0)+jam.anchorM-(fromM+toM)/2;
  const signalTime=simMinute-upstreamM/WAVE_UPSTREAM_M_PER_MIN;
  const source=propagatedBaseSpeed(jam.speedHistory,simMinute,upstreamM,jam.speedKmh);
  const kmh=localWaveSpeed(source,signalTime,jam.id??jam.pathKey,jam.queueM/1000,free,
   jam.pathKey.startsWith('ramp-')||jam.offsetBackM!==undefined?'ramp':'motorway');
  const color=colorAtSpeed(kmh);
  const last=out.at(-1);
  if(last&&last.color===color&&Math.abs(last.toM-fromM)<.01){
   last.toM=toM;last.speedKmh=Math.min(last.speedKmh,kmh);
  }else out.push({fromM,toM,speedKmh:kmh,color,source:'queue'});
 }
 return out;
}
