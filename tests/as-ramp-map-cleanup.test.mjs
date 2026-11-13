import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lineWidths} from '../dist/cartography.js';

test('AS public connector streets are not tinted motorway green or listed in the legend',()=>{
 const source=readFileSync('src/app.ts','utf8');
 const html=readFileSync('index.html','utf8');
 assert.doesNotMatch(source,/publicAccessConnectors/);
 assert.doesNotMatch(source,/drawVerifiedStreetTerminals\(width,height\)/);
 assert.doesNotMatch(html,/AS-Verbindungsstraße|Türkisgrüne Anschlussstellen-Verbindungsstraßen/);
 assert.match(source,/for\(const feature of extensionRoutes\).*visibleRanges/);
});
test('actual close-zoom motorway_link ramps fully overpaint the pink OSM basemap',()=>{
 const low=lineWidths(11),high=lineWidths(17);
 assert.ok(high.ramp>low.ramp*3);
 assert.ok(high.ramp>13,'zoomed ramps need enough stroke width to cover motorway_link raster');
 assert.ok(high.motorway>13);
 assert.ok(high.rampCasing>high.ramp);
});
