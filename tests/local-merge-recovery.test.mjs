import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice,emptySpatial,advanceSpatial,jamsAt,mergeSupplyVph} from '../dist/spatial.js';
import {initialiseCells,advanceCells,assertCellConservation} from '../dist/traffic-cells.js';
import {trafficView} from '../dist/traffic-view.js';
import {buildRampConnections,rampSpillbacks} from '../dist/interchange.js';
import {defaultDemands,eventCapacity,baselineCapacity} from '../dist/traffic.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
const links=buildRampConnections(networkData.ramps,routes);
function incident(path,at,id,closed,speed){
 return {id,pathKey:path,kind:'accident',laneCount:3,closedLanes:closed,
  point:routeSlice(routes[path],at,at+1)[0],createdAt:'2026-10-28T19:06:00Z',
  settings:{lengthM:100,speedKmh:speed,shoulder:'normal'}};
}
function physical(grid,spatial,events){
 const raw=jamsAt(spatial,events,routes);
 return trafficView(raw,{[grid.pathKey]:grid},routes,events,rampSpillbacks(raw,links,routes),grid.minute)
  .physicalJams.filter(j=>j.pathKey===grid.pathKey);
}

for(const path of ['A3-koeln','A3-frankfurt'])for(const open of [1,2,3])
 test(`${path}: ${open} reopened lanes serve their own ramp while a separate upstream accident stays blocked`,()=>{
  const route=routes[path],link=links.find(l=>l.to===path),demand=1800;
  const blocked=incident(path,link.downstreamMergeM+1500,'merge-accident',[0,1,2],0);
  const remote=incident(path,link.downstreamMergeM-10000,'separate-upstream',[0,1,2],0);
  const reopened=open===3?null:{...blocked,closedLanes:Array.from({length:3-open},(_,i)=>i),
   settings:{...blocked.settings,speedKmh:open===2?60:40}};
  const events=[remote,...(reopened?[reopened]:[])],demands={...defaultDemands(),[path]:demand,[link.rampId]:800};
  let grid=initialiseCells(route,demand),spatial=emptySpatial();
  for(let i=0;i<45;i++){
   grid=advanceCells(grid,route,[blocked],demand,[],[],[]);
   spatial=advanceSpatial(spatial,[blocked],demands,1,routes,links,[],[],physical(grid,spatial,[blocked]));
  }
  const before=Object.values(spatial.queues).filter(q=>q.pathKey===link.rampId).reduce((n,q)=>n+q.vehicles,0);
  assert.ok(before>250,'exercise an existing ramp queue');
  let previous=before,observations=0;
  for(let i=0;i<20;i++){
   grid=advanceCells(grid,route,events,demand,[],[],[]);assertCellConservation(grid);
   assert.equal(grid.capacityVph,0,'the unrelated upstream accident remains fully blocked');
   const jams=physical(grid,spatial,events);
   assert.ok(jams.some(j=>j.anchorM<link.downstreamMergeM&&j.capacityVph===0),
    'the other accident keeps its own real blockage');
   const local=jams.filter(j=>j.anchorM>link.downstreamMergeM&&j.anchorM-j.queueM<link.downstreamMergeM);
   for(const jam of local){
    observations++;
    assert.equal(jam.capacityVph,reopened?eventCapacity(reopened,demand):baselineCapacity(path),
     'a clearing merge queue cannot inherit the remote zero-capacity control');
   }
   spatial=advanceSpatial(spatial,events,demands,1,routes,links,[],[],jams);
   const stock=Object.values(spatial.queues).filter(q=>q.pathKey===link.rampId).reduce((n,q)=>n+q.vehicles,0);
   if(open>=2)assert.ok(stock<previous-1,'spare local service must drain the retained ramp vehicles');
   previous=stock;
  }
  assert.ok(observations>2,'exercise backpressure at the actual OSM merge');
  if(open>=2)assert.ok(previous<before-50);
 });

test('waiting ramp vehicles can request spare service without changing arrivals or ramp capacity',()=>{
 const ramp='ramp-a48-to-frankfurt';
 assert.equal(mergeSupplyVph(ramp,3200,2800,1400),1400);
 assert.equal(mergeSupplyVph(ramp,3200,2800,1400,100),1500);
 assert.equal(mergeSupplyVph(ramp,0,2800,1400,100),0);
 assert.ok(mergeSupplyVph(ramp,1500,4200,1400,100)<600,'retain genuine downstream congestion');
 assert.ok(mergeSupplyVph(ramp,3200,2800,8000,100)<=1500,'no additional ramp lane is invented');
 assert.throws(()=>mergeSupplyVph(ramp,3200,2800,1400,-1));
});

for(const path of ['A3-koeln','A3-frankfurt'])
 test(`${path}: a retained ramp queue drains while the underloaded two-lane motorway queue is still clearing`,()=>{
  const route=routes[path],link=links.find(l=>l.to===path),demand=2800;
  const blocked=incident(path,link.downstreamMergeM+1500,'two-lane-recovery',[0,1,2],0);
  const reopened={...blocked,closedLanes:[0],settings:{...blocked.settings,speedKmh:60}};
  const demands={...defaultDemands(),[path]:demand};
  let grid=initialiseCells(route,demand),spatial=emptySpatial();
  for(let i=0;i<45;i++){
   grid=advanceCells(grid,route,[blocked],demand,[],[],[]);
   spatial=advanceSpatial(spatial,[blocked],demands,1,routes,links,[],[],physical(grid,spatial,[blocked]));
  }
  let previous=spatial.queues['merge:'+link.rampId].vehicles;
  const before=previous;let overlaps=0;
  for(let i=0;i<20;i++){
   grid=advanceCells(grid,route,[reopened],demand,[],[],[]);assertCellConservation(grid);
   const jams=physical(grid,spatial,[reopened]);
   if(jams.some(j=>j.anchorM>link.downstreamMergeM&&j.anchorM-j.queueM<link.downstreamMergeM))overlaps++;
   spatial=advanceSpatial(spatial,[reopened],demands,1,routes,links,[],[],jams);
   const queue=spatial.queues['merge:'+link.rampId];
   assert.ok(queue&&queue.capacityVph>demands[link.rampId],
    'fresh arrivals cannot consume every available service slot while old cars wait');
   assert.ok(queue.vehicles<previous-1,'the retained ramp queue must actually lose cars');
   assert.ok(queue.capacityVph<=baselineCapacity(link.rampId));previous=queue.vehicles;
  }
  assert.ok(overlaps>15,'the test must not simply wait for the whole motorway to become green');
  assert.ok(previous<before-25);
 });

for(const path of ['A3-koeln','A3-frankfurt'])
 test(`${path}: a connected downstream block still stops its ramp despite two lanes open before it`,()=>{
  const route=routes[path],link=links.find(l=>l.to===path),demand=2800;
  const open=incident(path,link.downstreamMergeM+200,'open-upstream',[0],60);
  const block=incident(path,link.downstreamMergeM+1000,'connected-downstream',[0,1,2],0);
  const events=[open,block],demands={...defaultDemands(),[path]:demand};
  let grid=initialiseCells(route,demand),spatial=emptySpatial(),observed=0;
  for(let i=0;i<40;i++){
   grid=advanceCells(grid,route,events,demand,[],[],[]);assertCellConservation(grid);
   const jams=physical(grid,spatial,events);
   const crossing=jams.filter(j=>j.anchorM>link.downstreamMergeM&&j.anchorM-j.queueM<link.downstreamMergeM);
   for(const jam of crossing){observed++;assert.equal(jam.capacityVph,0);}
   spatial=advanceSpatial(spatial,events,demands,1,routes,links,[],[],jams);
   if(crossing.length)assert.equal(spatial.queues['merge:'+link.rampId].capacityVph,0);
  }
  assert.ok(observed>20,'the genuinely connected queue reaches the OSM merge');
 });
