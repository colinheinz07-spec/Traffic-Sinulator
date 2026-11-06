import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LOCAL_JUNCTION_PROFILES,junctionLocalProfile,localJunctionShares,validateLocalJunctionProfiles}
 from '../dist/02_Verkehr/anschlussstellen-nachfrage.js';
import {networkData} from '../dist/geodata.js';
import {extensionJunctions} from '../dist/network-extensions.js';
import {makeCorridors} from '../dist/spatial.js';
import {normalJunctionTraffic} from '../dist/junction-traffic.js';
import {initialiseCells,advanceCells,assertCellConservation} from '../dist/traffic-cells.js';

const exits=[...networkData.exits,...extensionJunctions];
const routes=makeCorridors(networkData.roads,networkData.ramps);
const monday=new Date(2026,10,2,14,0);
const friday=new Date(2026,10,6,14,0);

test('local scenario profiles correspond to real imported exits, not invented ramps',()=>{
 assert.deepEqual(validateLocalJunctionProfiles(),[]);
 assert.ok(LOCAL_JUNCTION_PROFILES.length>=35);
 for(const p of LOCAL_JUNCTION_PROFILES){
  assert.ok(exits.some(e=>e.road===p.road&&e.ref===p.ref),
   p.road+' AS '+p.ref+' absent from imported network');
 }
});

test('Montabaur and Limburg differ from smaller A3 access nodes, including exit and entry shares',()=>{
 const route=routes['A3-koeln'];
 const rows=normalJunctionTraffic(route,exits,3000,friday,true);
 const find=(ref)=>rows.find(j=>j.ref===ref);
 assert.ok(find('40').entryVph>find('37').entryVph*2);
 assert.ok(find('42').entryVph>find('35').entryVph*2);
 assert.ok(find('42').exitPercent>find('35').exitPercent*2);
 assert.equal(find('40').exitPercent,12);
 assert.ok(junctionLocalProfile('A3','40'));
 assert.ok(junctionLocalProfile('A3','42'));
});

test('A48, A59 and urban A4 use distinct modeled local entry and exit amounts',()=>{
 const a48=normalJunctionTraffic(routes['A48-dernbach'],exits,1900,friday,true);
 const hoer=a48.find(j=>j.ref==='12'),bendorf=a48.find(j=>j.ref==='11');
 assert.ok(hoer&&bendorf&&hoer.entryVph>0&&bendorf.entryVph>0);
 const a59=normalJunctionTraffic(routes['extra-a59-bonn'],exits,2400,friday,true);
 const air=a59.find(j=>j.ref==='34'),lind=a59.find(j=>j.ref==='36');
 assert.ok(air&&lind);
 assert.ok(air.entryVph>lind.entryVph);
 assert.ok(air.exitPercent>lind.exitPercent);
 const a4=normalJunctionTraffic(routes['extra-a4-aachen'],exits,3000,friday,true);
 const poll=a4.find(j=>j.ref==='13'),eifeltor=a4.find(j=>j.ref==='11b');
 assert.ok(poll&&eifeltor);
 assert.notEqual(poll.entryVph,eifeltor.entryVph);
});

test('constant and wave stress-test mode retains balanced local source/sink shares',()=>{
 const chosen=localJunctionShares('A3','34',false);
 assert.equal(chosen.entryPercent,chosen.exitPercent);
 const rows=normalJunctionTraffic(routes['A3-frankfurt'],exits,1500);
 // Teilanschlüsse können nur eine Auffahrt oder nur eine Abfahrt haben.
 // Der Test prüft die balancierten Szenarioanteile deshalb ausschließlich
 // dort, wo laut realem Netz BEIDE Fahrbeziehungen offen sind.
 const both=rows.filter(j=>j.entryVph>0&&j.exitPercent>0);
 assert.ok(both.length>=5);
 assert.ok(both.every(j=>Math.abs(j.entryVph/1500*100-j.exitPercent)<1e-8));
 assert.ok(rows.every(j=>j.entryVph>=0&&j.exitPercent>=0));

 assert.equal(localJunctionShares('A3','40',false).entryPercent,12);
 assert.equal(localJunctionShares('A3','37',false).exitPercent,5);
});

test('local entry/exit differences are real conserved transactions, not density multipliers',()=>{
 const key='A3-frankfurt',route=routes[key],demand=2400;
 let state=initialiseCells(route,demand);
 for(let step=0;step<15;step++){
  const moment=new Date(monday.getTime()+step*60000);
  const nodes=normalJunctionTraffic(route,exits,demand,moment,true);
  state=advanceCells(state,route,[],demand,exits,[],nodes);
  assertCellConservation(state);
 }
 assert.ok(state.junctions.some(j=>j.enteredTotal>0&&j.exitedTotal>0));
 assert.ok(state.junctions.some(j=>Math.abs(j.entryVph/demand*100-j.exitPercent)>.1));
});

test('local shares are visible per selected route in the existing traffic panel',()=>{
 const html=readFileSync('index.html','utf8'),app=readFileSync('src/app.ts','utf8');
 const renderer=readFileSync('src/02_Verkehr/anschlussstellen-uebersicht.ts','utf8');
 for(const id of ['traffic-local-demand-panel','traffic-local-demand-list','traffic-local-demand-mode'])
  assert.ok(html.includes('id="'+id+'"'));
 assert.match(app,/renderLocalDemandProfiles\(spatialCorridors\[key\]/);
 assert.match(renderer,/normalJunctionTraffic\(/);
 assert.match(renderer,/j\.entryVph/);
 assert.match(renderer,/j\.exitPercent/);
});
