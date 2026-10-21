import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {junctionMovements} from '../dist/junction-movements.js';

const routes=makeCorridors(networkData.roads,networkData.ramps),{exits}=networkData;
import {diversionJunctions} from '../dist/diversions.js';
const closureBetween=(path,startRef,endRef)=>{
 const route=routes[path],j=diversionJunctions(path,exits,route),start=j.find(x=>x.ref===startRef),end=j.find(x=>x.ref===endRef);
 assert.ok(start&&end&&start.metre<end.metre);
 const point=routeSlice(route,(start.metre+end.metre)*.5,(start.metre+end.metre)*.5+5)[0];
 const lanes=path.startsWith('A48')?2:3;
 return {id:path+'-closed',kind:'closure',pathKey:path,point,laneCount:lanes,
  closedLanes:Array.from({length:lanes},(_,i)=>i),createdAt:'2026-10-21T21:00:00Z',
  settings:{lengthM:350,speedKmh:0,shoulder:'blocked'}};
};
test('all 15 nodes shown in BOTH A3/A48 driving directions, AK/AD not local exits',()=>{
 for(const path of ['A3-koeln','A3-frankfurt','A48-dernbach','A48-koblenz']){
  const rows=junctionMovements(path,routes[path],exits,[],null);
  assert.equal(rows.length,path.startsWith('A3')?10:5);
  assert.ok(rows.every((r,i)=>i===0||r.exit.metre>rows[i-1].exit.metre));
  assert.ok(rows.every(r=>r.desiredPercent===0&&r.outVph===0&&r.inVph===0));
  assert.ok(rows.some(r=>r.exit.isInterchange),'must retain junctions, marked as AK/AD');
 }
});
test('Vollsperrung sets 100% mandatory at LAST normal exit upstream, never at AK or downstream',()=>{
 for(const [path,from,to] of [
  ['A3-koeln','40','39'],['A3-frankfurt','37','38'],
  ['A48-dernbach','10','11'],['A48-koblenz','12','11']
 ]){
  const event=closureBetween(path,from,to);
  const rows=junctionMovements(path,routes[path],exits,[event],70);
  const wanted=rows.filter(x=>x.mandatory);
  assert.equal(wanted.length,1,path);
  assert.equal(wanted[0].exit.ref,from,path);
  assert.equal(wanted[0].desiredPercent,100);
  assert.ok(wanted[0].distanceBeforeClosureKm>0);
  assert.equal(wanted[0].outVph,0,'100% intention must not become fake actual departures');
  assert.ok(rows.every(x=>!x.exit.isInterchange||x.desiredPercent===0));
 }
});
test('normal congestion gives graduated route-choice only to reachable upstream exits',()=>{
 const road=routes['A3-koeln'],event={...closureBetween('A3-koeln','40','39'),
  kind:'roadworks',closedLanes:[0],settings:{lengthM:500,speedKmh:80,shoulder:'normal'}};
 const rows=junctionMovements('A3-koeln',road,exits,[event],90);
 const used=rows.filter(r=>r.desiredPercent>0);
 assert.equal(used.length,3);
 assert.deepEqual(used.map(x=>x.exit.ref),['42','41','40']);
 assert.deepEqual(used.map(x=>x.desiredPercent),[7.5,15,25]);
 assert.ok(used.every(x=>!x.mandatory));
});
test('only active verified detour ledger provides measured exit and entry volumes',()=>{
 const path='A3-koeln',event=closureBetween(path,'40','39');
 const rows=junctionMovements(path,routes[path],exits,[event],null,[]);
 const start=rows.find(x=>x.exit.ref==='40'),end=rows.find(x=>x.exit.ref==='38');
 const transferred=junctionMovements(path,routes[path],exits,[event],null,[{
  path,fromM:start.exit.metre,toM:end.exit.metre,eventId:event.id,
  outVph:720,inVph:360,vehiclesOnDetour:87,waitingAtReentry:17
 }]);
 const source=transferred.find(x=>x.exit.ref==='40'),target=transferred.find(x=>x.exit.ref==='38');
 assert.equal(source.desiredPercent,100);
 assert.equal(source.outVph,720);
 assert.equal(source.inVph,0);
 assert.equal(target.outVph,0);
 assert.equal(target.inVph,360);
 assert.equal(target.waitingAtReentry,17);
 assert.equal(source.vehiclesOnDetour,87);
 assert.ok(source.validatedRouteActive&&target.validatedRouteActive);
 // 100% plan doesn't turn into 100% actual if the ramp discharges less.
 assert.notEqual(source.outVph,4200);
});
test('direction isolation: Cologne closure must not mark Frankfurt or any A48 exit',()=>{
 const closed=closureBetween('A3-koeln','40','39');
 for(const key of ['A3-frankfurt','A48-dernbach','A48-koblenz']){
  const rows=junctionMovements(key,routes[key],exits,[closed],90);
  assert.ok(rows.every(r=>r.desiredPercent===0&&!r.mandatory),key);
 }
});
test('UI distinctly renders planned percentage, actual departure, actual reentry and map arrows',()=>{
 const app=readFileSync('src/app.ts','utf8'),html=readFileSync('index.html','utf8');
 assert.match(app,/renderJunctionMovements\(key\)/);
 assert.match(app,/drawJunctionMovementHints\(width,height\)/);
 assert.match(app,/outVph:entry\.state\.lastDeparture\*60/);
 assert.match(app,/inVph:entry\.state\.lastRejoined\*60/);
 assert.match(html,/id="junction-movements"/);
 assert.match(html,/100 %/);
 assert.match(html,/Ist ↓ \/ ↑/);
});
