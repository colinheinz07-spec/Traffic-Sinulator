import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {networkData} from '../dist/geodata.js';
import {extensionRoutes} from '../dist/network-extensions.js';
import {makeCorridors} from '../dist/spatial.js';

test('OSM motorway colour option is an actual usable map control',()=>{
 const html=readFileSync('index.html','utf8'),app=readFileSync('src/app.ts','utf8');
 assert.match(html,/id="osm-autobahnfarben-toggle"/);
 assert.match(html,/type="checkbox"/);
 assert.match(html,/Autobahn-Hauptfahrbahn/);
 assert.match(html,/Autobahnrampe\/Überleitung/);
 assert.match(app,/showOsmAutobahnClasses=osmClassesToggle\.checked/);
 assert.match(app,/if\(showOsmAutobahnClasses\)/);
 assert.match(app,/feature\.kind==='ramp'\?'#8ddfff':'#3776ed'/);
 assert.match(app,/for\(const ramp of ramps\)stroke\(ramp\.points,lines\.rampCasing\+5/);
});

test('colours distinguish motorway from retained motorway_link without inventing new roads',()=>{
 const before=extensionRoutes.length;
 const motorways=extensionRoutes.filter(r=>r.kind==='motorway');
 const links=extensionRoutes.filter(r=>r.kind==='ramp');
 assert.ok(motorways.length>10);
 assert.ok(links.length>100);
 assert.ok(networkData.roads.length>300);
 const roads=makeCorridors(networkData.roads,networkData.ramps);
 assert.ok(roads['A3-koeln']);
 assert.equal(extensionRoutes.length,before);
 assert.ok(links.every(r=>r.points.length>1&&r.wayIds.length>0));
});

test('classification uses OSM way types and excludes mere service-area slip roads',()=>{
 const generator=readFileSync('scripts/build_network_extensions.py','utf8');
 const filter=readFileSync('scripts/service_area_ramps.py','utf8');
 assert.match(generator,/get\('highway'\)!='motorway_link'/);
 assert.match(generator,/get\('highway'\)=='motorway'/);
 assert.match(generator,/rest_area_only_ramp/);
 assert.match(filter,/SERVICE_AREA/);
 assert.match(filter,/PUBLIC_ROADS/);
});
test('colour overlay never sets vehicle speed, jam status or adds route connections',()=>{
 const app=readFileSync('src/app.ts','utf8');
 const frag=app.match(/if\(showOsmAutobahnClasses\)\{([\s\S]*?)\n \}/)?.[1]??'';
 assert.ok(frag.length>0);
 assert.doesNotMatch(frag,/networkConnections|create|push\(|speedKmh|jamColors|cellNetwork|spatialState/);
 assert.match(app,/drawSpatialJams\(\);drawClosureSections\(\)/);
});
