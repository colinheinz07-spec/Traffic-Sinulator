import test from 'node:test';
import assert from 'node:assert/strict';
import {closedNetworkSpans,effectiveNetworkEvents} from '../dist/closure-network.js';

function road(key,points,metres){
 return {key,points,metres,lengthM:metres.at(-1)};
}
const approach=road('extra-a4-aachen',[[50,7],[50,7.005],[50,7.01]],[0,500,1000]);
const escape=road('ramp-local-exit',[[50,7.005],[50,7.006]],[0,100]);
const armA=road('ramp-arm-a',[[50,7.01],[50,7.011]],[0,100]);
const armB=road('ramp-arm-b',[[50,7.01],[50.001,7.011]],[0,120]);
const other=road('extra-a4-olpe',[[50.01,7.01],[50.01,7]],[0,1000]);
const routes=Object.fromEntries([approach,escape,armA,armB,other].map(r=>[r.key,r]));
const event=(r)=>({id:r.key,kind:'closure',pathKey:r.key,point:r.points[0],laneCount:1,closedLanes:[0],createdAt:'2026-11-16T07:00:00Z',settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}});
test('both terminal movements closed: close approach back to last usable escape',()=>{
 const spans=closedNetworkSpans([event(armA),event(armB)],routes,[],[]);
 assert.ok(spans.some(s=>s.pathKey===approach.key&&s.fromM===500&&s.toM===1000));
 assert.ok(!spans.some(s=>s.pathKey===escape.key||s.pathKey===other.key));
});
test('one open movement: retain common approach; reopening removes derived closure',()=>{
 const spans=closedNetworkSpans([event(armA)],routes,[],[]);
 assert.ok(!spans.some(s=>s.pathKey===approach.key||s.pathKey===armB.key));
 assert.equal(effectiveNetworkEvents([],routes,[],[]).length,0);
});
test('effective timeline shares exact derived gate and preserves original input',()=>{
 const input=[event(armA),event(armB)];
 const snapshot=JSON.stringify(input);
 const effective=effectiveNetworkEvents(input,routes,[],[]);
 const derived=effective.find(e=>e.pathKey===approach.key);
 assert.equal(derived?.networkClosure?.derived,true);
 assert.equal(derived?.networkClosure?.fromM,500);
 assert.equal(derived?.networkClosure?.toM,1000);
 assert.equal(JSON.stringify(input),snapshot);
 assert.equal(closedNetworkSpans(effective,routes,[],[]).find(s=>s.pathKey===approach.key)?.fromM,500);
});
