import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors} from '../dist/spatial.js';
import {ROUTE_CATALOG} from '../dist/network-catalog.js';
import {cellLanes,initialiseCells,advanceCells,assertCellConservation} from '../dist/traffic-cells.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
test('all existing motorway and ramp CTM lane counts come from route data',()=>{
 for(const {key,lanes} of ROUTE_CATALOG)assert.equal(cellLanes(key),lanes,key);
});
test('a real one-lane restriction reduces initial cell density even with constant demands',()=>{
 const original=routes['A3-koeln'];
 const route={...original,normalLanes:[
  {fromM:0,toM:400,lanes:1},{fromM:400,toM:original.lengthM,lanes:3}
 ]};
 const state=initialiseCells(route,4500);
 assert.ok(state.cells[1].densityVehKm<state.cells[8].densityVehKm,
  'initial state must honor local lane counts in manual and clock modes');
 assert.ok(state.cells[1].vehicles<state.cells[8].vehicles);
 const next=advanceCells(state,route,[],1800);
 assertCellConservation(next);
});
