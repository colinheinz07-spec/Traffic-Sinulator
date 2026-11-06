import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {profileFactor} from '../dist/traffic-profiles.js';
import {defaultDemands,demandAtClock} from '../dist/traffic.js';
import {profilePreviewMoment,profilePreviewValues} from '../dist/02_Verkehr/verkehrsprofil-editor.js';

const monday=(hour)=>new Date(2026,10,2,hour,0,0,0);
const friday=(hour)=>new Date(2026,10,6,hour,0,0,0);
const families=['A3-koeln','A48-koblenz','extra-a4-aachen','extra-a59-bonn','extra-a559-porz','extra-a560-hennef'];

test('Friday afternoon maximum is earlier than weekday commuter evening, across six traffic families',()=>{
 for(const key of families){
  const friEarly=profileFactor(key,friday(14));
  const friLate=profileFactor(key,friday(17));
  const monEarly=profileFactor(key,monday(14));
  const monLate=profileFactor(key,monday(17));
  assert.ok(friEarly>friLate*1.1,key+' Friday morning-to-afternoon shift');
  assert.ok(monLate>monEarly,key+' regular weekday evening peak retained');
 }
});
test('regional Friday calibrations remain direction-specific without a late Friday commuter peak',()=>{
 assert.ok(profileFactor('A3-koeln',friday(16))>profileFactor('A3-koeln',monday(16)));
 assert.ok(profileFactor('A48-koblenz',friday(16))<profileFactor('A48-koblenz',monday(16)));
 assert.ok(profileFactor('A48-koblenz',friday(14))>profileFactor('A48-koblenz',friday(16)));
});
test('Friday profiles vary continuously, including the Friday-to-Saturday midnight boundary',()=>{
 for(const key of families){
  for(let minute=10*60+1;minute<20*60;minute++){
   const earlier=new Date(2026,10,6,0,minute-1),later=new Date(2026,10,6,0,minute);
   assert.ok(Math.abs(profileFactor(key,later)-profileFactor(key,earlier))<.025,key+' minute '+minute);
  }
  const fri=new Date(2026,10,6,23,59),sat=new Date(2026,10,7,0,1);
  assert.ok(Math.abs(profileFactor(key,fri)-profileFactor(key,sat))<.01,key+' midnight');
 }
});
test('visual preview uses the EXACT same reference demand and model curve as the simulator',()=>{
 const reference=defaultDemands(),base=friday(9);
 for(const key of families)for(const day of [1,5,6,0]){
  const sample=profilePreviewValues(key,reference[key],base,day);
  assert.equal(sample.length,49);
  const moment=profilePreviewMoment(base,day,14);
  assert.equal(sample[28],demandAtClock(reference,moment)[key]);
  assert.equal(moment.getDay(),day);
  assert.equal(moment.getHours(),14);
 }
 assert.throws(()=>profilePreviewValues('A3-koeln',-1,base,5));
 assert.throws(()=>profilePreviewMoment(base,9,14));
});
test('traffic editor is wired to actual route demand and resets when loading a day',()=>{
 const html=readFileSync('index.html','utf8'),app=readFileSync('src/app.ts','utf8');
 for(const id of ['traffic-profile-editor','traffic-profile-day','traffic-profile-hour',
  'traffic-profile-peak','traffic-profile-graph','traffic-profile-apply-day'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(app,/mountTrafficProfileEditor\(/);
 assert.match(app,/trafficDemands\[key\]=value/);
 assert.match(app,/simulationStartMs=value\.getTime\(\)/);
 assert.match(app,/demandMode='clock'/);
 assert.match(app,/cellNetwork=\{\};resetDetourFlow\(\)/);
});
