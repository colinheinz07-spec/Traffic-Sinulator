import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors} from '../dist/spatial.js';
import {trafficView} from '../dist/traffic-view.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
test('a stocked interchange ramp never has artificial green holes from old speed history',()=>{
 const path='ramp-a48-to-frankfurt',route=routes[path];
 const visibleQueueM=route.lengthM*.9,anchorM=route.lengthM;
 assert.ok(visibleQueueM>50);
 const jam={id:'occupied-ramp',pathKey:path,eventKind:null,
  point:route.points.at(-1),anchorM,queueVehicles:60,
  queueM:visibleQueueM,visibleQueueM,delayMin:20,capacityVph:300,
  speedKmh:5,color:'standstill',released:false,outOfBoundsM:0,
  speedHistory:[{minute:0,speedKmh:120},{minute:58,speedKmh:120},{minute:60,speedKmh:5}]};
 const view=trafficView([jam],{},routes,[],[],60),bands=view.bands.get(path).filter(b=>b.source==='queue');
 assert.ok(bands.length);
 assert.ok(bands.every(b=>b.color==='standstill'));
 assert.ok(bands[0].fromM<=anchorM-visibleQueueM+.1);
 assert.ok(bands.at(-1).toM>=anchorM-.1);
 assert.ok(bands.reduce((n,b)=>n+b.toM-b.fromM,0)>=visibleQueueM-.1,
  'every metre occupied by the queue remains colored as the same congested stock');
});
