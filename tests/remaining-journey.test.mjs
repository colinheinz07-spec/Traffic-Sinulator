import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors} from '../dist/spatial.js';
import {buildRampConnections} from '../dist/interchange.js';
import {initialiseCells,cellInventory} from '../dist/traffic-cells.js';
import {speedDelayInCells} from '../dist/speed-delay.js';
import {defaultDemands} from '../dist/traffic.js';
import {automaticDiversions} from '../dist/auto-diversions.js';
import {routedDiversionChoice} from '../dist/diversion-policy.js';
import {bundledDetourGeometry,isNetworkDestination} from '../dist/bundled-detours.js';
import {emptyDetour} from '../dist/detour-flow.js';
import {diversionJunctions} from '../dist/diversions.js';

const routes=makeCorridors(networkData.roads,networkData.ramps),{exits}=networkData;
const links=buildRampConnections(networkData.ramps,routes),demands=defaultDemands();
const grids=()=>Object.fromEntries(Object.keys(routes).filter(p=>!p.startsWith('ramp-'))
 .map(p=>[p,initialiseCells(routes[p],demands[p])]));
function queue(grid,from,to,minutes){
 const part=grid.cells.filter(c=>c.fromM>=from&&c.toM<=to),km=part.length*grid.cellM/1000;
 assert.ok(km>0);
 const speed=60*km/(minutes+60*km/130);
 for(const c of part)Object.assign(c,{speedKmh:speed,densityVehKm:140,vehicles:140*grid.cellM/1000,
  flowVph:speed*140,travelFlowVph:speed*140});
 grid.initialVehicles=cellInventory(grid);
}
function prepare(cells,turnDelays){return automaticDiversions([],routes,exits,cells,links,turnDelays).map(o=>{
 const config={id:o.key,path:o.path,targetPath:o.targetPath,fromM:o.from.metre,toM:o.to.metre,
  sourceEndM:o.sourceEndM,targetEntryM:o.targetEntryM,movementId:o.movementId,journey:o.journey,
  eventId:o.causeId??o.key,exitsNetwork:isNetworkDestination(o.to),
  geometry:o.geometry??bundledDetourGeometry(o.key,o.path,o.from,o.to,exits)};
 return {config,state:{...emptyDetour(config),choicePercent:100}};
});}
const choose=(entry,entries,cells,delays)=>routedDiversionChoice(entry,entries,cells,routes,[],exits,demands,delays);
const firstTarget=link=>diversionJunctions(link.to,exits,routes[link.to])
 .find(j=>!j.isInterchange&&j.metre>link.downstreamMergeM);

for(const link of links)test(`${link.rampId}: ramp and only the remaining target leg add to 47 minutes`,()=>{
 const cells=grids(),merge=link.downstreamMergeM,first=firstTarget(link);
 queue(cells[link.to],merge+100,Math.min(first.metre-100,merge+900),30);
 // A mainline queue before this merge is not ahead of the joining driver.
 if(merge>1800)queue(cells[link.to],merge-1500,merge-300,150);
 const delays={[link.rampId]:17},entries=prepare(cells,delays);
 for(const e of entries)if(e.config.journey?.kind==='via')e.enabled=false;
 const entry=entries.find(e=>e.config.path===link.from&&e.config.targetPath===link.to&&e.config.movementId===link.rampId);
 assert.ok(entry);
 const choice=choose(entry,entries,cells,delays);
 assert.ok(Math.abs(choice.delayMin-47)<1e-7,JSON.stringify(choice));
 assert.ok(choice.percent>0&&choice.percent<10,'only an initial willing destination share, not all motorway traffic');
 assert.equal(choice.mandatory,false);
});

test('17 ramp minutes plus 45 after the Frankfurt merge activate the Köln–Ransbach–Montabaur alternative',()=>{
 const link=links.find(l=>l.rampId==='ramp-a48-to-frankfurt'),cells=grids();
 queue(cells[link.to],link.downstreamMergeM+100,firstTarget(link).metre-100,45);
 const delays={[link.rampId]:17},entries=prepare(cells,delays),via=entries.find(e=>e.config.journey?.kind==='via');
 const before=structuredClone(cells),choice=choose(via,entries,cells,delays);
 assert.ok(Math.abs(choice.delayMin-62)<1e-7);
 assert.ok(choice.percent>0&&choice.percent<20);assert.equal(choice.mandatory,false);
 assert.equal(via.config.journey.rampId,'ramp-a48-to-koeln');
 assert.equal(entries.find(e=>e.config.journey?.kind==='continuation').config.geometry.sourceExitRef,'38');
 assert.deepEqual(cells,before,'a route decision cannot alter local queues or their separate labels');
});

test('a high A48 approach loss is included at Höhr, not counted as a saving for the later alternative ramp',()=>{
 const link=links.find(l=>l.rampId==='ramp-a48-to-frankfurt'),cells=grids();
 const hohr=diversionJunctions(link.from,exits,routes[link.from]).find(j=>j.ref==='12');
 queue(cells[link.from],hohr.metre+300,link.rampEntryM-300,50);
 queue(cells[link.to],link.downstreamMergeM+100,firstTarget(link).metre-100,30);
 const delays={[link.rampId]:17},entries=prepare(cells,delays);
 const via=entries.find(e=>e.config.journey?.kind==='via');
 assert.equal(choose(via,entries,cells,delays).percent,0);
 const direct=entries.find(e=>e.config.path===link.from&&e.config.targetPath===link.to&&e.config.geometry.sourceExitRef==='12');
 const choice=choose(direct,entries,cells,delays);
 assert.ok(Math.abs(choice.delayMin-97)<1e-7);assert.ok(choice.percent>0);
});

test('the faster complete alternative wins even when each A48/alternate leg alone stays below 45 minutes',()=>{
 const link=links.find(l=>l.rampId==='ramp-a48-to-frankfurt'),cells=grids();
 const hohr=diversionJunctions(link.from,exits,routes[link.from]).find(j=>j.ref==='12');
 queue(cells[link.from],hohr.metre+300,link.rampEntryM-300,30);
 queue(cells[link.to],link.downstreamMergeM+100,firstTarget(link).metre-100,30);
 const delays={[link.rampId]:17},entries=prepare(cells,delays);
 const via=entries.find(e=>e.config.journey?.kind==='via');
 const direct=entries.find(e=>e.config.path===link.from&&e.config.targetPath===link.to&&e.config.geometry.sourceExitRef==='12');
 assert.equal(choose(via,entries,cells,delays).percent,0,'shared A48 delay is not saved by the alternate ramp');
 const choice=choose(direct,entries,cells,delays);
 assert.ok(Math.abs(choice.delayMin-77)<1e-7);assert.ok(choice.percent>0);
});

test('queues on the alternate Köln arm make Höhr more attractive instead of disappearing from route cost',()=>{
 const link=links.find(l=>l.rampId==='ramp-a48-to-frankfurt'),cells=grids();
 queue(cells[link.to],link.downstreamMergeM+100,firstTarget(link).metre-100,30);
 const delays={[link.rampId]:17};let entries=prepare(cells,delays);
 let via=entries.find(e=>e.config.journey?.kind==='via');
 assert.ok(choose(via,entries,cells,delays).percent>0);
 queue(cells[via.config.targetPath],via.config.toM+100,via.config.journey.localExitM-100,30);
 entries=prepare(cells,delays);via=entries.find(e=>e.config.journey?.kind==='via');
 assert.equal(choose(via,entries,cells,delays).percent,0,'do not choose a slower congested alternate branch');
 const direct=entries.find(e=>e.config.path===link.from&&e.config.targetPath===link.to&&e.config.geometry.sourceExitRef==='12');
 assert.ok(choose(direct,entries,cells,delays).percent>0);
});

test('separate queues on the same remaining target leg are each counted once',()=>{
 const link=links.find(l=>l.rampId==='ramp-a48-to-koeln'),cells=grids(),merge=link.downstreamMergeM;
 queue(cells[link.to],merge+100,merge+500,20);
 queue(cells[link.to],merge+900,merge+1300,20);
 const delays={[link.rampId]:10},entries=prepare(cells,delays);
 const entry=entries.find(e=>e.config.path===link.from&&e.config.targetPath===link.to);
 const choice=choose(entry,entries,cells,delays);
 assert.ok(Math.abs(choice.delayMin-50)<1e-7);assert.ok(choice.percent>0);
 assert.ok(Math.abs(speedDelayInCells(cells[link.to],merge,entry.config.toM).delayMin-40)<1e-7);
});

test('a combined loss below 45 minutes does not start an AD detour',()=>{
 const link=links.find(l=>l.rampId==='ramp-a48-to-frankfurt'),cells=grids();
 queue(cells[link.to],link.downstreamMergeM+100,firstTarget(link).metre-100,27.9);
 const delays={[link.rampId]:17},entries=prepare(cells,delays);
 for(const e of entries.filter(e=>e.config.movementId===link.rampId))assert.equal(choose(e,entries,cells,delays).percent,0);
});
