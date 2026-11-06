import test from 'node:test';
import {networkData} from '../dist/geodata.js';
import {extensionRoutes,extensionJunctions,extensionRampBoundaryPoints} from '../dist/network-extensions.js';
import {makeCorridors} from '../dist/spatial.js';
import {MOTORWAY_ROUTE_KEYS} from '../dist/network-catalog.js';
import {directionNetworkAudit} from '../dist/01_Strassennetz/netzdiagnose.js';
import {buildExtensionConnections} from '../dist/extension-connections.js';

test('audit raw imported OSM ramp endpoints and local junction bindings (diagnostic)',()=>{
 const routes=makeCorridors(networkData.roads,networkData.ramps),
   exits=[...networkData.exits,...extensionJunctions];
 const out=[];
 for(const key of MOTORWAY_ROUTE_KEYS){
  const a=directionNetworkAudit(key,routes,exits);
  out.push({key,km:Math.round(a.lengthKm),as:a.ordinaryJunctions,bound:a.accesses.reduce((n,x)=>n+Number(x.entry==='bound')+Number(x.exit==='bound'),0),
   missing:a.accesses.filter(x=>x.entry==='review'||x.exit==='review').map(x=>x.ref+' '+x.name+': '+(x.entry==='review'?'E':'')+(x.exit==='review'?'X':'')),
   directLinks:a.exactMainlineLinks});
 }
 console.log('OSM_NETWORK_AUDIT='+JSON.stringify(out));
 const links=buildExtensionConnections(routes);
 const boundary=new Set(extensionRampBoundaryPoints.map(p=>p.join(',')));
 const orphan=extensionRoutes.filter(r=>r.kind==='ramp'&&!links.some(l=>l.rampId===r.id))
  .map(r=>({id:r.id,zone:r.zone,first:r.points[0],last:r.points.at(-1),
   boundaryStart:boundary.has(r.points[0].join(',')),boundaryEnd:boundary.has(r.points.at(-1).join(','))}));
 console.log('OSM_ORPHAN_RAMPS='+JSON.stringify({total:orphan.length,all:orphan.slice(0,90)}));
 const shallow=extensionRoutes.filter(r=>r.kind==='ramp').map(r=>({
  id:r.id,zone:r.zone,first:r.points[0],last:r.points.at(-1),
  firstMatch:[...MOTORWAY_ROUTE_KEYS].filter(k=>routes[k].points.some(p=>p[0]===r.points[0][0]&&p[1]===r.points[0][1])),
  lastMatch:[...MOTORWAY_ROUTE_KEYS].filter(k=>routes[k].points.some(p=>p[0]===r.points.at(-1)[0]&&p[1]===r.points.at(-1)[1]))
 })).filter(r=>r.zone.startsWith('A3 AS')||r.zone.startsWith('A48 AS')||r.zone.startsWith('A59 AS')).slice(0,45);
 console.log('OSM_SAMPLE_RAMPS='+JSON.stringify(shallow));
});
