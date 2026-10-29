import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {makeCorridors,routeSlice} from '../dist/spatial.js';
import {initialiseCells,advanceCells,cellInventory,cellSpeedBands,assertCellConservation} from '../dist/traffic-cells.js';
import {eventCapacity} from '../dist/traffic.js';

const routes=makeCorridors(networkData.roads,networkData.ramps),{exits}=networkData;
function incident(path,open=2){
 const route=routes[path],at=route.lengthM*.7;
 return {id:'compact-head',kind:'accident',pathKey:path,point:routeSlice(route,at,at+1)[0],
  laneCount:3,closedLanes:Array.from({length:3-open},(_,i)=>i),createdAt:'2026-10-25T12:00:00Z',
  settings:{lengthM:100,speedKmh:80,shoulder:'normal'}};
}
function groups(bands){
 const result=[];
 for(const b of bands){const last=result.at(-1);
  if(last&&last.toM>=b.fromM-.1)last.toM=b.toM;else result.push({fromM:b.fromM,toM:b.toM});}
 return result;
}
for(const path of ['A3-koeln','A3-frankfurt'])test(`${path}: two free lanes sustain flow and a compact, moving two-hour queue`,()=>{
 // Keep this wave/stock stress case overloaded after the base-capacity increase.
 // Unchanged 4100/4200 reference demand is exercised by calibration/mobile cases.
 const route=routes[path],event=incident(path),flows=[],layouts=new Set();
 let state=initialiseCells(route,4600),mixed=0;
 for(let minute=0;minute<120;minute++){
  state=advanceCells(state,route,[event],4600,exits);assertCellConservation(state);
  const bands=cellSpeedBands(state);
  if(minute>=30){
   flows.push(state.dischargeVph);
   if(new Set(bands.map(b=>b.color)).size>=3)mixed++;
   layouts.add(bands.map(b=>[Math.round(b.fromM),Math.round(b.toM),b.color]).join('|'));
  }
  assert.ok(groups(bands).length<=2,'do not restore detached brake trains');
 }
 const mean=flows.reduce((n,f)=>n+f,0)/flows.length;
 assert.ok(mean>3500&&mean<=4000,'use the available two-lane capacity: '+mean);
 const length=cellSpeedBands(state).reduce((n,b)=>n+b.toM-b.fromM,0);
 assert.ok(length>3000&&length<14000,'4600/h for two hours must not automatically create a 25–35km queue: '+length);
 assert.ok(mixed>=8,'retain simultaneous physical orange/red/dark-red sections: '+mixed);
 assert.ok(layouts.size>=35,'the local density pattern must keep moving');
 assert.ok(cellInventory(state)>state.initialVehicles+1000,'compaction cannot erase waiting cars');
 const before=structuredClone(state);
 for(let i=0;i<10;i++)cellSpeedBands(state);
 assert.deepEqual(state,before,'repaints cannot drive the dynamics');
});
test('one open lane still builds substantially more congestion than two, with no artificial length cap',()=>{
 const path='A3-koeln',route=routes[path];let one=initialiseCells(route,4200),two=one;
 for(let i=0;i<120;i++){
  one=advanceCells(one,route,[incident(path,1)],4200,exits);
  two=advanceCells(two,route,[incident(path,2)],4200,exits);
 }
 const length=s=>cellSpeedBands(s).reduce((n,b)=>n+b.toM-b.fromM,0);
 assert.ok(length(one)>length(two)*1.4);
 assert.ok(cellInventory(one)>cellInventory(two)+2000);
 assertCellConservation(one);assertCellConservation(two);
});
test('two open lanes do not manufacture braking waves when arrivals fit the available capacity',()=>{
 const path='A3-koeln',route=routes[path],event=incident(path);
 assert.ok(eventCapacity(event,2800)>2800);
 let state=initialiseCells(route,2800);
 for(let i=0;i<120;i++){
  state=advanceCells(state,route,[event],2800,exits);assertCellConservation(state);
  assert.equal(cellSpeedBands(state).length,0);
 }
});
test('a real slow tail produces a short physical braking approach, including under low traffic',()=>{
 const path='A3-koeln',route=routes[path],event=incident(path,0);
 let state=initialiseCells(route,1400),observed=0;
 for(let i=0;i<40;i++){
  state=advanceCells(state,route,[event],1400,exits);assertCellConservation(state);
  const approaches=state.cells.filter(c=>c.approachLimitKmh!==undefined&&c.speedKmh<=65);
  observed+=approaches.length;
  for(const cell of approaches){
   assert.ok(state.cells.some(a=>a.fromM>cell.fromM&&a.fromM-cell.fromM<=500.1&&a.densityVehKm>=390*.55),
    'braking needs locally dense traffic within sight; a distant incident cannot impose it');
   assert.ok(cellSpeedBands(state).some(b=>b.fromM<=cell.fromM+.1&&b.toM>=cell.toM-.1));
   assert.ok(Math.abs(cell.flowVph-cell.speedKmh*cell.densityVehKm)<1e-5,
    'the approach color must use real conserved flow and density');
  }
 }
 assert.ok(observed>=10,'a low-density approach is still visible when vehicles actually brake');
});
