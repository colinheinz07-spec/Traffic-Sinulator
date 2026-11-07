import test from 'node:test';
import assert from 'node:assert/strict';
import {extensionRoutes} from '../dist/network-extensions.js';
import {buildExtensionConnections} from '../dist/extension-connections.js';

const rampId=extensionRoutes.find(r=>r.kind==='ramp')?.id;
assert.ok(rampId,'a known imported ramp is needed to exercise the connector');

function corridor(key,points){
 const metres=[0];
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i];
  metres.push(metres.at(-1)+111195*Math.hypot(
   (b[1]-a[1])*Math.cos((a[0]+b[0])*Math.PI/360),b[0]-a[0]));
 }
 return {key,points,metres,lengthM:metres.at(-1)};
}
const motorway=corridor('A3-koeln',[[50,7],[50,7.01],[50,7.02]]);
function connection(points){
 const routes={'A3-koeln':motorway,[rampId]:corridor(rampId,points)};
 return buildExtensionConnections(routes).find(link=>link.rampId===rampId);
}

test('a single OSM motorway-node hit must not create a wrong-way off-ramp',()=>{
 assert.equal(connection([[50,7.01],[50,7.009]]),undefined,
  'an exit against the carriageway direction is not legally connected');
});
test('a single OSM motorway-node hit must not create a wrong-way on-ramp',()=>{
 assert.equal(connection([[50,7.021],[50,7.02]]),undefined,
  'an entry merging against traffic is not legally connected');
});
test('a single exact OSM hit retains correctly directed exit and entry arms',()=>{
 const exit=connection([[50,7.01],[50.001,7.013]]);
 assert.equal(exit?.from,'A3-koeln');
 assert.equal(exit?.to,rampId);
 const entry=connection([[50.001,7.009],[50,7.01]]);
 assert.equal(entry?.from,rampId);
 assert.equal(entry?.to,'A3-koeln');
});
