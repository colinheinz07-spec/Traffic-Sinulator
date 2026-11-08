/** Regenerate the short, real public-street parts between motorway ramps at AS.
 * This is a cartographic connector, not a simulated motorway or a detour.
 * Uses exact OSM node IDs and consecutive public-road way geometry only.
 * node scripts/build_public_access_connectors.mjs [--check]
 * © OpenStreetMap contributors (ODbL).
 */
import {readFileSync,writeFileSync} from 'node:fs';
const SOURCES=[
 'a3-heumar-camberg-osm.json','a3-wiesbaden-osm.json','a4-koeln-sued-osm.json',
 'a4-koeln-west-osm.json','a555-a565-bonn-osm.json','bonn-a59-a562-osm.json',
 'a59-a560-osm.json','cologne-triangle-osm.json'
];
const ROOT=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,ROOT),'utf8');
const ts=(source,prefix)=>JSON.parse(source.split(prefix,2)[1].split(';\n',1)[0]);
const ext=read('src/network-extensions.ts'),geo=read('src/geodata.ts');
const additional=read('src/01_Strassennetz/osm-zusatzrampen.ts');
const features=ts(ext,'export const extensionRoutes:ExtensionRoute[]=');
const extra=ts(additional,'export const verifiedOsmAdditionalRoutes:VerifiedOsmLink[]=');
const network=ts(geo,'export const networkData:MapData=');
const imported=new Set([...features,...extra,...network.ramps].flatMap(r=>r.wayIds));
const exits=[...network.exits,...ts(ext,'export const extensionJunctions:Exit[]=')]
 .filter(j=>!j.name.startsWith('AK ')&&!j.name.startsWith('AD '));
const distance=(a,b)=>111195*Math.hypot(a[0]-b[0],
 (a[1]-b[1])*Math.cos((a[0]+b[0])*Math.PI/360));
function centre(j){
 const values=Object.values(j.directional??{}).filter(v=>v.position&&v.nodeId>0).map(v=>v.position);
 if(!values.length)return j.position;
 const spread=Math.max(0,...values.flatMap(p=>values.map(q=>distance(p,q))));
 if(spread>450)return values.reduce((best,p)=>distance(p,j.position)<distance(best,j.position)?p:best,values[0]);
 return [values.reduce((n,p)=>n+p[0],0)/values.length,values.reduce((n,p)=>n+p[1],0)/values.length];
}
const centres=exits.map(j=>({name:j.road+' AS '+j.ref+' '+j.name,pt:centre(j)}));
const PUBLIC=new Set(['trunk','trunk_link','primary','primary_link','secondary','secondary_link',
 'tertiary','tertiary_link','residential','unclassified','living_street']);
const BANNED=new Set(['no','private']);
const ways=new Map();
for(const file of SOURCES){
 const raw=JSON.parse(read('data/'+file));
 for(const w of raw.elements)if(w.type==='way'&&w.nodes?.length>=2&&
  w.geometry?.length===w.nodes.length&&w.tags?.highway){
   const old=ways.get(w.id);
   if(!old||w.geometry.length>old.geometry.length)ways.set(w.id,w);
  }
}
const streets=[...ways.values()].filter(w=>PUBLIC.has(w.tags.highway)&&
 !['access','motor_vehicle','motorcar'].some(k=>BANNED.has(w.tags[k])));
const ramps=[...ways.values()].filter(w=>w.tags.highway==='motorway_link'&&imported.has(w.id));
const graph=new Map(),coords=new Map();
for(const w of streets)for(let i=1;i<w.nodes.length;i++){
 const u=w.nodes[i-1],v=w.nodes[i],p=w.geometry[i-1],q=w.geometry[i];
 coords.set(u,[p.lat,p.lon]);coords.set(v,[q.lat,q.lon]);
 const length=distance([p.lat,p.lon],[q.lat,q.lon]);if(length<=.2||length>250)continue;
 for(const [from,to] of [[u,v],[v,u]]){
  const a=graph.get(from)??[];a.push({to,id:w.id,index:i-1,length});graph.set(from,a);
 }
}
const terminals=new Map();
for(const w of ramps)for(const node of w.nodes)if(graph.has(node)){
 const t=terminals.get(node)??{id:node,ways:new Set()};
 t.ways.add(w.id);terminals.set(node,t);
}
const groups=new Map();
for(const t of terminals.values()){
 const p=coords.get(t.id);if(!p)continue;
 let best=null,d=1200;
 for(const c of centres){const gap=distance(p,c.pt);if(gap<d){d=gap;best=c}}
 if(!best)continue;
 const a=groups.get(best.name)??[];a.push(t);groups.set(best.name,a);
}
function from(start,targets,cap=650){
 const q=[[0,start]],seen=new Map(),prev=new Map(),found=new Map();let loops=0;
 while(q.length&&loops++<4500){
  q.sort((a,b)=>b[0]-a[0]);
  const [d,node]=q.pop();if(d>cap)break;if(seen.has(node))continue;
  seen.set(node,d);
  if(node!==start&&targets.has(node)){
   const edges=[];let at=node;
   while(at!==start){const e=prev.get(at);if(!e){edges.length=0;break}edges.unshift(e);at=e.from}
   if(edges.length)found.set(node,{distance:d,edges});
  }
  for(const e of graph.get(node)??[]){
   if(seen.has(e.to)||d+e.length>cap)continue;
   const old=prev.get(e.to);
   if(!old||d+e.length<old.total){
    prev.set(e.to,{from:node,id:e.id,index:e.index,total:d+e.length});
    q.push([d+e.length,e.to]);
   }
  }
 }
 return found;
}
const selected=new Map();
for(const [name,terms] of groups){
 if(terms.length<2)continue;
 const byId=new Map(terms.map(t=>[t.id,t])),pairs=[];
 const targets=new Set(terms.map(t=>t.id));
 for(const t of terms)for(const [id,path] of from(t.id,targets)){
  if(id===t.id||t.id>id)continue;
  const other=byId.get(id);if(!other)continue;
  if(t.ways.size===1&&other.ways.size===1&&[...t.ways][0]===[...other.ways][0])continue;
  const straight=distance(coords.get(t.id),coords.get(id));
  if(straight>530||path.distance>650||path.distance>Math.max(100,2.4*straight))continue;
  pairs.push({a:t.id,b:id,...path});
 }
 pairs.sort((a,b)=>a.distance-b.distance||a.a-b.a||a.b-b.b);
 const parent=new Map(terms.map(t=>[t.id,t.id]));
 const find=x=>{while(parent.get(x)!==x)x=parent.get(x);return x};
 for(const pair of pairs){
  const a=find(pair.a),b=find(pair.b);if(a===b)continue;
  parent.set(a,b);
  for(const edge of pair.edges)selected.set(edge.id+':'+edge.index,{
   id:edge.id,index:edge.index,zone:name
  });
 }
}
const output=[];
for(const w of streets){
 let current=[],zone='';
 const flush=()=>{
  if(current.length>1)output.push({
   id:'access-osm-'+w.id+'-'+output.length,name:zone,sourceWayId:w.id,
   roadClass:w.tags.highway,points:current.map(p=>[p.lat,p.lon])
  });
  current=[];zone='';
 };
 for(let i=0;i<w.nodes.length-1;i++){
  const hit=selected.get(w.id+':'+i);
  if(!hit){flush();continue}
  if(current.length&&zone!==hit.zone)flush();
  if(!current.length){zone=hit.zone;current=[w.geometry[i],w.geometry[i+1]]}
  else current.push(w.geometry[i+1]);
 }
 flush();
}
const target='src/01_Strassennetz/osm-anschlussstrassen.ts';
const content=`/** Real OSM public-access street segments joining motorway_link arms at numbered junctions.
 * Generated from pinned data/*-osm.json snapshots. These are ordinary drivable
 * public streets, NOT motorway ramps; render only, do not create new traffic.
 * Only exact OSM node-to-node edges were imported (no fabricated interpolation).
 * Copyright OpenStreetMap contributors, ODbL.
 */
import type {Point} from '../core.js';
export interface PublicAccessConnector {id:string;name:string;sourceWayId:number;roadClass:string;points:Point[]}
export const publicAccessConnectors:PublicAccessConnector[]=${JSON.stringify(output)};
`;
if(process.argv.includes('--check')){
 if(read(target)!==content)throw Error('Public AS connectors outdated: run node scripts/build_public_access_connectors.mjs');
 console.log('OSM AS connectors verified:',output.length);
}else{
 writeFileSync(new URL(target,ROOT),content);
 console.log('Wrote',output.length,'real OSM public-street sections to',target);
}
