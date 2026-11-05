import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors} from '../dist/spatial.js';
import {initialiseCells} from '../dist/traffic-cells.js';
import {downstreamReceiving} from '../dist/network-receiving.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
test('downstream motorway merge receives backpressure from physically dense cells despite a stale fast speed sample',()=>{
 const route=routes['A3-frankfurt'],grid=initialiseCells(route,1000);
 const metre=Math.min(route.lengthM-2*grid.cellM,5000);
 const link={from:'A3-koeln',to:'A3-frankfurt',mergeM:metre};
 const clean=downstreamReceiving({'A3-frankfurt':grid},[link]);
 assert.equal(clean['A3-koeln'],undefined,'a clear receiving cell does not limit a feeder');
 const cell=grid.cells[Math.floor(metre/grid.cellM)];
 cell.densityVehKm=(cell.jamDensityVehKm??390)*.96;
 cell.speedKmh=100;
 const full=downstreamReceiving({'A3-frankfurt':grid},[link]);
 assert.ok(full['A3-koeln']>=0&&full['A3-koeln']<500,
  'occupied nearly-full target must restrict upstream supply despite transitional speed readings');
});
