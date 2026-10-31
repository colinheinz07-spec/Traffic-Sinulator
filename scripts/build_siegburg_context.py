"""Retain all eight normal interchange paths as exact OSM node walks."""
import json,collections,heapq
from pathlib import Path
from extend_heumar_camberg import pt,dist,walk,grouped,read_data
ROOT=Path(__file__).resolve().parents[1]
x=json.loads((ROOT/'data/a3-heumar-camberg-osm.json').read_text())
main={r['road']:{tuple(p) for w in read_data()['roads'] if w['road']==r['road'] for p in w['points']} for r in read_data()['roads'] if r['road'].startswith('A3')}
a560=[w for w in x['elements'] if w['type']=='way' and w.get('tags',{}).get('highway')=='motorway' and w['tags'].get('ref','').replace(' ','')=='A560']
for name,east in [('A560-hennef',True),('A560-bonn',False)]:
 main[name]={pt(p) for w in a560 if (w['geometry'][-1]['lon']>w['geometry'][0]['lon'])==east for p in w['geometry']}
graph=collections.defaultdict(list)
links=[w for w in x['elements'] if w['type']=='way' and (w.get('tags',{}).get('highway')=='motorway_link' or w.get('tags',{}).get('construction')=='motorway_link') and any(50.765<p['lat']<50.792 and 7.218<p['lon']<7.256 for p in w.get('geometry',[]))]
for w in links:
 points=[pt(p) for p in w['geometry']]
 if w['tags'].get('oneway')=='-1':points.reverse()
 for a,b in zip(points,points[1:]):graph[a].append((b,w))
features=[];ramps=[]
for source in main:
 for target in main:
  if source.startswith('A3')==target.startswith('A3'):continue
  candidates=[]
  for start in main[source]&set(graph):
   try:
    edges=walk(graph,start,lambda p:p in main[target])
    if edges:candidates.append((sum(dist(a,b) for a,b,w in edges),edges))
   except ValueError:pass
  if not candidates:raise ValueError('Missing normal interchange movement '+source+' -> '+target)
  _,edges=min(candidates,key=lambda q:q[0]);points=[edges[0][0]]+[e[1] for e in edges];ways=list(dict.fromkeys(e[2]['id'] for e in edges))
  ramps.append({'id':'siegburg-'+source+'-to-'+target,'from':source,'to':target,'points':points,'wayIds':ways,'lanes':min(int(e[2]['tags'].get('lanes','1')) for e in edges)})
for w in a560:
 if not any(7.205<=p['lon']<=7.275 for p in w['geometry']):continue
 features.append({'wayId':w['id'],'kind':'motorway','lanes':2,'points':[pt(p) for p in w['geometry']]})
for r in ramps:features.append({'wayId':r['wayIds'][0],'kind':'ramp','lanes':r['lanes'],'points':r['points'],'name':r['from']+' → '+r['to']})
(ROOT/'data/siegburg-connections.json').write_text(json.dumps({'sourceTimestamp':x['osm3s']['timestamp_osm_base'],'connections':ramps},separators=(',',':'))+'\n')
(ROOT/'src/siegburg-context.ts').write_text("import type {Point} from './core.js';\nexport const siegburgContext:{wayId:number;kind:string;lanes:number;points:Point[];name?:string}[]="+json.dumps(features,separators=(',',':'))+';\n')
print('Verified directional connections',len(ramps),'features',len(features))
