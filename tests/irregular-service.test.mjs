import test from 'node:test';
import assert from 'node:assert/strict';
import {platoonServiceFactor} from '../dist/traffic-cells.js';

for(const id of ['distributed-A3-frankfurt:parallel','distributed-A3-koeln:parallel','compact-head:parallel'])
 test(`${id}: actual service varies within moving and braking phases, without fixed flat release plateaus`,()=>{
  const times=Array.from({length:12000},(_,i)=>i/30),read=t=>platoonServiceFactor(id,t,1.17);
  const values=times.map(read);let flat=0;const depths=[],durations=[];let start=0,low=1;
  for(let i=1;i<values.length;i++){
   const v=values[i],before=values[i-1];
   assert.ok(v>=0&&v<=1.17+1e-9);
   if(Math.abs(v-before)<1e-8)flat++;
   if(v<1){if(before>=1){start=times[i];low=v;}else low=Math.min(low,v);}
   else if(before<1){depths.push(low);durations.push(times[i]-start);}
  }
  assert.ok(flat/values.length<.01,'vary the shape within a release, not only the next episode start: '+flat/values.length);
  assert.ok(Math.max(...depths)-Math.min(...depths)>.25,'braking intensity changes');
  assert.ok(Math.max(...durations)-Math.min(...durations)>1.5,'braking lengths change');
  assert.ok(Math.abs(values.reduce((s,v)=>s+v,0)/values.length-1)<.006,'irregularity must not reduce mean capacity');
  // Querying paused times, or another incident, cannot advance this history.
  const samples=[0,12.37,99,210.8].map(read);
  for(const t of [...times].reverse().filter((_,i)=>i%100===0))read(t);
  assert.deepEqual([0,12.37,99,210.8].map(read),samples);
  assert.notDeepEqual([0,12.37,99,210.8].map(t=>platoonServiceFactor(id+'-other',t,1.17)),samples);
 });

test('a peak bound equal to mean service remains constant rather than manufacturing extra capacity',()=>{
 for(let t=0;t<300;t+=.37)assert.equal(platoonServiceFactor('no-spare-peak',t,1),1);
});
