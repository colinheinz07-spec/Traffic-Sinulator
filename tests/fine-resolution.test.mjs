import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {DIRECTIONS} from '../dist/core.js';
import {makeCorridors,routeSlice,positionM} from '../dist/spatial.js';
import {initialiseCells,advanceCells,assertCellConservation,cellSpeedBands} from '../dist/traffic-cells.js';
import {freeSpeedKmh} from '../dist/traffic-physics.js';
import {speedDelayInCells,speedDelayLabel} from '../dist/speed-delay.js';
import {trafficView} from '../dist/traffic-view.js';
import {diversionJunctions} from '../dist/diversions.js';
import {automaticDiversions} from '../dist/auto-diversions.js';
import {bundledDetourGeometry,isNetworkDestination} from '../dist/bundled-detours.js';
import {emptyDetour} from '../dist/detour-flow.js';
import {routedDiversionChoice} from '../dist/diversion-policy.js';
import {defaultDemands} from '../dist/traffic.js';
import {validEvent,decodeEvents} from '../dist/events.js';

const routes=makeCorridors(networkData.roads,networkData.ramps),exits=networkData.exits;
const pairs=[['A3-frankfurt','42','43'],['A3-koeln','43','42'],['A48-dernbach','11','12'],['A48-koblenz','12','11']];
function incident(path,from,to,kind='accident',clearanceMin=30){
 const js=diversionJunctions(path,exits,routes[path]),a=js.find(j=>j.ref===from),b=js.find(j=>j.ref===to),at=(a.metre+b.metre)/2;
 const laneCount=path.startsWith('A48')?2:3;
 return {id:'fine-'+path,kind,pathKey:path,point:routeSlice(routes[path],at,at+1)[0],laneCount,
  closedLanes:Array.from({length:laneCount},(_,i)=>i),createdAt:'2026-10-24T13:00:00Z',
  settings:{lengthM:100,speedKmh:0,shoulder:'blocked',clearanceMin}};
}
function prepare(event){return automaticDiversions([event],routes,exits,{}).map(p=>{
 const config={id:p.key,path:p.path,fromM:p.from.metre,toM:p.to.metre,eventId:event.id,
  geometry:bundledDetourGeometry(p.key,p.path,p.from,p.to,exits),exitsNetwork:isNetworkDestination(p.to)};
 return {config,state:emptyDetour(config)};
});}

test('all motorway directions use real OSM cells up to 100m and a 130km/h free-flow reference',()=>{
 for(const path of DIRECTIONS){
  const route=routes[path];let state=initialiseCells(route,2000);
  assert.equal(freeSpeedKmh(path),130);assert.ok(state.cellM>99&&state.cellM<=100);
  assert.equal(state.cells[0].fromM,0);assert.ok(Math.abs(state.cells.at(-1).toM-route.lengthM)<1e-6);
  for(let minute=0;minute<5;minute++){
   state=advanceCells(state,route,[],2000,exits);assertCellConservation(state);
   assert.ok(state.cells.every(c=>c.vehicles>=0&&c.speedKmh<=130));
   assert.equal(cellSpeedBands(state).length,0);
  }
 }
});

test('seventeen queued cells display 1.7km, with independent 100m color transitions',()=>{
 const path='A3-frankfurt',state=initialiseCells(routes[path],0),start=100;
 for(let i=start;i<start+17;i++){
  const c=state.cells[i];c.densityVehKm=160;c.vehicles=160*state.cellM/1000;
  c.speedKmh=i%3===0?5:i%3===1?20:50;c.flowVph=c.speedKmh*160;
 }
 const bands=cellSpeedBands(state);
 assert.ok(bands.every(b=>Math.abs(b.toM-b.fromM-state.cellM)<1e-6));
 const shown=trafficView([],{[path]:state},routes,[],[],0);
 assert.equal(shown.jams.length,1);assert.equal(shown.reports[path].queueKm.toFixed(1),'1.7');
 assert.ok(Math.abs(shown.jams[0].queueM-17*state.cellM)<1e-6);
});

for(const [path,from,to] of pairs){
 test(`${path}: a completely blocked accident has a declared finite forecast while physical through-flow stays zero`,()=>{
  const route=routes[path],event=incident(path,from,to);let state=initialiseCells(route,2200);
  for(let minute=0;minute<20;minute++){
   state=advanceCells(state,route,[event],2200,exits);assertCellConservation(state);
  }
  const loss=speedDelayInCells(state),shown=trafficView([],{[path]:state},routes,[event],[],state.minute);
  assert.equal(state.dischargeVph,0);assert.equal(state.capacityVph,0);
  assert.equal(loss.blocked,false);assert.equal(loss.forecastWaitMin,30);
  assert.ok(loss.delayMin>30&&loss.delayMin<300);assert.match(speedDelayLabel(loss),/^~\+.*geschätzt/);
  assert.ok(shown.jams.length>0&&shown.jams.every(j=>j.delay.forecastWaitMin===30&&!j.delay.blocked));
  assert.deepEqual(speedDelayInCells({...state,minute:100000}),loss);
  const short=advanceCells(state,route,[{...event,settings:{...event.settings,clearanceMin:15}}],2200,exits);
  const long=advanceCells(state,route,[{...event,settings:{...event.settings,clearanceMin:75}}],2200,exits);
  assert.deepEqual(short.cells.map(c=>[c.vehicles,c.speedKmh,c.flowVph]),long.cells.map(c=>[c.vehicles,c.speedKmh,c.flowVph]));
  assert.ok(Math.abs(speedDelayInCells(long).delayMin-speedDelayInCells(short).delayMin-60)<1e-6);
  const released=advanceCells(long,route,[],700,exits);
  assert.equal(speedDelayInCells(released).forecastWaitMin,undefined);
  assert.ok(released.dischargeVph>0);assertCellConservation(released);
 });

 for(const kind of ['accident','roadworks','breakdown']){
  test(`${path} ${kind}: visible 45-minute forecast starts voluntary diversion without forced departures`,()=>{
   const route=routes[path],event=incident(path,from,to,kind,40),entries=prepare(event);
   const grid=advanceCells(initialiseCells(route,0),route,[event],0,exits);
   const head=grid.cells.find(c=>c.reopeningForecast),service=head.reopeningForecast.serviceVph;
   const queued=grid.cells.filter(c=>c.toM<=head.toM+.1&&c.toM>head.toM-10*grid.cellM+.1);
   const fromM=diversionJunctions(path,exits,route).find(j=>j.ref===from).metre;
   const km=queued.reduce((n,c)=>n+Math.max(0,c.toM-Math.max(c.fromM,fromM))/1000,0);
   assert.equal(queued.length,10);
   for(const target of [44.9,45,46]){
    const k=((target-40)+60*km/freeSpeedKmh(path))*service/(60*km);
    assert.ok(k<95*event.laneCount,'the threshold fixture must fit the physical road storage');
    for(const c of queued){c.densityVehKm=k;c.vehicles=k*grid.cellM/1000;c.speedKmh=0;c.flowVph=0;}
    const visible=speedDelayInCells(grid,fromM);assert.ok(Math.abs(visible.delayMin-target)<1e-6);
    const choices=entries.map(e=>({ref:e.config.geometry.sourceExitRef,...routedDiversionChoice(e,entries,{[path]:grid},routes,[event],exits,defaultDemands())}));
    assert.ok(choices.every(c=>!c.mandatory));
    const nearest=choices.find(c=>c.ref===from);
    if(target<45)assert.equal(nearest.percent,0);
    else{
     assert.ok(nearest&&nearest.percent>0&&nearest.percent<=3);
     assert.ok(Math.abs(nearest.delayMin-visible.delayMin)<1e-6);
    }
    for(const choice of choices)if(choice.delayMin<45-1e-9)assert.equal(choice.percent,0);
   }
  });
 }
}

test('reopening wait is counted once when one accident queue has separate moving fragments',()=>{
 const [path,from,to]=pairs[0],route=routes[path],event=incident(path,from,to,'accident',75);
 const state=advanceCells(initialiseCells(route,0),route,[event],0,exits);
 const at=state.cells.findIndex(c=>c.reopeningForecast);
 for(let i=at-22;i<=at;i++){
  const c=state.cells[i];if(i===at-11)continue;
  c.densityVehKm=180;c.vehicles=180*state.cellM/1000;c.speedKmh=0;c.flowVph=0;
 }
 const shown=trafficView([],{[path]:state},routes,[event],[],0);
 assert.equal(shown.physicalJams.length,2);assert.equal(shown.jams.length,1);
 assert.equal(shown.jams[0].delay.forecastWaitMin,75);
 assert.ok(Math.abs(shown.jams[0].delay.delayMin-speedDelayInCells(state).delayMin)<1e-6);
 assert.ok(shown.jams[0].delay.delayMin>75&&shown.jams[0].delay.delayMin<150);
});

test('the reopening assumption persists, accepts zero minutes, and rejects malformed forecasts',()=>{
 const event=incident(...pairs[0],'accident',75);assert.ok(validEvent(event));
 assert.equal(decodeEvents(JSON.stringify([event]))[0].settings.clearanceMin,75);
 for(const value of [-1,721,1.5,Infinity,NaN,'30'])
  assert.equal(validEvent({...event,settings:{...event.settings,clearanceMin:value}}),false);
 assert.ok(validEvent({...event,settings:{...event.settings,clearanceMin:0}}));
 const legacy={...event,settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}};
 assert.ok(validEvent(legacy));assert.equal(decodeEvents(JSON.stringify([legacy])).length,1);
});

test('a cleared old detector cannot override the current accident reopening scenario',()=>{
 const path='A3-frankfurt',route=routes[path];
 const first={...incident(path,'40','41'),id:'cleared-incident'},current=incident(path,'42','43');
 let state=initialiseCells(route,3400);
 for(let minute=0;minute<20;minute++)state=advanceCells(state,route,[first],3400,exits);
 for(let minute=0;minute<100;minute++)state=advanceCells(state,route,[current],3400,exits);
 assert.ok(state.cells.some(c=>c.travelDetector&&!c.travelDetector.active));
 const withoutMemory={...state,cells:state.cells.map(c=>c.travelDetector&&!c.travelDetector.active?
  {...c,travelDetector:undefined}:c)};
 const actual=speedDelayInCells(state),clean=speedDelayInCells(withoutMemory);
 assert.equal(actual.blocked,false);assert.equal(actual.forecastWaitMin,30);
 assert.ok(Math.abs(actual.delayMin-clean.delayMin)<1e-6,'the current reopening scenario must govern the same physical queue');
 assertCellConservation(state);
});
