import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {extensionRoutes} from '../dist/network-extensions.js';
import {verifiedOsmAdditionalRoutes} from '../dist/01_Strassennetz/osm-zusatzrampen.js';
import {verifiedRampGapRoutes} from '../dist/01_Strassennetz/osm-rampenluecken.js';

const point=p=>p.map(n=>Number(n).toFixed(7)).join(',');
const edge=(a,b)=>[point(a),point(b)].sort().join('|');
const dist=(a,b)=>111195*Math.hypot(a[0]-b[0],(a[1]-b[1])*Math.cos((a[0]+b[0])*Math.PI/360));

test('OSM ramp gap repairs appear as real, selectable ramp paths',()=>{
 const ids=new Set(extensionRoutes.map(r=>r.id));
 const loaded=new Set();
 for(const r of verifiedRampGapRoutes){
  assert.ok(ids.has(r.id),'gap route not registered in main simulation: '+r.id);
  assert.ok(!loaded.has(r.id),'duplicate ramp gap ID: '+r.id);
  loaded.add(r.id);
  assert.match(r.id,/^extra-osm-ramp-gap-[0-9a-f]{12}$/);
  assert.equal(r.kind,'ramp');
  assert.equal(r.demandVph,0,'do not spawn phantom motorway traffic');
  assert.ok(r.points.length>=2);
  assert.ok(r.wayIds.length>0);
  assert.ok(r.lanes>=1&&r.lanes<=4);
  assert.ok(r.laneSegments[0].toM<=280.01);
  assert.ok(r.points.every(p=>p.length===2&&p.every(Number.isFinite)));
 }
});

test('new ramp parts do not duplicate the already rendered OSM geometry',()=>{
 const preexisting=[...networkData.roads,...networkData.ramps,
  ...extensionRoutes.filter(r=>!r.id.startsWith('extra-osm-ramp-gap-'))];
 const baseline=new Set(preexisting.flatMap(r=>r.points.slice(1).map((p,i)=>edge(r.points[i],p))));
 const repairs=new Set();
 for(const r of verifiedRampGapRoutes)for(let i=1;i<r.points.length;i++){
  const key=edge(r.points[i-1],r.points[i]);
  assert.ok(!baseline.has(key),'existing OSM motorway/ramp stroke was wrongly duplicated');
  assert.ok(!repairs.has(key),'two repairs overlap same OSM edge');
  repairs.add(key);
 }
});

test('the gap repair generator imports ONLY original motorway_link geometry, not local roads or proximity guesses',()=>{
 const src=readFileSync('scripts/repair_osm_ramp_gaps.py','utf8');
 assert.match(src,/tags\.get\("highway"\) != "motorway_link"/);
 assert.match(src,/frozenset\(\(a, b\)\)/);
 assert.match(src,/graph\[a\]\.append/);
 assert.match(src,/p not in street/);
 assert.doesNotMatch(src,/nearestPolyline|snapTo|interpolate|primary_link.*patch/);
 for(const r of verifiedRampGapRoutes)assert.ok(
  Math.abs(r.laneSegments[0].toM-r.points.slice(1).reduce(
   (total,p,i)=>total+dist(r.points[i],p),0
  ))<.05,r.id+' must use exact OSM line length'
 );
});
