import test from 'node:test';
import assert from 'node:assert/strict';
import {networkData} from '../dist/geodata.js';
import {extensionJunctions} from '../dist/network-extensions.js';
import {buildExtensionConnections} from '../dist/extension-connections.js';
import {makeCorridors,emptySpatial,advanceSpatial} from '../dist/spatial.js';
import {initialiseCells} from '../dist/traffic-cells.js';
import {trafficView} from '../dist/traffic-view.js';
import {defaultDemands} from '../dist/traffic.js';

const routes=makeCorridors(networkData.roads,networkData.ramps);
const exits=[...networkData.exits,...extensionJunctions];

test('vacant blocked motorway and vacant work zones have no invented red or orange map band',()=>{
 const path='A3-koeln',state=initialiseCells(routes[path],0);
 const event={id:'vacant',pathKey:path,kind:'accident',point:routes[path].points[Math.floor(routes[path].points.length/2)],
  laneCount:3,closedLanes:[0,1,2],createdAt:'2026-11-01T18:00:00Z',settings:{lengthM:300,speedKmh:0,shoulder:'blocked'}};
 const mapped=trafficView([],{[path]:state},routes,[event],[],0);
 assert.deepEqual(mapped.bands.get(path),[]);
 assert.equal(mapped.reports[path].queueKm,0);
});

test('a real occupied stopped road cell has a continuous dark-red physical status',()=>{
 const path='A3-koeln',state=initialiseCells(routes[path],0),cell=state.cells[30];
 cell.vehicles=20;cell.densityVehKm=20/((cell.toM-cell.fromM)/1000);cell.speedKmh=0;
 const mapped=trafficView([],{[path]:state},routes,[],[],1);
 assert.ok(mapped.bands.get(path).some(b=>b.color==='standstill'&&b.fromM<=cell.fromM&&b.toM>=cell.toM));
});

test('verified A59/A562 junction transfers downstream physical congestion into the actual connector ramp',()=>{
 const links=buildExtensionConnections(routes);
 const link=links.find(l=>l.from==='extra-a59-bonn'&&l.to==='extra-a562-bonn');
 assert.ok(link,'expected verified Bonn motorway connector');
 const route=routes[link.rampId],target=routes[link.to];
 const anchorM=Math.min(target.lengthM-1,link.downstreamMergeM+200);
 const parent={id:'target-block',pathKey:link.to,eventKind:null,point:target.points.at(-1),
  anchorM,queueVehicles:65,queueM:400,visibleQueueM:400,delayMin:null,
  capacityVph:0,speedKmh:0,color:'standstill',released:false,outOfBoundsM:0};
 assert.ok(parent.anchorM>link.downstreamMergeM&&parent.anchorM-parent.queueM<link.downstreamMergeM);
 const demands={...defaultDemands(),[link.rampId]:1200};
 const next=advanceSpatial(emptySpatial(),[],demands,1,routes,links,[],exits,[parent],[link.rampId]);
 assert.ok(next.queues['merge:'+link.rampId]?.vehicles>0,'congested downstream merge retains real ramp arrivals');
});
