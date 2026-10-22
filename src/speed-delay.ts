/** Speed-based travel-time LOSS on the actual mainline cells.
 * For a traversable cell: delta=t_at_local_speed - t_at_free_speed.
 * A cell with v=0 cannot be traversed and has NO finite predictive
 * through-travel time. We therefore expose only a minimum known loss from
 * traversable neighbouring cells, and an explicit blocked flag.
 * This calculation depends on NO clock, event age or queue-created timestamp.
 */
import type {CellRouteState} from './traffic-cells.js';
import {freeSpeedKmh,type SpeedBand} from './traffic-physics.js';
import type {PathKey} from './traffic.js';
export interface SpeedDelay {
 delayMin:number;blocked:boolean;assessedKm:number;stoppedKm:number;
}
export function speedDelayInCells(state:CellRouteState,fromM=0,toM=Infinity):SpeedDelay{
 const free=freeSpeedKmh(state.pathKey);
 if(!Number.isFinite(fromM)||Number.isNaN(toM)||fromM<0||toM<=fromM)
  throw Error('Ungültiger Streckenbereich zur Zeitverlustberechnung');
 let delayMin=0,assessedKm=0,stoppedKm=0;
 for(const c of state.cells){
  const start=Math.max(c.fromM,fromM),end=Math.min(c.toM,toM);
  if(end<=start||c.vehicles<.01)continue;
  const km=(end-start)/1000;
  const local=Math.min(free,Math.max(0,c.speedKmh));
  // A true standstill is not equivalent to driving at a fictional 1–5 km/h.
  if(local<=1e-6){stoppedKm+=km;continue;}
  assessedKm+=km;
  delayMin+=Math.max(0,60*km*(1/local-1/free));
 }
 return {delayMin,blocked:stoppedKm>.0001,assessedKm,stoppedKm};
}
/** Bands must already be resolved, so overlapping queues count only once. */
export function speedDelayInBands(path:PathKey,bands:readonly SpeedBand[]):SpeedDelay{
 const free=freeSpeedKmh(path);
 let delayMin=0,assessedKm=0,stoppedKm=0;
 for(const b of bands){
  const km=Math.max(0,b.toM-b.fromM)/1000;
  const speed=Math.max(0,Math.min(free,b.speedKmh));
  if(speed<=1e-6){stoppedKm+=km;continue;}
  assessedKm+=km;
  delayMin+=Math.max(0,60*km*(1/speed-1/free));
 }
 return {delayMin,blocked:stoppedKm>.0001,assessedKm,stoppedKm};
}
export function speedDelayLabel(value:SpeedDelay,precision=1,compact=false):string{
 const n=value.delayMin.toLocaleString('de-DE',{minimumFractionDigits:precision,maximumFractionDigits:precision});
 if(compact&&value.blocked)return value.delayMin>=.05?
  '≥ +'+n+' min · blockiert':'Zeitverlust offen · blockiert';
 if(value.blocked)return value.delayMin>=.05?
  'mindestens +'+n+' min · Durchfahrt blockiert':
  'Durchfahrt blockiert · Verzögerung nicht prognostizierbar';
 return '+'+n+' min';
}
