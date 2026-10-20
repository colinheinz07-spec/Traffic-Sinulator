import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {defaultDemands,eventCapacity} from '../dist/traffic.js';
import {makeCorridors,routeSlice,positionM,advanceSpatial,emptySpatial,jamsAt,jamBands,mergeSupplyVph,queueCondition} from '../dist/spatial.js';
import {buildRampConnections} from '../dist/interchange.js';
import {routeReport} from '../dist/network-report.js';
import {eventFromHit} from '../dist/events.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
const links=buildRampConnections(networkData.ramps,routes);
const link=links.find(x=>x.rampId==='ramp-a48-to-koeln');
const demands=defaultDemands();

test('a dark-red motorway with positive downstream discharge cannot cause a fake merge closure',()=>{
 const capacity=mergeSupplyVph(link.rampId,3000,4200,700);
 assert.ok(capacity>0,'red or dark red is not synonymous with a closed merge');
 assert.ok(capacity>420,'no fixed 28% artificial capacity penalty');
 assert.equal(mergeSupplyVph(link.rampId,0,4200,700),0,'actual closed target stays blocked');
 assert.ok(mergeSupplyVph(link.rampId,3000,4200,0)>0,'stored ramp traffic can discharge when its arrivals fall');
 assert.ok(mergeSupplyVph(link.rampId,4200,4200,700)>capacity,'higher destination capacity allows more ramp flow');
});

test('near-Dernbach one-lane A3 construction gives ramp a physically related delay, not an independent 28% penalty',()=>{
 const target=routes[link.to],at=Math.min(target.lengthM-1000,link.downstreamMergeM+900);
 const point=routeSlice(target,at,at+3)[0];
 assert.ok(positionM(target,point)!==null);
 const hit={kind:'road',road:networkData.roads.find(r=>r.road===link.to),key:link.to,point,distance:0,fraction:.5};
 const event=eventFromHit(hit,'roadworks',3,[0],'work','2026-10-20T10:00:00Z',{lengthM:500,speedKmh:80,shoulder:'normal'});
 assert.ok(eventCapacity(event)>0);
 let state=emptySpatial();
 for(let i=0;i<80;i++)state=advanceSpatial(state,[event],demands,1,routes,links);
 const jams=jamsAt(state,[event],routes);
 const a3=routeReport('A3-koeln',jams,[],[event]);
 const ramp=routeReport(link.rampId,jams,[],[event]);
 assert.ok(a3.delayMin>5,'event must build a real mainline queue');
 assert.ok(ramp.delayMin!==null,'ramp must not be falsely declared fully closed');
 assert.ok(ramp.delayMin<=a3.delayMin*1.8+3,
  'ramp must not create a separate extreme delay while A3 has positive discharge: '+ramp.delayMin+' / '+a3.delayMin);
 assert.ok(jams.filter(j=>j.pathKey===link.rampId).every(j=>j.capacityVph>0));
});

test('one queue color until actual spatial speed differences are modelled',()=>{
 const make=color=>jamBands({anchorM:2200,queueM:1800,color});
 assert.deepEqual(make('slow').map(x=>x.color),['slow']);
 assert.deepEqual(make('jam').map(x=>x.color),['jam']);
 assert.deepEqual(make('standstill').map(x=>x.color),['standstill']);
 for(const color of ['slow','jam','standstill']){
  const bands=make(color);
  assert.equal(bands[0].fromM,400);
  assert.equal(bands.at(-1).toM,2200);
  assert.equal(bands.length,1);assert.ok(bands.every(x=>x.toM>x.fromM));
 }
 assert.equal(queueCondition(200,0,3,'A3-koeln').color,'standstill');
 assert.equal(queueCondition(400,1500,3,'A3-koeln').color,'standstill');
 assert.equal(queueCondition(25,5400,3,'A3-koeln').color,'free','high-capacity queued recovery speed can be free flow');
});

test('existing queues require two stable minutes to change display color',()=>{
 const p=routes['A3-koeln'].points[700];
 const initial={minute:5,queues:{residual:{
  pathKey:'A3-koeln',point:p,vehicles:1200,lanes:3,capacityVph:0,
  active:false,color:'standstill'
 }}};
 const zero={...demands,'A3-koeln':0};
 const one=advanceSpatial(initial,[],zero,1,routes);
 assert.equal(one.queues.residual.color,'standstill');
 assert.equal(one.queues.residual.pendingColor,'jam');
 const two=advanceSpatial(one,[],zero,1,routes);
 assert.equal(two.queues.residual.color,'jam');
 assert.equal(jamsAt(two,[],routes)[0].color,'jam');
});

test('the +5 min control is absent from both UI markup and TypeScript application',async()=>{
 const {readFileSync}=await import('node:fs');
 const html=readFileSync('index.html','utf8');
 const app=readFileSync('src/app.ts','utf8');
 assert.doesNotMatch(html,/id="traffic-step"|>\+5 min</);
 assert.doesNotMatch(app,/traffic-step/);
});