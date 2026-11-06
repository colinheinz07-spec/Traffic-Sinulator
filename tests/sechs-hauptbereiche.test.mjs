import test from 'node:test';
import assert from 'node:assert/strict';
import * as road from '../dist/01_Strassennetz.js';
import * as oldRoad from '../dist/network-catalog.js';
import * as traffic from '../dist/02_Verkehr.js';
import * as oldTraffic from '../dist/traffic-profiles.js';
import * as physics from '../dist/03_Stauphysik.js';
import * as oldPhysics from '../dist/traffic-physics.js';
import * as events from '../dist/04_Ereignisse.js';
import * as oldEvents from '../dist/events.js';
import * as detours from '../dist/05_Umleitungen.js';
import * as oldDetours from '../dist/diversion-policy.js';
import * as map from '../dist/06_Karte.js';
import * as oldMap from '../dist/cartography.js';

test('six owner modules provide all legacy exports',()=>{
 for(const [name,central,legacy] of [
  ['network',road,oldRoad],['traffic',traffic,oldTraffic],
  ['physics',physics,oldPhysics],['events',events,oldEvents],
  ['diversions',detours,oldDetours],['map',map,oldMap]
 ]){
  for(const [key,value] of Object.entries(legacy)){
   assert.ok(key in central, name+': missing '+key);
   assert.equal(central[key],value,name+': '+key+' changed');
  }
 }
 assert.ok(road.networkData.roads.length>300);
 assert.ok(road.extensionRoutes.length>0);
});
