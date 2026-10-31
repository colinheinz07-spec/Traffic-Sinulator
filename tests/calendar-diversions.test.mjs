import test from 'node:test';import assert from 'node:assert/strict';
import {localRoadAvailability,announcedClosureDemands} from '../dist/calendar-traffic.js';
import {defaultDemands} from '../dist/traffic.js';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {diversionJunctions} from '../dist/diversions.js';
import {normalJunctionTraffic} from '../dist/junction-traffic.js';
import {initialiseCells,cellInventory} from '../dist/traffic-cells.js';
import {advanceRoutedNetwork} from '../dist/routed-traffic.js';
import {emptyDetour,detourVehicles} from '../dist/detour-flow.js';
const routes=makeCorridors(networkData.roads,networkData.ramps),exits=networkData.exits;
const monday=new Date(2026,9,26,17),saturday=new Date(2026,9,31,22,48);
test('weekend/night reserves less background traffic; default calibration is retained',()=>{
 assert.equal(localRoadAvailability(),1);assert.equal(localRoadAvailability(monday),1);
 assert.equal(localRoadAvailability(saturday),1.4);
 const week=normalJunctionTraffic(routes['A3-frankfurt'],exits,3000,monday);
 const end=normalJunctionTraffic(routes['A3-frankfurt'],exits,3000,saturday);
 assert.ok(end.every((j,i)=>j.exitTerminalVph>week[i].exitTerminalVph&&j.exitTerminalVph<=j.exitCapacityVph));
 assert.equal(end[0].exitCapacityVph,week[0].exitCapacityVph);
});
test('announced closure affects only new offers in its direction and ends with the schedule',()=>{
 const at=new Date(2026,9,31,20),end=new Date(2026,10,1,2),base=defaultDemands();
 const event={id:'announced',kind:'closure',pathKey:'A3-frankfurt',point:[50.5,7.7],laneCount:3,closedLanes:[0,1,2],createdAt:at.toISOString(),settings:{lengthM:100,speedKmh:0,shoulder:'blocked'},schedule:{startAt:at.toISOString(),endAt:end.toISOString(),phases:[]}};
 assert.deepEqual(announcedClosureDemands(base,[event],new Date(at.getTime()-7200000)),base);
 const during=announcedClosureDemands(base,[event],at),before=announcedClosureDemands(base,[event],new Date(at.getTime()-1800000));
 assert.ok(before['A3-frankfurt']<base['A3-frankfurt']&&before['A3-frankfurt']>during['A3-frankfurt']);
 assert.equal(during['A3-frankfurt'],base['A3-frankfurt']*.8);
 assert.equal(during['A3-koeln'],base['A3-koeln']);assert.equal(during['ramp-a3-to-a48-from-koeln'],base['ramp-a3-to-a48-from-koeln']*.8);
 assert.deepEqual(announcedClosureDemands(base,[event],end),base);
 const {schedule,...unannounced}=event;assert.deepEqual(announcedClosureDemands(base,[unannounced],at),base);
});
test('Ransbach mandatory exit has real positive weekend discharge, greater than weekday, with conserved vehicles',()=>{
 const path='A3-frankfurt',route=routes[path],js=diversionJunctions(path,exits,route);
 const from=js.find(j=>j.ref==='38'),to=js.find(j=>j.ref==='40'),at=from.metre+350;
 const event={id:'weekend-exit',kind:'closure',pathKey:path,point:routeSlice(route,at,at+1)[0],laneCount:3,closedLanes:[0,1,2],createdAt:saturday.toISOString(),settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}};
 const config={id:event.id,path,fromM:from.metre,toM:to.metre,eventId:event.id,geometry:{id:event.id,path,sourceExitRef:'38',targetExitRef:'40',points:[from.position,to.position],lengthKm:20,freeMinutes:15,roadCapacityVph:850,storageVehicles:1800,junctionCount:5,trafficLightCount:2,source:'simulated-bundled',relationId:null,label:'Calendar test'}};
 function run(moment){let cells={[path]:initialiseCells(route,3000)},entries=[{config,state:emptyDetour(config)}],sum=0;const initial=cellInventory(cells[path]),demands={...defaultDemands(),[path]:3000};
  for(let i=0;i<674;i++){const next=advanceRoutedNetwork(cells,routes,[event],demands,exits,entries,{},moment);cells=next.cells;entries=next.detours;
   const j=cells[path].junctions.find(j=>j.ref==='38');const flow=j.lastExited+entries[0].state.lastDeparture;
   if(i>2){assert.ok(flow>0,'open off-ramp must keep discharging while side road has room');sum+=flow;}
   assert.equal(j.lastEntered,0);
   assert.ok(Math.abs(cellInventory(cells[path])+detourVehicles(entries[0].state)+cells[path].exitedTotal-initial-cells[path].offeredTotal)<1e-5);
  }return sum;
 }
 assert.ok(run(saturday)>run(monday)*1.15);
});
