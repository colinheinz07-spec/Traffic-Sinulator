import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';import {extensionRoutes} from '../dist/network-extensions.js';import {makeCorridors,positionM,routeSlice,closureGate} from '../dist/spatial.js';import {diversionJunctions} from '../dist/diversions.js';import {bundledExitRoutes} from '../dist/bundled-detours.js';import {validEvent} from '../dist/events.js';import {advanceRoutedPath} from '../dist/routed-traffic.js';import {initialiseCells,assertCellConservation} from '../dist/traffic-cells.js';import {emptyDetour} from '../dist/detour-flow.js';
const routes=makeCorridors(networkData.roads,networkData.ramps);
const edge=new Set();for(const f of ['a3-heumar-camberg-osm.json','a3-wiesbaden-osm.json'])for(const w of JSON.parse(readFileSync('data/'+f)).elements.filter(w=>w.type==='way')){const ps=w.geometry?.map(p=>[p.lat,p.lon].map(v=>+v.toFixed(7)).join(','))??[];for(let i=1;i<ps.length;i++){edge.add(ps[i-1]+'>'+ps[i]);edge.add(ps[i]+'>'+ps[i-1]);}}
for(const path of ['A3-koeln','A3-frankfurt'])test(path+': exact south extension includes AS45, AS46 and AK47 plus coloured ramps and usable local bypasses',()=>{
 const route=routes[path];assert.ok(route.points.some(p=>p[0]<50.05));
 for(const ref of ['45','46','47']){const exit=networkData.exits.find(e=>e.road==='A3'&&e.ref===ref),point=exit.directional[path].position;assert.notEqual(positionM(route,point,.1),null);if(ref!=='47')assert.ok(extensionRoutes.some(r=>r.kind==='ramp'&&r.points.some(p=>p.join(',')===point.join(','))));}
 for(let i=1;i<route.points.length;i++)if(route.points[i][0]<50.29)assert.ok(edge.has(route.points[i-1].join(',')+'>'+route.points[i].join(',')),'fabricated connecting edge');
 const js=diversionJunctions(path,networkData.exits,route),a=js.find(j=>j.ref==='45'),b=js.find(j=>j.ref==='46'),at=(a.metre+b.metre)/2;
 const event={id:'south-closure',pathKey:path,kind:'closure',point:routeSlice(route,at,at+1)[0],laneCount:3,closedLanes:[0,1,2],createdAt:'2026-11-01T13:00:00Z',settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}};assert.ok(validEvent(event));
 const gate=closureGate(route,event,networkData.exits),option=bundledExitRoutes(path,networkData.exits,route).find(c=>c.from.ref===gate.exit.ref&&c.to.metre>=gate.endM-1);assert.ok(option);
 const config={id:option.geometry.id,path,fromM:option.from.metre,toM:option.to.metre,eventId:event.id,geometry:option.geometry};let detours=[{config,state:emptyDetour(config)}],cells=initialiseCells(route,1800);
 for(let t=0;t<45;t++){const next=advanceRoutedPath(cells,route,[event],1800,networkData.exits,detours);cells=next.cells;detours=next.detours;assertCellConservation(cells);}
 assert.ok(detours[0].state.admittedTotal>100);assert.ok(detours[0].state.returnedTotal>0);
});
