/** Deterministic, speed-based traffic colors and a kinematic-wave approximation.
 * The resulting speeds are MODEL ESTIMATES, not GPS measurements.
 */
const RANK = {free:0,slow:1,jam:2,standstill:3};
export function freeSpeedKmh(path){
 return path.startsWith('ramp-')?80:path.startsWith('A48')?100:120;
}
/** One consistent definition for UI, queues, ramps and OSM map overlays. */
export function colorAtSpeed(speedKmh){
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
export function queueFundamentalDiagram(capacityVph,lanes,path){
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
export function physicalSpeedBands(jam){
 const tail=Math.max(0,jam.anchorM-jam.queueM);
 const end=jam.anchorM,queuedSpeed=Math.max(0,Math.min(freeSpeedKmh(jam.pathKey),jam.speedKmh));
 if(end-tail<.5)return [];
 const result=[];
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
  const near=cuts[i-1],far=cuts[i];
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
export function resolveSpeedBands(bands){
 if(!bands.length)return [];
 const edges=[...new Set(bands.flatMap(b=>[b.fromM,b.toM]))].sort((a,b)=>a-b);
 const out=[];
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
