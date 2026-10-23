import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice,emptySpatial,advanceSpatial,jamsAt} from '../dist/spatial.js';
import {initialiseCells,advanceCells,cellSpeedBands} from '../dist/traffic-cells.js';
import {trafficView} from '../dist/traffic-view.js';
import {buildRampConnections,rampSpillbacks} from '../dist/interchange.js';
import {defaultDemands} from '../dist/traffic.js';
import {freeSpeedKmh,resolveSpeedBands} from '../dist/traffic-physics.js';
import {speedDelayLabel} from '../dist/speed-delay.js';

const corridors=makeCorridors(networkData.roads,networkData.ramps);
const connections=buildRampConnections(networkData.ramps,corridors);
const path='A3-frankfurt',route=corridors[path];
function grid(sections){
 const state=initialiseCells(route,1200);
 for(const [from,to,speed] of sections)for(const c of state.cells.slice(from,to)){
  c.speedKmh=speed;c.densityVehKm=160;c.vehicles=160*(c.toM-c.fromM)/1000;
  c.flowVph=speed*160;
 }
 return state;
}
function view(state,legacy=[],events=[],spills=[],minute=state?.minute??0){
 return trafficView(legacy,state?{[path]:state}:{},corridors,events,spills,minute);
}
function oldQueue(state,from,to,id='accident'){
 const end=state.cells[to-1].toM,start=state.cells[from].fromM;
 return {id,pathKey:path,eventKind:'accident',point:routeSlice(route,end-1,end)[0],
  anchorM:end,queueVehicles:300,queueM:end-start,visibleQueueM:end-start,
  delayMin:99,capacityVph:1200,speedKmh:5,color:'standstill',released:false,outOfBoundsM:0};
}
function unionLength(bands){
 return resolveSpeedBands(bands).filter(b=>b.color!=='free').reduce((n,b)=>n+b.toM-b.fromM,0);
}
test('a long mapped mainline jam is not truncated to a much shorter legacy queue',()=>{
 const state=grid([[5,19,5]]),short=oldQueue(state,18,19);
 const result=view(state,[short]);
 const actual=state.cells[18].toM-state.cells[5].fromM;
 assert.equal(result.jams.length,1);
 assert.ok(result.jams[0].queueM>short.queueM*10);
 assert.ok(Math.abs(result.jams[0].queueM-actual)<1e-6);
 assert.ok(Math.abs(result.reports[path].queueKm-actual/1000)<1e-6);
 assert.ok(Math.abs(unionLength(result.bands.get(path))-actual)<1e-6);
 assert.ok(Math.abs(result.jams[0].delay.delayMin-60*actual/1000*(1/5-1/120))<1e-6);
});
test('a CTM queue appears in cards even without an old event queue',()=>{
 const result=view(grid([[8,15,15]]));
 assert.equal(result.jams.length,1);
 assert.equal(result.jams[0].color,'jam');
 assert.ok(result.jams[0].queueM>3000);
 assert.ok(result.reports[path].delayMin>0);
 assert.ok(result.reports[path].queueVehicles>0);
 assert.equal(result.reports['A3-koeln'].queueKm,0);
});
test('separate jams stay separate and route lengths sum without counting a free gap',()=>{
 const state=grid([[3,7,5],[11,17,25]]),result=view(state);
 assert.equal(result.jams.length,2);
 const sum=result.jams.reduce((n,j)=>n+j.queueM,0);
 assert.ok(Math.abs(result.reports[path].queueKm*1000-sum)<1e-6);
 assert.ok(Math.abs(unionLength(result.bands.get(path))-sum)<1e-6);
 assert.ok(result.jams[1].anchorM-result.jams[0].anchorM>result.jams[1].queueM);
});
test('one connected queue is counted once when two incident queues overlap it',()=>{
 const state=grid([[3,18,5]]);
 const a=oldQueue(state,3,15,'one'),b=oldQueue(state,9,18,'two');
 const result=view(state,[a,b]);
 assert.equal(result.jams.length,1);
 const mapM=unionLength(result.bands.get(path));
 assert.ok(Math.abs(result.reports[path].queueKm*1000-mapM)<1e-6);
 assert.ok(Math.abs(result.jams[0].queueM-mapM)<1e-6);
 assert.ok(result.jams[0].queueM<a.queueM+b.queueM);
});
test('one clearing cell inside a stop-and-go wave does not split and halve its card delay',()=>{
 const state=grid([[3,12,10],[13,23,10]]),root=oldQueue(state,13,23);
 const result=view(state,[root]),actual=unionLength(result.bands.get(path));
 assert.equal(result.jams.length,1);
 assert.equal(result.jams[0].queueOwnerId,root.id);
 assert.equal(result.physicalJams.length,2,'the traffic solver must retain the actual free-flow gap');
 assert.ok(Math.abs(result.jams[0].queueM-actual)<1e-6,'free gap is excluded from displayed length');
 assert.ok(result.jams[0].visibleQueueM>result.jams[0].queueM,'tail span still covers both fragments');
 assert.ok(Math.abs(result.jams[0].delay.delayMin-60*actual/1000*(1/10-1/120))<1e-6);
 const before=view(grid([[3,23,10]]),[root]).jams[0].delay.delayMin;
 assert.ok(Math.abs(before-result.jams[0].delay.delayMin)<3,'only the cleared cell can remove delay');
});
test('two distinct incident queues remain separate even with only one free cell between them',()=>{
 const state=grid([[3,12,10],[13,23,10]]),first=oldQueue(state,3,12,'one'),last=oldQueue(state,13,23,'two');
 const result=view(state,[first,last]);
 assert.equal(result.jams.length,2);
 assert.deepEqual(result.jams.map(j=>j.queueOwnerId),['one','two']);
 assert.ok(Math.abs(result.jams.reduce((n,j)=>n+j.queueM,0)-unionLength(result.bands.get(path)))<1e-6);
});
test('adjacent orange, red and stopped cells form one full-length traffic jam',()=>{
 const state=grid([[4,8,45],[8,11,20],[11,15,0]]),result=view(state);
 assert.equal(result.jams.length,1);
 assert.equal(result.jams[0].color,'standstill');
 const actual=state.cells[14].toM-state.cells[4].fromM;
 assert.ok(Math.abs(result.jams[0].queueM-actual)<1e-6);
 assert.equal(result.jams[0].delay.blocked,true);
 assert.ok(result.jams[0].delay.delayMin>0,'moving sections still contribute a minimum loss');
});
test('recovery reduces both displayed length and delay despite a stale old queue',()=>{
 const state=grid([[4,20,5]]),legacy=oldQueue(state,4,20);
 const before=view(state,[legacy]);
 const recovered=grid([[4,8,25]]);
 const after=view(recovered,[legacy]);
 assert.ok(after.reports[path].queueKm<before.reports[path].queueKm/3);
 assert.ok(after.delays[path].delayMin<before.delays[path].delayMin/3);
 assert.equal(view(grid([]),[legacy]).jams.length,0);
 assert.equal(view(grid([]),[legacy]).reports[path].queueKm,0);
});
test('near-zero moving traffic gives a high speed-based loss, with no closure clock',()=>{
 const state=grid([[4,8,.2]]);
 const first=view(state);
 assert.equal(first.delays[path].blocked,false);
 assert.ok(first.delays[path].delayMin>500);
 const length=first.jams[0].queueM;
 state.minute=100000;
 const later=view(state,[],[],[],100000);
 assert.deepEqual(later.delays[path],first.delays[path]);
 assert.equal(later.jams[0].queueM,length);
 assert.doesNotMatch(speedDelayLabel(later.delays[path]),/bisher/);
 const stopped=view(grid([[4,8,0]]));
 assert.equal(stopped.delays[path].blocked,true);
 assert.match(speedDelayLabel(stopped.delays[path]),/blockiert/);
 assert.doesNotMatch(speedDelayLabel(stopped.delays[path]),/\+\d/);
});
test('a speed restriction by itself is not invented queue length',()=>{
 const state=grid([]),at=state.cells[30].fromM;
 const event={id:'limit',kind:'roadworks',pathKey:path,point:routeSlice(route,at,at+2)[0],
  laneCount:3,closedLanes:[],createdAt:'2026-10-22T10:00:00Z',
  settings:{lengthM:500,speedKmh:40,shoulder:'normal'}};
 const result=view(state,[],[event]);
 assert.ok(result.bands.get(path).some(b=>b.source==='restriction'));
 assert.equal(result.reports[path].queueKm,0);
 assert.equal(result.jams.length,0);
});
test('ramp cards include the actual feeder overflow and their braking approach',()=>{
 const ramp='ramp-a48-to-frankfurt',road=corridors[ramp],anchor=road.lengthM*.8;
 const jam={id:'ramp-crash',pathKey:ramp,eventKind:'accident',point:routeSlice(road,anchor-1,anchor)[0],
  anchorM:anchor,queueVehicles:anchor/1000*95+180,queueM:anchor+1800,visibleQueueM:anchor,
  outOfBoundsM:1800,delayMin:60,capacityVph:400,speedKmh:4,color:'standstill',released:false};
 const spills=rampSpillbacks([jam],connections,corridors);
 const result=view(null,[jam],[],spills,40),card=result.jams.find(j=>j.pathKey===ramp);
 const mapped=unionLength(result.bands.get(ramp))+unionLength(result.spillBands.get(spills[0].source));
 assert.ok(Math.abs(card.queueM-mapped)<1e-6);
 assert.ok(card.feederM>1000);
 assert.ok(Math.abs(result.reports[ramp].queueKm*1000-card.queueM)<1e-6);
 assert.ok(Math.abs(result.reports[spills[0].source].queueKm*1000-card.feederM)<1e-6);
 assert.ok(card.delay.delayMin>0);
 assert.equal(result.reports[spills[0].source].exitDelayMin,result.delays[ramp].delayMin);
 assert.equal(result.delays[spills[0].source].delayMin,0,'the backed-up exit is not through-traffic delay');
 assert.equal(result.reports[spills[0].source].color,'standstill','overall status must acknowledge the mapped exit queue');
 assert.equal(result.reports[spills[0].source].throughColor,'free');
 assert.equal(result.reports[spills[0].source].throughSpeedKmh,100);
 assert.ok(result.reports[spills[0].source].speedKmh<=10);
});
test('ramp approach is included even for a short queue which has no overflow',()=>{
 const ramp='ramp-a48-to-frankfurt',road=corridors[ramp],anchor=road.lengthM*.75;
 const jam={id:'short',pathKey:ramp,eventKind:'accident',point:routeSlice(road,anchor-1,anchor)[0],
  anchorM:anchor,queueVehicles:10,queueM:100,visibleQueueM:100,outOfBoundsM:0,
  delayMin:2,capacityVph:400,speedKmh:4,color:'standstill',released:false};
 const result=view(null,[jam]),card=result.jams.find(j=>j.pathKey===ramp);
 assert.ok(card.queueM>100,'colored braking approach must not be left out');
 assert.ok(Math.abs(card.queueM-unionLength(result.bands.get(ramp)))<1e-6);
});
test('real OSM closure, reopening and final clearing keep all displayed extents consistent',()=>{
 const road=corridors[path],at=road.lengthM*.6;
 const event={id:'closed',kind:'closure',pathKey:path,point:routeSlice(road,at,at+2)[0],
  laneCount:3,closedLanes:[0,1,2],createdAt:'2026-10-22T10:00:00Z',
  settings:{lengthM:100,speedKmh:0,shoulder:'blocked'}};
 let state=initialiseCells(road,3400),spatial=emptySpatial(),peak=0;
 const demand={...defaultDemands(),[path]:3400};
 for(let minute=0;minute<100;minute++){
  const events=minute<20?[event]:[];
  const inflow=minute<20?3400:700;
  spatial=advanceSpatial(spatial,events,{...demand,[path]:inflow},1,corridors,connections,[],networkData.exits);
  state=advanceCells(state,road,events,inflow,networkData.exits);
  const legacy=jamsAt(spatial,events,corridors);
  const result=view(state,legacy,events,[],minute+1);
  const actual=cellSpeedBands(state).reduce((n,b)=>n+b.toM-b.fromM,0);
  const shown=result.jams.filter(j=>j.pathKey===path).reduce((n,j)=>n+j.queueM,0);
  assert.ok(Math.abs(shown-actual)<1e-6,'card/map mismatch at minute '+minute);
  assert.ok(Math.abs(result.reports[path].queueKm*1000-actual)<1e-6);
  peak=Math.max(peak,shown);
 }
 assert.ok(peak>2000);
 assert.equal(view(state).reports[path].queueKm,0);
 assert.ok(state.cells.every(c=>c.speedKmh>freeSpeedKmh(path)*.8));
});
