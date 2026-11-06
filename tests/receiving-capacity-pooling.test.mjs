import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,mergeSupplyVph} from '../dist/spatial.js';
import {initialiseCells} from '../dist/traffic-cells.js';
import {rampReceiving} from '../dist/network-receiving.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
test('two junction ramps share a single congested motorway receiving cell',()=>{
 const target='A3-frankfurt',state=initialiseCells(routes[target],1300);
 const metre=1500,cell=state.cells[Math.floor(metre/state.cellM)];
 const storage=cell.jamDensityVehKm??390;
 cell.densityVehKm=storage-10;cell.speedKmh=0;
 const links=[
  {rampId:'ramp-a48-to-koeln',to:target,downstreamMergeM:metre},
  {rampId:'ramp-a48-to-frankfurt',to:target,downstreamMergeM:metre}
 ];
 const before=JSON.stringify(state),two=rampReceiving({[target]:state},links);
 const alone=rampReceiving({[target]:state},links.slice(0,1));
 const total=Object.values(two).reduce((n,v)=>n+v,0);
 assert.ok(Object.values(two).every(v=>v>0));
 assert.ok(total<=220+1e-6,'one CTM cell has one receiving budget');
 assert.ok(two[links[0].rampId]<alone[links[0].rampId]);
 assert.deepEqual(rampReceiving({[target]:state},[...links,links[0]]),two,
  'the same ramp listed twice must not receive a second budget');
 assert.equal(JSON.stringify(state),before,'receiving is read-only');
});
test('a free target produces no fictitious ramp queue; a closed target has no receiving room',()=>{
 const target='A3-frankfurt',state=initialiseCells(routes[target],800);
 const entry={rampId:'ramp-a48-to-frankfurt',to:target,downstreamMergeM:1000};
 assert.deepEqual(rampReceiving({[target]:state},[entry]),{});
 state.closures=[{face:10,fromM:1000,toM:1100,exitRef:null,eventId:'closed',diverting:false}];
 assert.equal(rampReceiving({[target]:state},[entry])[entry.rampId],0);
});
test('ramp discharge never exceeds measured receiving budget even at low mainline demand',()=>{
 const id='ramp-a48-to-frankfurt';
 assert.ok(mergeSupplyVph(id,300,100,1400,150)<=300);
 assert.equal(mergeSupplyVph(id,0,100,1400,150),0);
 assert.equal(mergeSupplyVph(id,3200,2800,1400),1400,
  'uncongested receiving keeps the previous ramp behavior');
});

test('a stopped ramp cannot consume another ramp merge slot without cars',()=>{
 const target='A3-frankfurt',grid=initialiseCells(routes[target],1000);
 const metre=1000,cell=grid.cells[Math.floor(metre/grid.cellM)];
 cell.densityVehKm=(cell.jamDensityVehKm??390)-10;cell.speedKmh=0;
 const idle='ramp-a48-to-koeln',active='ramp-a48-to-frankfurt';
 const connections=[
  {rampId:idle,to:target,downstreamMergeM:metre},
  {rampId:active,to:target,downstreamMergeM:metre}
 ];
 const noQueue=rampReceiving({[target]:grid},connections,{[idle]:0,[active]:1400});
 assert.equal(noQueue[idle],0);
 assert.ok(noQueue[active]>200);
 const retained=rampReceiving({[target]:grid},connections,{[idle]:0,[active]:1400},{[idle]:12});
 assert.ok(retained[idle]>0,'previously queued vehicles still discharge');
 assert.ok(retained[active]>0);
 assert.ok(retained[idle]+retained[active]<=220+1e-6);
});
