import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('map omits per-ramp delay callouts, retains coloured physical ramp and motorway segments',()=>{
 const source=readFileSync('src/app.ts','utf8');
 const start=source.indexOf('function drawSpatialJams()'),end=source.indexOf('function draw()',start);
 assert.ok(start>=0&&end>start);
 const map=source.slice(start,end);
 assert.ok(map.includes('for(const [key,bands] of view.bands)'), 'physical traffic colours must remain');
 assert.ok(map.includes("if(jam.pathKey.startsWith('ramp-')||extensionRoute(jam.pathKey)?.kind==='ramp')continue;"), 'per-ramp delay labels must be omitted');
 assert.ok(map.includes('for(const jam of view.jams)'), 'motorway jam labels must remain');
});
