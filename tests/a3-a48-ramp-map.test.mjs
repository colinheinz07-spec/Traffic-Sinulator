import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {extensionRoutes} from '../dist/network-extensions.js';
import {makeCorridors,positionM} from '../dist/spatial.js';
const routes=makeCorridors(networkData.roads,networkData.ramps);
test('every regular A3/A48 directional exit is included in a coloured selectable ramp path',()=>{
 for(const exit of networkData.exits.filter(e=>!e.name.startsWith('AD ')&&!e.name.startsWith('AK '))){
  for(const [path,anchor] of Object.entries(exit.directional??{})){
   if(exit.access?.[path]?.exit===false)continue;
   assert.ok(extensionRoutes.some(r=>r.kind==='ramp'&&r.points.some(p=>p[0]===anchor.position[0]&&p[1]===anchor.position[1])),exit.road+' '+exit.ref+' '+path);
  }
 }
});
test('Montabaur and A48 ordinary junctions have actual off-ramp and on-ramp geometry meeting each carriageway',()=>{
 for(const [road,ref,paths] of [['A3','40',['A3-koeln','A3-frankfurt']],['A48','10',['A48-dernbach','A48-koblenz']],['A48','11',['A48-dernbach','A48-koblenz']],['A48','12',['A48-dernbach','A48-koblenz']]]){
  const exit=networkData.exits.find(e=>e.road===road&&e.ref===ref);
  for(const key of paths){
   const anchor=exit.directional?.[key]?.position??exit.position,at=positionM(routes[key],anchor,1);assert.notEqual(at,null);
   for(const end of [0,-1])assert.ok(extensionRoutes.some(r=>{
    if(r.kind!=='ramp'||!r.zone.includes(exit.name))return false;
    const p=r.points.at(end),m=positionM(routes[key],p,.1);return m!==null&&Math.abs(m-at)<2200;
   }),road+' '+ref+' '+key+' '+(end===0?'exit':'entry'));
  }
 }
});
