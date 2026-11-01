import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {extensionJunctions} from '../dist/network-extensions.js';
import {makeCorridors} from '../dist/spatial.js';
import {initialiseCells,advanceCells,assertCellConservation} from '../dist/traffic-cells.js';
import {normalJunctionTraffic} from '../dist/junction-traffic.js';
import {junctionRampBindings,junctionRampJams,applyJunctionRampLimits} from '../dist/junction-ramp-bindings.js';
import {junctionAccess} from '../dist/road-controls.js';
const routes=makeCorridors(networkData.roads,networkData.ramps),exits=[...networkData.exits,...extensionJunctions];
function state(path,ref){
 const base=initialiseCells(routes[path],1200),demand=normalJunctionTraffic(routes[path],exits,1200).find(j=>j.ref===ref);
 assert.ok(demand,path+':'+ref);
 return {...base,junctions:[{...demand,waiting:0,offeredTotal:0,enteredTotal:0,exitedTotal:0,lastEntered:0,lastExited:0,exitQueue:{normal:0,detours:{}}}]};
}
test('local ramp bindings include Montabaur merges and both sides of the Bonn interchanges',()=>{
 for(const [path,ref,kind] of [['A3-koeln','40','entry'],['A3-koeln','40','exit'],['extra-a59-bonn','41','exit'],['extra-a59-koeln','41','entry'],['extra-a562-bonn','3','entry'],['extra-a562-bonn','4','entry'],['extra-a562-bonn-ost','4','exit']]){
  const bindings=junctionRampBindings(routes[path],exits).filter(b=>b.ref===ref&&b.kind===kind);
  assert.ok(bindings.length,path+':'+ref+':'+kind);
  assert.ok(Math.abs(bindings.reduce((n,b)=>n+b.share,0)-1)<1e-9);
 }
});
test('a distant all-lane motorway accident cannot paint an empty entry or exit ramp',()=>{
 const path='extra-a59-bonn',grid=state(path,'41');
 const event={id:'far-away',pathKey:path,kind:'accident',point:routes[path].points.at(-5),laneCount:3,closedLanes:[0,1,2],createdAt:'2026-11-01T12:00:00Z',settings:{lengthM:50,speedKmh:0,shoulder:'blocked'}};
 const before=JSON.stringify(grid);
 assert.deepEqual(junctionRampJams({[path]:grid},routes,exits,[event]),[]);
 assert.equal(JSON.stringify(grid),before);
});
test('actual entry and exit inventories color only their own physical ramp and clear with that inventory',()=>{
 const path='A3-koeln',grid=state(path,'40');grid.junctions[0].waiting=20;grid.junctions[0].offeredTotal=20;
 const bound=new Set(junctionRampBindings(routes[path],exits).filter(b=>b.ref==='40'&&b.kind==='entry').flatMap(b=>b.segments.map(s=>s.ramp.id)));
 const before=JSON.stringify(grid),jams=junctionRampJams({[path]:grid},routes,exits,[]);
 assert.ok(jams.length);assert.ok(jams.every(j=>bound.has(j.pathKey)&&j.queueVehicles>0&&j.speedKmh===0));
 assert.ok(jams.reduce((n,j)=>n+j.queueVehicles,0)<=20.000001);assert.equal(JSON.stringify(grid),before);
 grid.junctions[0].waiting=0;grid.junctions[0].exitQueue={normal:18,detours:{bypass:6}};
 const off=new Set(junctionRampBindings(routes[path],exits).filter(b=>b.ref==='40'&&b.kind==='exit').flatMap(b=>b.segments.map(s=>s.ramp.id)));
 const exitJams=junctionRampJams({[path]:grid},routes,exits,[]);assert.ok(exitJams.length);assert.ok(exitJams.every(j=>off.has(j.pathKey)));
 grid.junctions[0].exitQueue={normal:0,detours:{}};assert.deepEqual(junctionRampJams({[path]:grid},routes,exits,[]),[]);
});
test('a physical ramp accident limits its own junction service while a formal closure prevents fresh entry',()=>{
 const path='extra-a59-koeln',route=routes[path],bindings=junctionRampBindings(route,exits).filter(b=>b.ref==='41'&&b.kind==='entry');
 assert.ok(bindings.length);const ramps=[...new Map(bindings.map(b=>[b.segments.at(-1).ramp.id,b.segments.at(-1).ramp])).values()];
 const make=kind=>ramps.map(ramp=>({id:'entry-block-'+ramp.id,pathKey:ramp.id,kind,point:ramp.points.at(-2),laneCount:ramp.lanes,closedLanes:Array.from({length:ramp.lanes},(_,i)=>i),createdAt:'2026-11-01T12:00:00Z',settings:{lengthM:50,speedKmh:0,shoulder:'blocked'}}));
 const ordinary=normalJunctionTraffic(route,exits,1200),controlled=applyJunctionRampLimits(route,exits,make('accident'),ordinary).find(j=>j.ref==='41');
 assert.ok(controlled.entryCapacityVph<ordinary.find(j=>j.ref==='41').entryCapacityVph);
 const closed=make('closure');assert.equal(junctionAccess(route,closed,controlled.metre,'41').entry,false);
 let cells=initialiseCells(route,1200);
 for(let i=0;i<3;i++)cells=advanceCells(cells,route,make('accident'),1200,exits,[],normalJunctionTraffic(route,exits,1200,undefined,false,make('accident')));
 assertCellConservation(cells);assert.ok(cells.junctions.find(j=>j.ref==='41').waiting>0);
});
