import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors} from '../dist/spatial.js';
import {initialiseCells,advanceCells,assertCellConservation} from '../dist/traffic-cells.js';
import {mainlineMerges,sharedInterchangeReceiving} from '../dist/network-receiving.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
const target='A3-koeln';
function grid(atM=2000,metres=[atM]){
 const state=initialiseCells(routes[target],1000);
 for(const metre of metres){
  const cell=state.cells[Math.floor(metre/state.cellM)];
  cell.densityVehKm=(cell.jamDensityVehKm??390)-10;
  cell.vehicles=cell.densityVehKm*(cell.toM-cell.fromM)/1000;
  cell.speedKmh=0;
 }
 return state;
}
const merge=(from,metre)=>({from,to:target,mergeM:metre});
const ramp=(id,metre)=>({rampId:id,to:target,downstreamMergeM:metre});

test('at Heumar an A59 feeder and an interchange ramp share ONE physical A3 receiving cell',()=>{
 const heumar=mainlineMerges(routes).find(x=>x.from==='extra-a59-koeln'&&x.to===target);
 assert.ok(heumar,'actual OSM A59 to A3 contact must still exist');
 const cell=grid(heumar.mergeM),input={
  [heumar.from]:2100,'ramp-a48-to-koeln':1200
 };
 const original=JSON.stringify(cell);
 const result=sharedInterchangeReceiving({[target]:cell},[ramp('ramp-a48-to-koeln',heumar.mergeM)],[heumar],input);
 const a=result.mainline[heumar.from],b=result.ramps['ramp-a48-to-koeln'];
 assert.ok(a>0&&b>0&&a+b<=220+1e-6,{a,b}.toString());
 assert.ok(a<220&&b<220,'neither approach may receive a second entire 220 veh/h');
 assert.equal(JSON.stringify(cell),original,'a receiving query never modifies vehicles');
});
test('two motorways and two ramps entering one jammed cell share a single limit',()=>{
 const at=2500,cells={[target]:grid(at)};
 const from=[merge('extra-a59-koeln',at),merge('extra-a4-aachen',at)];
 const links=[ramp('ramp-a48-to-koeln',at),ramp('ramp-a48-to-frankfurt',at)];
 const demands={'extra-a59-koeln':1800,'extra-a4-aachen':1200,
  'ramp-a48-to-koeln':900,'ramp-a48-to-frankfurt':1500};
 const all=sharedInterchangeReceiving(cells,links,from,demands);
 const v=[...Object.values(all.mainline),...Object.values(all.ramps)];
 assert.equal(v.length,4);
 assert.ok(v.every(x=>x>0));
 assert.ok(v.reduce((sum,x)=>sum+x,0)<=220+1e-7);
 assert.deepEqual(
  sharedInterchangeReceiving(cells,[...links,links[0]],[...from,from[0]],demands),
  all,'duplicated OSM link does not get a second share');
});
test('a separate receiving cell keeps an independent physical capacity budget',()=>{
 const a=1300,b=3300,cells={[target]:grid(a,[a,b])};
 const allocation=sharedInterchangeReceiving(cells,
  [ramp('ramp-a48-to-koeln',a),ramp('ramp-a48-to-frankfurt',b)],
  [merge('extra-a59-koeln',a),merge('extra-a4-aachen',b)]);
 assert.ok(allocation.ramps['ramp-a48-to-koeln']>0);
 assert.ok(allocation.ramps['ramp-a48-to-frankfurt']>0);
 const first=allocation.mainline['extra-a59-koeln']+allocation.ramps['ramp-a48-to-koeln'];
 const second=allocation.mainline['extra-a4-aachen']+allocation.ramps['ramp-a48-to-frankfurt'];
 assert.ok(first<=220+1e-6&&second<=220+1e-6);
 assert.ok(first+second>220,'different cells do not falsely block each other');
});
test('free receiving cell never forces a phantom queue on A59 or its ramps',()=>{
 const clear=initialiseCells(routes[target],900),metre=5000;
 assert.deepEqual(sharedInterchangeReceiving({[target]:clear},
  [ramp('ramp-a48-to-koeln',metre)],[merge('extra-a59-koeln',metre)]),
  {mainline:{},ramps:{}});
});
test('zero arrivals on a ramp do not steal capacity, but its stored queue survives',()=>{
 const at=2300,cells={[target]:grid(at)};
 const closed='ramp-a48-to-koeln',inflow='extra-a59-koeln';
 const links=[ramp(closed,at)],merges=[merge(inflow,at)];
 const only=sharedInterchangeReceiving(cells,links,merges,{[closed]:0,[inflow]:2200});
 assert.equal(only.ramps[closed],0);
 assert.ok(only.mainline[inflow]>0);
 const queued=sharedInterchangeReceiving(cells,links,merges,{[closed]:0,[inflow]:2200},{[closed]:20});
 assert.ok(queued.ramps[closed]>0);
 assert.ok(queued.mainline[inflow]>0);
 assert.ok(queued.ramps[closed]+queued.mainline[inflow]<=220+1e-6);
});
test('formal motorway closure reserves zero entry capacity for ALL incoming arms',()=>{
 const metre=2000,state=initialiseCells(routes[target],1200);
 state.closures=[{face:20,fromM:1900,toM:2100,exitRef:null,eventId:'closure',diverting:false}];
 const limits=sharedInterchangeReceiving({[target]:state},
  [ramp('ramp-a48-to-koeln',metre)],[merge('extra-a59-koeln',metre)]);
 assert.equal(limits.ramps['ramp-a48-to-koeln'],0);
 assert.equal(limits.mainline['extra-a59-koeln'],0);
});
test('feeder CTM conserves its vehicles when pooled destination supply is exhausted',()=>{
 const mergeM=1000,to=initialiseCells(routes[target],2400);
 to.closures=[{face:10,fromM:950,toM:1050,exitRef:null,eventId:'closed',diverting:false}];
 const source='extra-a59-koeln',grid=initialiseCells(routes[source],2200);
 const pooled=sharedInterchangeReceiving({[target]:to},[ramp('ramp-a48-to-koeln',mergeM)],[merge(source,mergeM)]);
 const next=advanceCells(grid,routes[source],[],2200,[],[],undefined,pooled.mainline[source]);
 assertCellConservation(next);
 assert.equal(pooled.mainline[source],0);
 assert.ok(next.backlog>=0);
});

test('stopped motorway feeder retains receiving service for cars already near the junction',()=>{
 const metre=2700,source='extra-a59-koeln',onRamp='ramp-a48-to-koeln';
 const targetState=grid(metre);
 const approach=initialiseCells(routes[source],1700);
 assert.ok(approach.cells.at(-1).vehicles>0);
 const vehicles=approach.cells.at(-1).vehicles;
 const available=sharedInterchangeReceiving(
  {[target]:targetState,[source]:approach},
  [ramp(onRamp,metre)],[merge(source,metre)],
  {[source]:0,[onRamp]:1500});
 assert.ok(available.mainline[source]>0,'the feeder cannot freeze when new external arrivals stop');
 assert.ok(available.ramps[onRamp]>0);
 assert.ok(available.mainline[source]+available.ramps[onRamp]<=220+1e-6);
 assert.equal(approach.cells.at(-1).vehicles,vehicles);
});
