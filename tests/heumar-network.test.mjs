import test from 'node:test';import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';import {extensionRoutes,extensionJunctions} from '../dist/network-extensions.js';
import {makeCorridors,routeSlice,closureGate} from '../dist/spatial.js';
import {initialiseCells,advanceCells,cellInventory,assertCellConservation} from '../dist/traffic-cells.js';
import {mainlineMerges,downstreamReceiving} from '../dist/network-receiving.js';
import {planExtensionDetours,refreshExtensionDetour} from '../dist/extension-detours.js';
import {emptyDetour,detourVehicles} from '../dist/detour-flow.js';import {advanceRoutedNetwork} from '../dist/routed-traffic.js';import {defaultDemands} from '../dist/traffic.js';
import {visibleRanges,physicalOwnerAt,canonicalPhysicalEvent} from '../dist/physical-paths.js';
const routes=makeCorridors(networkData.roads,networkData.ramps),exits=[...networkData.exits,...extensionJunctions];
const incident=(key,at,kind='accident')=>({id:'incident',pathKey:key,kind,point:routeSlice(routes[key],at,at+1)[0],laneCount:4,closedLanes:[0,1,2,3],settings:{lengthM:100,speedKmh:0,shoulder:'blocked'},createdAt:'2026-11-01T08:00:00Z'});
test('all-lane A3 accident sends a finite receiving limit back onto A59 and releases it after reopening',()=>{
 const merges=mainlineMerges(routes),link=merges.find(l=>l.from==='extra-a59-koeln'&&l.to==='A3-koeln');assert.ok(link);
 let cells=Object.fromEntries([link.from,link.to].map(k=>[k,initialiseCells(routes[k],3000)]));const event=incident(link.to,link.mergeM+500);
 assert.deepEqual(downstreamReceiving(cells,[link]),{});let blocked=0;
 for(let t=0;t<45;t++){const limits=downstreamReceiving(cells,[link]);if((limits[link.from]??Infinity)<100)blocked++;
  cells=Object.fromEntries(Object.entries(cells).map(([k,g])=>[k,advanceCells(g,routes[k],[event],3000,exits,[],undefined,limits[k]??Infinity)]));for(const g of Object.values(cells))assertCellConservation(g);
 }
 assert.ok(blocked>15);assert.ok(cells[link.from].cells.at(-1).speedKmh<10);const before=cellInventory(cells[link.from]);
 for(let t=0;t<65;t++){const limits=downstreamReceiving(cells,[link]);cells=Object.fromEntries(Object.entries(cells).map(([k,g])=>[k,advanceCells(g,routes[k],[],500,exits,[],undefined,limits[k]??Infinity)]));}
 assert.ok(cellInventory(cells[link.from])<before);assert.ok(cells[link.from].cells.at(-1).speedKmh>65);
});
for(const key of ['extra-a59-koeln','extra-a59-bonn'])test(key+': Porz–Heumar closure moves cars through A559/A4 and rejoins beyond the closed arm',()=>{
 const at=key.endsWith('koeln')?routes[key].lengthM-2800:2800,event=incident(key,at,'closure');
 let cells=Object.fromEntries([key,'A3-koeln'].map(k=>[k,initialiseCells(routes[k],2600)]));
 const plans=planExtensionDetours([event],routes,exits,cells,[]).filter(c=>c.motorwayBypass);assert.equal(plans.length,1);
 const gate=closureGate(routes[key],event,exits,[event]),config=plans[0];assert.ok(config.fromM<=gate.metre+1);assert.ok((config.sourceEndM??config.toM)>=gate.endM-1);
 let detours=plans.map(config=>({config,state:emptyDetour(config),enabled:true}));const initial=Object.values(cells).reduce((n,g)=>n+cellInventory(g),0);
 for(let t=0;t<35;t++){const next=advanceRoutedNetwork(cells,routes,[event],defaultDemands(),exits,detours);cells=next.cells;detours=next.detours;}
 assert.ok(detours[0].state.admittedTotal>300);assert.ok(detours[0].state.returnedTotal>100);assert.equal(detours[0].desiredPercent,100);
 const total=Object.values(cells).reduce((n,g)=>n+cellInventory(g)+g.exitedTotal-g.offeredTotal,0)+detours.reduce((n,d)=>n+detourVehicles(d.state),0);assert.ok(Math.abs(total-initial)<1e-4);
 const leg=key.endsWith('koeln')?'extra-a4-olpe':'extra-a4-aachen';const oldHeumarMid=leg.endsWith('aachen')?1800:routes[leg].lengthM-1800;const blocked=incident(leg,oldHeumarMid);
 assert.equal(refreshExtensionDetour(config,routes,[event,blocked],exits,cells).geometry.roadCapacityVph,0);
});
test('legacy Heumar aliases cannot draw independent queue stripes on physical mainlines and saved closures migrate',()=>{
 let count=0;for(const r of extensionRoutes.filter(r=>r.kind==='ramp')){
  const p=r.points[Math.floor(r.points.length/2)],owner=physicalOwnerAt(r.id,p);if(!owner)continue;count++;
  const e=canonicalPhysicalEvent({...incident('A3-koeln',100),pathKey:r.id,point:p,laneCount:r.lanes,closedLanes:Array.from({length:r.lanes},(_,i)=>i)});
  assert.equal(e.pathKey,owner.key);assert.equal(e.closedLanes.length,owner.lanes);
  for(const range of visibleRanges(r.id,r.points))for(let i=1;i<range.points.length;i++){
   const a=range.points[i-1],b=range.points[i],mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];assert.equal(physicalOwnerAt(r.id,mid),null);
  }
 }assert.ok(count>=1);
});
