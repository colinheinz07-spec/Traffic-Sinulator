import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,positionM,emptySpatial,advanceSpatial,jamsAt} from '../dist/spatial.js';
import {buildRampConnections,rampSpillbacks} from '../dist/interchange.js';
import {defaultDemands} from '../dist/traffic.js';
import {eventFromHit} from '../dist/events.js';
const routes=makeCorridors(networkData.roads,networkData.ramps);
const links=buildRampConnections(networkData.ramps,routes);
const d=defaultDemands(),ramp=(key)=>networkData.ramps.find(r=>r.id===key);
function event(key,anchorFraction,id='blocked'){
 const rm=ramp(key),rt=routes[key],p=rt.points[Math.floor((rt.points.length-1)*anchorFraction)];
 const hit={kind:'ramp',ramp:rm,point:p,key,distance:0,fraction:anchorFraction};
 return eventFromHit(hit,'closure',2,[] ,id,'2026-10-19T08:20:00Z',{lengthM:100,speedKmh:0,shoulder:'blocked'});
}
function simulate(key,minutes,anchor=.5){const e=event(key,anchor);const state=advanceSpatial(emptySpatial(),[e],d,minutes,routes);return {e,state,jams:jamsAt(state,[e],routes)};}
test('all four Dernbach ramps snap to exact motorway nodes, never wrong direction',()=>{
 assert.equal(links.length,4);
 for(const link of links){assert.ok(link.sourceGapM<.01);assert.ok(link.mergeGapM<.01);assert.ok(link.rampEntryM>=0&&link.rampEntryM<=routes[link.from].lengthM);
  assert.ok(link.downstreamMergeM>=0&&link.downstreamMergeM<=routes[link.to].lengthM);
  assert.equal(link.from,ramp(link.rampId).from);assert.equal(link.to,ramp(link.rampId).to);
 }
 assert.deepEqual(links.filter(x=>x.from==='A48-dernbach').map(x=>x.to).sort(),['A3-frankfurt','A3-koeln']);
 const wrong=networkData.ramps.map(r=>r.id==='ramp-a48-to-koeln'?{...r,from:'A48-koblenz'}:r);
 assert.throws(()=>buildRampConnections(wrong,routes),/nicht eindeutig|nicht.*verbunden|Fahrtrichtung/);
});
test('A48 -> A3 Köln queue stays on ramp until entrance and spills ONLY onto A48 Dernbach direction',()=>{
 const key='ramp-a48-to-koeln',initial=simulate(key,1,.5),later=simulate(key,45,.5);
 assert.equal(rampSpillbacks(initial.jams,links,routes).length,0);
 const spills=rampSpillbacks(later.jams,links,routes);
 assert.equal(spills.length,1);const s=spills[0];
 assert.equal(s.rampId,key);assert.equal(s.source,'A48-dernbach');assert.equal(s.target,'A3-koeln');
 assert.ok(s.fromM>=0&&s.toM<=routes[s.source].lengthM);
 assert.ok(s.lengthM>500);
 assert.equal(later.state.queues.blocked.pathKey,key);
 assert.ok(!Object.values(later.state.queues).some(q=>q.pathKey==='A48-koblenz'));
 assert.ok(!spills.some(x=>x.source==='A48-koblenz'||x.source==='A3-frankfurt'));
 // The overflow is a partition of original ramp queue, never new vehicles.
 assert.ok(s.queuedVehiclesOnMotorway>0&&s.queuedVehiclesOnMotorway<later.jams[0].queueVehicles);

});
test('correct spillback parent for all four directed movements',()=>{
 for(const link of links){const {jams}=simulate(link.rampId,50,.25);const spill=rampSpillbacks(jams,links,routes).find(x=>x.rampId===link.rampId);
  assert.ok(spill,link.rampId+' no overflow');assert.equal(spill.source,link.from);assert.ok(spill.toM>=spill.fromM);
 }
});
test('lifting a ramp closure clears its spillback progressively, not instantly',()=>{
 const key='ramp-a48-to-koeln',e=event(key,.5);
 const packed=advanceSpatial(emptySpatial(),[e],d,35,routes);
 const initial=rampSpillbacks(jamsAt(packed,[e],routes),links,routes)[0];assert.ok(initial);
 const minute=advanceSpatial(packed,[],d,1,routes);
 const updated=rampSpillbacks(jamsAt(minute,[],routes),links,routes)[0];
 assert.ok(updated&&updated.lengthM<initial.lengthM,'overflow shrinks after release');
 let cleared=minute;for(let i=0;i<6;i++)cleared=advanceSpatial(cleared,[],d,60,routes);
 assert.equal(rampSpillbacks(jamsAt(cleared,[],routes),links,routes).length,0);
});
test('same ramp serial jams choose one overflow overlay; never invent duplicate motorway queues',()=>{
 const key='ramp-a48-to-koeln',j1=simulate(key,40,.25).jams[0],j2=simulate(key,40,.6).jams[0];
 const spill=rampSpillbacks([{...j1,id:'one'},{...j2,id:'two'}],links,routes);
 assert.equal(spill.length,1);assert.equal(spill[0].source,'A48-dernbach');
});
test('UI wires OSM spillback to map and identifies limits without deleting +5-minute debug control',()=>{
 const app=readFileSync('src/app.ts','utf8'),html=readFileSync('index.html','utf8'),workflow=readFileSync('.github/workflows/check.yml','utf8');
 assert.match(app,/buildRampConnections\(ramps,spatialCorridors\)/);
 assert.match(app,/rampSpillbacks\(list,rampConnections,spatialCorridors\)/);
 assert.match(html,/id="traffic-interchange"/);
 assert.match(html,/id="traffic-step"/);
 assert.match(html,/Verkehrsströme an Verzweigungen.*nicht vollständig/);
 assert.match(workflow,/interchange\.js/);
});
