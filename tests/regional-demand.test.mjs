import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultDemands,demandAtClock,demandAtMinute} from '../dist/traffic.js';
import {profileFamily,profileFactor} from '../dist/traffic-profiles.js';
import {regionalFlowAt,regionalBoundaryFlow} from '../dist/regional-traffic.js';
import {networkData} from '../dist/geodata.js';
import {extensionRoutes,extensionJunctions} from '../dist/network-extensions.js';
import {makeCorridors,positionM,routeSlice} from '../dist/spatial.js';
import {normalJunctionTraffic} from '../dist/junction-traffic.js';
import {initialiseCells,cellInventory,assertCellConservation} from '../dist/traffic-cells.js';
import {advanceRoutedNetwork} from '../dist/routed-traffic.js';
const base=defaultDemands(),routes=makeCorridors(networkData.roads,networkData.ramps),exits=[...networkData.exits,...extensionJunctions];
const keys=['A3-koeln','A3-frankfurt','A48-dernbach','A48-koblenz',...extensionRoutes.filter(r=>r.kind==='motorway').map(r=>r.id)];
const date=(h,m=0,day=2)=>new Date(2026,10,day,h,m);
const ref=(key,when)=>base[key]*profileFactor(key,when);
function initial(when){const d=demandAtClock(base,when);return Object.fromEntries(keys.map(key=>[key,initialiseCells(routes[key],d[key],metre=>regionalFlowAt(routes[key],exits,d[key],metre,when))]));}
test('six motorway families have different weekday shapes, references and a morning maximum between 7 and 8',()=>{
 const sample=['A3-koeln','A48-dernbach','extra-a59-koeln','extra-a4-olpe','extra-a559-gremberg','extra-a560-bonn'];
 assert.equal(new Set(sample.map(profileFamily)).size,6);
 assert.equal(new Set(sample.map(key=>[5,6,7.5,10,17].map(h=>profileFactor(key,date(Math.floor(h),(h%1)*60)).toFixed(4)).join(','))).size,6);
 assert.ok(base['extra-a59-koeln']>base['A48-dernbach']);
 for(const key of sample){
  const peak=Array.from({length:13},(_,i)=>({minute:360+i*15,value:ref(key,date(0,360+i*15))})).sort((a,b)=>b.value-a.value)[0];
  assert.ok(peak.minute>=420&&peak.minute<=480,key+' '+peak.minute);assert.ok(ref(key,date(6))>ref(key,date(5))&&ref(key,date(5))>ref(key,date(4)),key);
  for(let m=241;m<600;m++)assert.ok(Math.abs(ref(key,date(0,m))-ref(key,date(0,m-1)))<base[key]*.025,key+' minute '+m);
 }
});
test('weekends have no weekday morning rush and no Friday/Saturday midnight demand jump',()=>{
 for(const key of keys){assert.ok(ref(key,date(7,30,7))<ref(key,date(7,30,2))*.65,key);
  assert.ok(Math.abs(ref(key,new Date(2026,10,6,23,59))-ref(key,new Date(2026,10,7,0,1)))<base[key]*.005,key+' midnight');}
 assert.deepEqual(demandAtMinute(base,77,'constant'),base,'constant test mode retains the chosen demand');
});
test('two-way daily counts stay at the separate regional and urban calibration scales',()=>{
 const totals={regional:0,ring:0,a48:0,a59:0};
 for(let day=2;day<9;day++)for(let m=0;m<1440;m+=5){const when=date(0,m,day);
  const north=ref('A3-koeln',when),south=ref('A3-frankfurt',when);totals.regional+=(north+south)/12;
  totals.ring+=(regionalFlowAt(routes['A3-koeln'],exits,north,routes['A3-koeln'].lengthM,when)+regionalBoundaryFlow(routes['A3-frankfurt'],exits,south,when))/12;
  totals.a48+=(ref('A48-dernbach',when)+ref('A48-koblenz',when))/12;
  totals.a59+=(ref('extra-a59-koeln',when)+ref('extra-a59-bonn',when))/12;}
 for(const k of Object.keys(totals))totals[k]/=7;
 assert.ok(totals.regional>80000&&totals.regional<100000);assert.ok(totals.ring>155000&&totals.ring<178000);
 assert.ok(totals.a48>40000&&totals.a48<50000);assert.ok(totals.a59>84000&&totals.a59<96000);
});
test('Köln load stays in Köln, bridge load stays west of Bendorf, and Heumar does not receive all Porz mainline traffic',()=>{
 const when=date(7,30),d=demandAtClock(base,when);
 assert.ok(regionalFlowAt(routes['A3-koeln'],exits,d['A3-koeln'],routes['A3-koeln'].lengthM,when)>d['A3-koeln']*1.4);
 assert.equal(regionalBoundaryFlow(routes['A3-koeln'],exits,d['A3-koeln'],when),d['A3-koeln']);
 assert.equal(regionalFlowAt(routes['A3-frankfurt'],exits,d['A3-frankfurt'],routes['A3-frankfurt'].lengthM,when),d['A3-frankfurt']);
 assert.ok(regionalBoundaryFlow(routes['A3-frankfurt'],exits,d['A3-frankfurt'],when)>d['A3-frankfurt']*1.4);
 assert.equal(regionalBoundaryFlow(routes['A48-dernbach'],exits,d['A48-dernbach'],when),d['A48-dernbach']*1.55);
 assert.equal(regionalFlowAt(routes['A48-dernbach'],exits,d['A48-dernbach'],routes['A48-dernbach'].lengthM,when),d['A48-dernbach']);
 assert.ok(regionalBoundaryFlow(routes['extra-a59-bonn'],exits,d['extra-a59-bonn'],when)<2000);
 assert.equal(regionalFlowAt(routes['extra-a59-bonn'],exits,d['extra-a59-bonn'],routes['extra-a59-bonn'].lengthM,when),d['extra-a59-bonn']);
});
test('regional exchanges share one physical AS face and a closure cannot attract a fresh regional entry queue',()=>{
 const when=date(7,30),d=demandAtClock(base,when);
 for(const key of keys){const list=normalJunctionTraffic(routes[key],exits,d[key],when,true),cellM=routes[key].lengthM/Math.ceil(routes[key].lengthM/100);
  assert.equal(new Set(list.map(j=>Math.round(j.metre/cellM))).size,list.length,key);}
 const key='extra-a59-bonn',porz=normalJunctionTraffic(routes[key],exits,d[key],when,true).find(j=>j.ref==='33');assert.ok(porz.entryVph>1000);
 const event={id:'porz-closed',pathKey:key,point:routeSlice(routes[key],porz.metre-50,porz.metre-49)[0],kind:'closure',laneCount:3,closedLanes:[0,1,2],createdAt:'2026-11-01T08:00:00Z',settings:{lengthM:1000,speedKmh:0,shoulder:'blocked'}};
 assert.equal(normalJunctionTraffic(routes[key],exits,d[key],when,true,[event]).find(j=>j.ref==='33').entryVph,0);
});
test('a rising regional morning and later release conserve every offered vehicle',()=>{
 let cells=initial(date(6,30));const before=Object.values(cells).reduce((n,g)=>n+cellInventory(g),0);
 for(let m=0;m<40;m++){
  const when=date(6,30+m),d=demandAtClock(base,when),next=advanceRoutedNetwork(cells,routes,[],d,exits,[],{},when,true);cells=next.cells;
  for(const grid of Object.values(cells))assertCellConservation(grid);
 }
 const after=Object.values(cells).reduce((n,g)=>n+cellInventory(g),0),offered=Object.values(cells).reduce((n,g)=>n+g.offeredTotal,0),left=Object.values(cells).reduce((n,g)=>n+g.exitedTotal,0);
 assert.ok(Math.abs(after-before-offered+left)<1e-5);
 const cityNode=cells['A3-koeln'].junctions.find(j=>j.id.includes(':regional:'));assert.ok(cityNode.enteredTotal>0);
 const exitNode=cells['A3-frankfurt'].junctions.find(j=>j.id.includes(':regional:'));assert.ok(exitNode.exitedTotal>0);
});
test('zero new demand keeps regional destination fractions for vehicles already present',()=>{
 const when=date(7,30),nodes=normalJunctionTraffic(routes['A3-frankfurt'],exits,0,when,true),city=nodes.find(j=>j.id.includes(':regional:'));
 assert.ok(city.exitPercent>0);assert.equal(city.entryVph,0);
});

test('weekday demand varies by day and the A48 weekend remains quieter than transit',()=>{
 const monday=new Date(2026,10,2,16),tuesday=new Date(2026,10,3,16),thursday=new Date(2026,10,5,16),friday=new Date(2026,10,6,16),sunday=new Date(2026,10,8,16);
 assert.ok(ref('A48-koblenz',tuesday)<ref('A48-koblenz',monday));
 assert.ok(ref('A48-koblenz',thursday)>ref('A48-koblenz',monday));
 assert.ok(ref('A48-koblenz',friday)<ref('A48-koblenz',monday));
 assert.ok(ref('A3-koeln',friday)>ref('A3-koeln',monday));
 assert.ok(ref('A48-koblenz',sunday)/base['A48-koblenz']<ref('A3-koeln',sunday)/base['A3-koeln']);
 const local=normalJunctionTraffic(routes['A3-koeln'],exits,2000);
 assert.ok(local.find(j=>j.ref==='40').entryVph>local.find(j=>j.ref==='37').entryVph*2);
});
