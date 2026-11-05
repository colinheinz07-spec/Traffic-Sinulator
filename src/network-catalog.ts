/**
 * Data-driven route registry. Traffic rules consume these descriptors instead
 * of inspecting motorway numbers or maintaining parallel hard-coded path lists.
 *
 * Existing A3/A48 observations remain explicitly calibrated legacy DATA.
 * Adding a generated ExtensionRoute registers it automatically.
 */
import {networkData} from './geodata.js';
import {names,type MapData} from './core.js';
import {extensionRoutes,type ExtensionRoute} from './network-extensions.js';
import {normalThroughLanes} from './lane-info.js';
import {REFERENCE_PEAKS} from './traffic-profiles.js';

export type RouteKind='motorway'|'ramp';
export interface RouteDescriptor {
 key:string; motorway:string|null; kind:RouteKind; lanes:number;
 freeKmh:number; demandVph:number; label:string; source:'legacy'|'extension';
 /** Direction of imported legacy OSM chain, if explicitly calibrated. */
 geometryOrder?:'east'|'west';
 /** A scenario parameter, not a measured or universal truck fraction. */
 heavyShare?:number;
}
const legacyDemand:Readonly<Record<string,number>>={
 'A3-koeln':4200,'A3-frankfurt':4100,
 'A48-dernbach':2400,'A48-koblenz':1700,
 'ramp-a3-to-a48-from-frankfurt':1000,'ramp-a48-to-koeln':1000,
 'ramp-a3-to-a48-from-koeln':700,'ramp-a48-to-frankfurt':1400
};
const preferredLegacyOrder=[
 'A3-koeln','A3-frankfurt','A48-dernbach','A48-koblenz',
 'ramp-a3-to-a48-from-frankfurt','ramp-a48-to-koeln',
 'ramp-a3-to-a48-from-koeln','ramp-a48-to-frankfurt'
];
/** OSM motorway ref, not the name of an exit, ramp, region or junction. */
export function motorwayRef(value:string):string|null{
 const match=value.replaceAll(' ','').match(/^A\d{1,3}(?!\d)/i);
 return match?match[0].toUpperCase():null;
}
function commonLaneCount(values:readonly number[]):number{
 const counts=new Map<number,number>();
 for(const n of values)if(Number.isInteger(n)&&n>0)counts.set(n,(counts.get(n)??0)+1);
 const ordered=[...counts].sort((a,b)=>b[1]-a[1]||a[0]-b[0]);
 return ordered[0]?.[0]??1;
}
/** Generate a complete registry from supplied OSM data; no global registry
 * edits are required to import and validate a newly added motorway. */
export function createRouteCatalog(
 data:Pick<MapData,'roads'|'ramps'>,
 additions:readonly ExtensionRoute[]
):RouteDescriptor[]{
 const heavyByMotorway:Readonly<Record<string,number>>={'A3':.23,'A48':.16};
 const heavy=(road:string|null):number=>road===null ? 0.15 : (heavyByMotorway[road]??0.15);
 const knownDirections:Readonly<Record<string,'east'|'west'>>={
  'A3-koeln':'west','A3-frankfurt':'east',
  'A48-dernbach':'east','A48-koblenz':'west'
 };
 const motorways=[...new Set(data.roads.map(r=>r.road))].map(key=>{
  const roads=data.roads.filter(r=>r.road===key);
  const lanes=commonLaneCount(roads.map(normalThroughLanes));
  const input=roads.find(r=>r.referenceDemandVph!==undefined)?.referenceDemandVph;
  // Uncalibrated imports use a declared scenario assumption; never present
  // these figures as measured flows or silently simulate an empty road.
  const initialDemand=legacyDemand[key]??REFERENCE_PEAKS[key]??input??Math.min(8000,lanes*1050);
  return {key,motorway:motorwayRef(key),kind:'motorway' as const,
   lanes,freeKmh:130,
   demandVph:initialDemand,
   label:names[key]??key,source:'legacy' as const,heavyShare:heavy(motorwayRef(key)),
   geometryOrder:knownDirections[key]};
 });
 const ramps=data.ramps.map(r=>({
  key:r.id,motorway:null,kind:'ramp' as const,lanes:r.lanes,freeKmh:80,
  demandVph:legacyDemand[r.id]??r.referenceDemandVph??r.lanes*400,label:r.name,heavyShare:.15,source:'legacy' as const
 }));
 const legacy=[...motorways,...ramps].sort((a,b)=>{
  const ia=preferredLegacyOrder.indexOf(a.key),ib=preferredLegacyOrder.indexOf(b.key);
  return (ia<0?Infinity:ia)-(ib<0?Infinity:ib);
 });
 const extensions=additions.map(r=>({
  key:r.id,motorway:r.kind==='motorway'
   ?motorwayRef(r.name)??motorwayRef(r.id.replace(/^extra-/,'').toUpperCase()):null,
  kind:r.kind,lanes:r.lanes,freeKmh:r.freeKmh,
  demandVph:REFERENCE_PEAKS[r.id]??r.demandVph,
  label:r.name,heavyShare:heavy(r.kind==='motorway'?motorwayRef(r.name):null),source:'extension' as const
 }));
 return [...legacy,...extensions];
}
export const ROUTE_CATALOG:readonly RouteDescriptor[]=createRouteCatalog(networkData,extensionRoutes);
const routes=new Map(ROUTE_CATALOG.map(r=>[r.key,r]));
/** Lookup is O(1), independent of how many roads are imported. */
export function routeDescriptor(key:string):RouteDescriptor|undefined{return routes.get(key);}
export const LEGACY_ROUTE_KEYS:readonly string[]=ROUTE_CATALOG.filter(r=>r.source==='legacy').map(r=>r.key);
export const NETWORK_ROUTE_KEYS:readonly string[]=ROUTE_CATALOG.map(r=>r.key);
export const MOTORWAY_ROUTE_KEYS:readonly string[]=ROUTE_CATALOG.filter(r=>r.kind==='motorway').map(r=>r.key);
export const MOTORWAY_REFS:readonly string[]=[...new Set(ROUTE_CATALOG.filter(r=>r.kind==='motorway').map(r=>r.motorway).filter((r):r is string=>r!==null))]
 .sort((a,b)=>Number(a.slice(1))-Number(b.slice(1)));
/** Fails early on broken imports instead of silently assigning a new road to A3. */
export function validateRouteCatalog(catalog:readonly RouteDescriptor[]=ROUTE_CATALOG):string[]{
 const errors:string[]=[],seen=new Set<string>();
 for(const route of catalog){
  if(!route.key||seen.has(route.key))errors.push('Doppelte/fehlende Routen-ID: '+route.key);
  seen.add(route.key);
  if(route.kind==='motorway'&&!route.motorway)errors.push('Autobahnreferenz fehlt: '+route.key);
  if(!Number.isInteger(route.lanes)||route.lanes<1||route.lanes>8)errors.push('Fahrstreifen ungültig: '+route.key);
  if(!Number.isFinite(route.demandVph)||route.demandVph<0)errors.push('Nachfrage ungültig: '+route.key);
  if(!Number.isFinite(route.freeKmh)||route.freeKmh<=0)errors.push('Freie Geschwindigkeit ungültig: '+route.key);
 }
 return errors;
}
