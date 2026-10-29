import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors} from '../dist/spatial.js';
import {baselineCapacity,defaultDemands} from '../dist/traffic.js';
import {initialiseCells,advanceCells,cellSpeedBands,assertCellConservation} from '../dist/traffic-cells.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
for(const [path,demand,capacity] of [
 ['A3-koeln',5700,6000],['A3-frankfurt',5700,6000],
 ['A48-dernbach',3800,4000],['A48-koblenz',3800,4000]
])test(`${path}: unrestricted traffic above the former base capacity flows without artificial congestion`,()=>{
 const route=routes[path],defaults=defaultDemands();let state=initialiseCells(route,demand);
 assert.equal(baselineCapacity(path),capacity);
 for(let minute=0;minute<60;minute++){
  state=advanceCells(state,route,[],demand);assertCellConservation(state);
  assert.equal(state.capacityVph,capacity);
  assert.ok(Math.abs(state.dischargeVph-demand)<1e-6,'the higher input must really pass the physical cells');
  assert.equal(cellSpeedBands(state).length,0,'no invented queue between the old and new capacity');
  assert.ok(state.backlog<1e-6);
 }
 assert.ok(Math.abs(state.offeredTotal-demand)<1e-6,'all sixty minutes of arrivals are retained');
 assert.ok(Math.abs(state.exitedTotal-demand)<1e-6,'no merely increased capacity label');
 assert.deepEqual(defaultDemands(),defaults,'capacity does not rewrite reference demand');
 for(const ramp of ['ramp-a48-to-koeln','ramp-a48-to-frankfurt','ramp-a3-to-a48-from-koeln','ramp-a3-to-a48-from-frankfurt'])
  assert.equal(baselineCapacity(ramp),1500,'motorway performance is not assigned to interchange connectors');
});
