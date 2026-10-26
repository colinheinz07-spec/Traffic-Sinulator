import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {exitPosition} from '../dist/core.js';
import {makeCorridors,routeSlice,positionM,closureGate} from '../dist/spatial.js';
import {diversionJunctions} from '../dist/diversions.js';
import {automaticDiversions} from '../dist/auto-diversions.js';
import {bundledDetourGeometry,isNetworkDestination} from '../dist/bundled-detours.js';
import {emptyDetour} from '../dist/detour-flow.js';
import {advanceRoutedPath,advanceRoutedNetwork} from '../dist/routed-traffic.js';
import {initialiseCells,advanceCells,assertCellConservation} from '../dist/traffic-cells.js';
import {speedDelayInCells,speedDelayLabel} from '../dist/speed-delay.js';
import {junctionMovements} from '../dist/junction-movements.js';
import {trafficView} from '../dist/traffic-view.js';
import {maxLengthM,validEvent} from '../dist/events.js';
import {defaultDemands,demandAtClock} from '../dist/traffic.js';
import {junctionMovementHint} from '../dist/junction-movements.js';

const routes=makeCorridors(networkData.roads,networkData.ramps),exits=networkData.exits;
const junction=(path,ref)=>diversionJunctions(path,exits,routes[path]).find(j=>j.ref===ref);
function closure(path,from,to,offset=100){
 const a=junction(path,from),b=junction(path,to),at=a.metre+Math.min(offset,(b.metre-a.metre)/3);
 const laneCount=path.startsWith('A48')?2:3;
 return {id:'closed-'+path,kind:'closure',pathKey:path,point:routeSlice(routes[path],at,at+2)[0],
  laneCount,closedLanes:Array.from({length:laneCount},(_,i)=>i),createdAt:'2026-10-23T22:00:00Z',
  settings:{lengthM:Math.max(1,Math.round(b.metre-at)),speedKmh:0,shoulder:'blocked'}};
}
function prepare(event){return automaticDiversions([event],routes,exits,{}).map(p=>{
 const config={id:p.key,path:p.path,fromM:p.from.metre,toM:p.to.metre,eventId:event.id,
  geometry:bundledDetourGeometry(p.key,p.path,p.from,p.to,exits),exitsNetwork:isNetworkDestination(p.to)};
 return {config,state:emptyDetour(config)};
});}

test('all 26 regular directional off-ramps match audited OSM nodes on their own carriageway',()=>{
 const audit=JSON.parse(readFileSync('data/junction-audit.json','utf8'));let count=0;
 for(const exit of exits.filter(e=>!e.name.startsWith('AD ')&&!e.name.startsWith('AK '))){
  for(const [path,node] of Object.entries(exit.directional)){
   count++;const raw=audit.junctions.find(n=>n.id===node.nodeId);
   assert.ok(raw&&raw.paths.includes(path));assert.equal(raw.tags.ref,exit.ref);
   assert.deepEqual(node.position,[raw.lat,raw.lon]);
   assert.notEqual(positionM(routes[path],node.position,2),null,path+' / AS '+exit.ref);
  }
 }
 assert.equal(count,26);
});

test('Limburg uses the actual OSM off-ramp node on each carriageway',()=>{
 for(const [ref,path,id] of [['42','A3-frankfurt',398262],['42','A3-koeln',398265],
  ['43','A3-frankfurt',4026966591],['43','A3-koeln',235277087]]){
  const exit=exits.find(e=>e.road==='A3'&&e.ref===ref);
  assert.equal(exit.directional[path].nodeId,id);
  const point=exitPosition(exit,path),route=routes[path];
  assert.notEqual(positionM(route,point,2),null,'verified node must be on its actual mainline');
 }
 // This real bridge approach is AFTER the Frankfurt off-ramp at Nord,
 // but before the old shared node that incorrectly selected Diez.
 const route=routes['A3-frankfurt'],at=positionM(route,[50.398,8.070],1000);
 const event={...closure('A3-frankfurt','42','43'),point:routeSlice(route,at,at+2)[0],
  settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}};
 assert.equal(closureGate(route,event,exits).exit.ref,'42');
});

for(const [path,from,to] of [['A3-frankfurt','42','43'],['A3-koeln','43','42'],
 ['A48-dernbach','11','12'],['A48-koblenz','12','11']]){
 test(`${path}: closure at or just after the AS exits there, clears its segment and shows approach delay`,()=>{
  const route=routes[path],a=junction(path,from),b=junction(path,to);
  for(const offset of [0,10,25,49]){
   const event=closure(path,from,to,offset),gate=closureGate(route,event,exits);
   assert.equal(gate.exit.ref,from,'no 50m jump to the previous junction');
   assert.equal(gate.endExit.ref,to);
   const rows=junctionMovements(path,route,exits,[event],null);
   assert.deepEqual(rows.filter(r=>r.mandatory).map(r=>r.exit.ref),[from]);
  }
  const event=closure(path,from,to);let entries=prepare(event),state=initialiseCells(route,2200);
  const firstFace=Math.max(1,Math.round(a.metre/state.cellM)),lastFace=Math.round(b.metre/state.cellM);
  const inside=s=>s.cells.slice(firstFace,lastFace).reduce((n,c)=>n+c.vehicles,0),initialInside=inside(state);
  for(let minute=0;minute<45;minute++){
   const next=advanceRoutedPath(state,route,[event],2200,exits,entries);state=next.cells;entries=next.detours;
   assertCellConservation(state);
   assert.equal(state.junctions.find(j=>j.ref===from).lastEntered,0);
  }
  const main=entries.find(e=>e.config.geometry.sourceExitRef===from);
  assert.equal(main.desiredPercent,100);
  assert.ok(main.state.admittedTotal>20&&main.state.lastDeparture>0,'cars must actually leave');
  assert.ok(main.state.returnedTotal>0,'routed cars rejoin beyond the closed segment');
  assert.ok(inside(state)<initialInside*.01,'existing vehicles must clear the closed segment');
  const delay=speedDelayInCells(state);
  assert.equal(delay.blocked,false);
  assert.equal(delay.diversionExitRef,from);
  assert.ok(delay.delayMin>1&&delay.delayMin<180);
  assert.match(speedDelayLabel(delay),new RegExp('bis Ausleitung AS '+from));
  assert.deepEqual(speedDelayInCells({...state,minute:100000}),delay,'never use closure age as delay');
  const inner=speedDelayInCells(state,a.metre+state.cellM*.6,b.metre-10);
  assert.equal(inner.blocked,true,'the closed mainline itself has no through-time forecast');
  const view=trafficView([],{[path]:state},routes,[event],[],state.minute);
  for(const jam of view.jams.filter(j=>j.anchorM<=a.metre+state.cellM)){
   assert.equal(jam.delay.blocked,false);assert.equal(jam.delay.diversionExitRef,from);
  }
 });
}

test('363 low-demand minutes: Limburg-Nord is mandatory, Diez remains an ordinary AS',()=>{
 const path='A3-frankfurt',route=routes[path],event=closure(path,'42','43');
 let entries=prepare(event),state=initialiseCells(route,600);
 for(let minute=0;minute<363;minute++){
  const next=advanceRoutedPath(state,route,[event],600,exits,entries);state=next.cells;entries=next.detours;
 }
 assert.ok(entries.find(e=>e.config.geometry.sourceExitRef==='42').state.admittedTotal>100);
 const diez=entries.find(e=>e.config.geometry.sourceExitRef==='41');
 assert.equal(diez.desiredPercent,0);assert.equal(diez.state.admittedTotal,0);
 assert.ok(state.junctions.find(j=>j.ref==='41').lastExited>0,'ordinary destination trips still leave');
 assert.equal(state.junctions.find(j=>j.ref==='42').lastEntered,0);
 assert.equal(speedDelayInCells(state).diversionExitRef,'42');
});

test('Montabaur to Limburg-Nord: Diez and Montabaur cannot inject or receive returning motorway traffic',()=>{
 const path='A3-frankfurt',route=routes[path],event=closure(path,'40','42'),gate=closureGate(route,event,exits);
 assert.ok(event.settings.lengthM>10000&&event.settings.lengthM<=maxLengthM('closure'));
 assert.ok(validEvent(event));assert.equal(gate.exit.ref,'40');assert.equal(gate.endExit.ref,'42');
 let entries=prepare(event),state=initialiseCells(route,800);
 assert.ok(entries.every(e=>e.config.geometry.targetExitRef==='42'));
 assert.ok(entries.every(e=>e.config.geometry.sourceExitRef!=='41'),'no detour starts inside the closure');
 for(let minute=0;minute<120;minute++){
  const next=advanceRoutedPath(state,route,[event],800,exits,entries);state=next.cells;entries=next.detours;
  for(const ref of ['40','41'])assert.equal(state.junctions.find(j=>j.ref===ref).lastEntered,0);
 }
 assert.ok(state.junctions.find(j=>j.ref==='42').lastEntered>0,'the end AS stays open');
 const main=entries.find(e=>e.config.geometry.sourceExitRef==='40');
 assert.ok(main.state.returnedTotal>50);assert.equal(main.desiredPercent,100);
 // An older route aimed at Diez must wait, even if it was loaded earlier.
 const before=state.rejoinedTotal;
 state=advanceCells(state,route,[event],800,exits,[{id:'old-return',fromM:null,toM:junction(path,'41').metre,
  interestPercent:0,exitCapacityVph:0,returnVehicles:25}]);
 assert.equal(state.lastTransfers[0].joinVpm,0);assert.equal(state.rejoinedTotal,before);
});

test('a closure before the first AS rejects new entry at the actual network boundary',()=>{
 const path='A3-frankfurt',route=routes[path],event=closure(path,'34','35');
 event.point=routeSlice(route,100,102)[0];event.settings.lengthM=100;
 let state=initialiseCells(route,600);
 state=advanceCells(state,route,[event],600,exits);
 assert.equal(state.closures[0].face,0);assert.ok(Math.abs(state.backlog-10)<1e-6);
 assert.equal(speedDelayInCells(state).blocked,true);assertCellConservation(state);
});

for(const [path,from,to] of [['A3-frankfurt','42','43'],['A3-koeln','43','42'],
 ['A48-dernbach','11','12'],['A48-koblenz','12','11']]){
 test(`${path}: paused routes cannot disable mandatory exit, including Saturday's displayed entry counts`,()=>{
  const event=closure(path,from,to),base=defaultDemands();
  let entries=prepare(event).map(e=>({...e,enabled:false}));
  const initial=demandAtClock(base,new Date(2026,9,24,15,46));
  let cells=Object.fromEntries(Object.keys(routes).filter(p=>!p.startsWith('ramp-'))
   .map(p=>[p,initialiseCells(routes[p],initial[p])]));
  for(let minute=0;minute<36;minute++){
   const demands=demandAtClock(base,new Date(2026,9,24,15,46+minute));
   const next=advanceRoutedNetwork(cells,routes,[event],demands,exits,entries);
   cells=next.cells;entries=next.detours;
   assert.equal(cells[path].junctions.find(j=>j.ref===from).lastEntered,0);
   assertCellConservation(cells[path]);
   if(minute===27||minute===35){
    const view=trafficView([],{[path]:cells[path]},routes,[event],[],minute+1);
    assert.equal(view.delays[path].blocked,false,'28/36 minute approach must be traversable to the exit');
    assert.ok(view.jams.filter(j=>j.pathKey===path).every(j=>!j.delay.blocked));
   }
  }
  const main=entries.find(e=>e.config.geometry.sourceExitRef===from);
  assert.equal(main.desiredPercent,100);assert.ok(main.state.admittedTotal>100);
  assert.ok(main.state.lastDeparture>0&&main.state.returnedTotal>0);
  const row=junctionMovements(path,routes[path],exits,[event],null,[],cells[path].junctions)
   .find(r=>r.exit.ref===from);
  assert.equal(row.normalInVph,0);assert.equal(row.entryClosed,true);
  assert.match(junctionMovementHint(row).flow,/Auffahrt 0\/h ⛔/);
  if(path==='A3-frankfurt'){
   const opposite=junctionMovements('A3-koeln',routes['A3-koeln'],exits,[event],null,[],cells['A3-koeln'].junctions)
    .find(r=>r.exit.ref==='42');
   assert.equal(Math.round(opposite.inVph),199,'the screenshot count belongs to the open Cologne direction');
   assert.equal(opposite.entryClosed,false);assert.match(junctionMovementHint(opposite).title,/Köln/);
  }
  const committed=grid=>grid.junctions.reduce((n,j)=>n+(j.exitQueue?.detours[main.config.id]??0),0);
  const admitted=main.state.admittedTotal+committed(cells[path]);
  const next=advanceRoutedNetwork(cells,routes,[],initial,exits,entries);
  assert.ok(Math.abs(next.detours.find(e=>e.config.id===main.config.id).state.admittedTotal+committed(next.cells[path])-admitted)<1e-6,
   'lifting the closure restores the pause while already committed off-ramp cars finish');
 });
}

test('an old paused route returning inside a longer closure cannot take its mandatory traffic',()=>{
 const path='A3-frankfurt',route=routes[path],short=closure(path,'40','41'),long=closure(path,'40','42');
 short.id='old-short';
 const old=prepare(short).find(e=>e.config.geometry.sourceExitRef==='40');
 let entries=[{...old,enabled:false},...prepare(long).map(e=>({...e,enabled:false}))];
 let state=initialiseCells(route,2000);
 for(let minute=0;minute<36;minute++){
  const next=advanceRoutedPath(state,route,[long],2000,exits,entries);state=next.cells;entries=next.detours;
 }
 assert.equal(entries[0].state.admittedTotal,0);
 const main=entries.find(e=>e.config.geometry.sourceExitRef==='40'&&e.config.geometry.targetExitRef==='42');
 assert.equal(main.desiredPercent,100);assert.ok(main.state.admittedTotal>100);
 assert.equal(speedDelayInCells(state).blocked,false);
 for(const ref of ['40','41'])assert.equal(state.junctions.find(j=>j.ref===ref).lastEntered,0);
});
