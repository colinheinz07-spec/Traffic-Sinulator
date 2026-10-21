/** Vehicle-conserving detour on a fetched, connected real OSM road.
 * Vehicle ledger: admitted = waiting-on-local-road + in-transit
 *                + returned-to-motorway (cumulative).
 * No active detour exists until the actual road geometry is validated.
 */
export function emptyDetour(config){
 if(!(config.toM>config.fromM)||config.id!==config.geometry.id||config.path!==config.geometry.path)
  throw Error('Umleitungsanschlüsse ungültig oder falsche Richtung');
 return {id:config.id,minute:0,waitingRoad:0,transit:[],admittedTotal:0,returnedTotal:0,
  lastDeparture:0,lastRejoined:0};
}
export function detourVehicles(state){
 return state.waitingRoad+state.transit.reduce((n,a)=>n+a.vehicles,0);
}
export function advanceDetour(state,config,minute,
 motorwayDemandVph,interestPercent,remainingMergeCapacityVph){
 if(state.id!==config.id||!Number.isFinite(motorwayDemandVph)||motorwayDemandVph<0||
 !Number.isFinite(interestPercent)||interestPercent<0||interestPercent>100||
 !Number.isFinite(remainingMergeCapacityVph)||remainingMergeCapacityVph<0)
  throw Error('Umleitungszustand oder Zufluss ungültig');
 if(minute<state.minute||!Number.isInteger(minute))throw Error('Umleitungszeit rückwärts');
 const d=config.geometry;
 // Capacity of an exit ramp and the side road are separate constraints.
 const maxLocalStorage=Math.max(80,d.lengthKm*90);
 const wanted=motorwayDemandVph/60*interestPercent/100;
 const admitted=Math.min(wanted,1200/60,Math.max(0,maxLocalStorage-detourVehicles(state)));
 const baseCapacity=d.roadCapacityVph;
 // Mild time-dependent discharge at signals, without invented traffic cycles
 // synchronised across all U routes.
 const signal=.86+.14*(.5+.5*Math.sin(minute*.29+config.id.length));
 const capacity=baseCapacity*signal;
 const service=Math.min(state.waitingRoad+admitted,capacity/60);
 const roadQueue=Math.max(0,state.waitingRoad+admitted-service);
 const travelMinutes=Math.max(2,Math.ceil(d.freeMinutes));
 const due=minute+travelMinutes;
 const transit=state.transit.map(x=>({...x}));
 if(service>0)transit.push({minute:due,vehicles:service});
 let ready=0;
 const pending=transit.filter(x=>{
  if(x.minute<=minute){ready+=x.vehicles;return false;}return true;
 });
 // Only the amount with available mainline merge supply is reintroduced.
 // The remainder stays in the side-road queue at its downstream end.
 const mergeService=Math.min(ready,remainingMergeCapacityVph/60);
 if(ready>mergeService+1e-9)pending.push({minute:minute+1,vehicles:ready-mergeService});
 const next={id:state.id,minute:minute+1,waitingRoad:roadQueue,transit:pending,
  admittedTotal:state.admittedTotal+admitted,returnedTotal:state.returnedTotal+mergeService,
  lastDeparture:admitted,lastRejoined:mergeService};
 if(Math.abs(next.admittedTotal-next.returnedTotal-detourVehicles(next))>1e-5)
  throw Error('Umleitungs-Fahrzeugbilanz verletzt');
 return {
  state:next,entered:admitted,rejoined:mergeService,capacityVph:capacity,
  roadDelayMin:roadQueue/(capacity/60)+d.freeMinutes,
  remainingOnMotorway:Math.max(0,motorwayDemandVph/60-admitted),
  transfer:{id:config.id,path:config.path,fromM:config.fromM,toM:config.toM,
   leaveVpm:admitted,joinVpm:mergeService}
 };
}
