import test from 'node:test';
import assert from 'node:assert/strict';
import {motorwayEndpointIndex} from '../dist/network-topology.js';

function corridor(key,points){
 let n=0;const metres=[0];
 for(let i=1;i<points.length;i++){
  n+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1])*111195;
  metres.push(n);
 }
 return {key,points,metres,lengthM:n};
}
test('new A61 and A100 are connected by OSM endpoints without per-motorway rules',()=>{
 const routes={
  'A61-nord':corridor('A61-nord',[[50,7],[50.001,7],[50.002,7]]),
  'A100-ost':corridor('A100-ost',[[50.001,7],[50.001,7.001]])
 };
 const mains=['A61-nord','A100-ost'],index=motorwayEndpointIndex(routes,mains);
 assert.equal(motorwayEndpointIndex(routes,mains),index,'reuse index for this network');
 assert.deepEqual(index.at([50.001,7]).map(x=>x.key),['A61-nord','A100-ost']);
 assert.deepEqual(index.at([50.001,7]).map(x=>x.metre>0),[true,false]);
 assert.deepEqual(index.at([50.0005,7.0005]),[],'nearby crossing is not a real interchange');
});
test('missing and merely nearby motorways do not create fake connections',()=>{
 const routes={'A61':corridor('A61',[[50,7],[50.001,7]])};
 const idx=motorwayEndpointIndex(routes,['A61','A7']);
 assert.deepEqual(idx.at([50.0011,7]),[]);
 assert.equal(idx.at([50.001,7])[0].key,'A61');
});
