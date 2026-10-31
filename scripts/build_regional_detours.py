"""Connect added regional AS over exact retained local OSM street edges."""
import json,collections
from pathlib import Path
from extend_heumar_camberg import read_data,pt,dist,walk
ROOT=Path(__file__).resolve().parents[1]
data=read_data();source=json.loads((ROOT/'data/a3-heumar-camberg-osm.json').read_text());graph=collections.defaultdict(list);street=set();incoming=collections.defaultdict(list)
main={path:{tuple(p):0 for r in data['roads'] if r['road']==path for p in r['points']} for path in ['A3-koeln','A3-frankfurt']}
for way in source['elements']:
 if way['type']!='way':continue
 tags=way.get('tags',{});kind=tags.get('highway','')
 if kind in ['motorway','construction'] or tags.get('access')=='private' or tags.get('motor_vehicle')=='no':continue
 points=[pt(p) for p in way.get('geometry',[])];
 if kind!='motorway_link':street.update(points)
 directed=tags.get('oneway') in ['yes','1','-1']
 if tags.get('oneway')=='-1':points.reverse()
 for a,b in zip(points,points[1:]):
  graph[a].append((b,way));incoming[b].append(a)
  if not directed:graph[b].append((a,way));incoming[a].append(b)
records=[]
for path,refs in [('A3-koeln',['33','31','30b','30a','29']),('A3-frankfurt',['29','30a','30b','31','33']),('A3-koeln',['44','43']),('A3-frankfurt',['43','44'])]:
 exits={e['ref']:e for e in data['exits'] if e['road']=='A3'}
 for i,ref in enumerate(refs):
  e=exits[ref];access=e.get('access',{}).get(path,{'exit':True,'entry':True})
  if not access['exit']:continue
  start=tuple(e['directional'][path]['position'])
  for target in refs[i+1:]:
   dest=exits[target]
   if not dest.get('access',{}).get(path,{'entry':True})['entry']:continue
   nominal=tuple(dest['directional'][path]['position'])
   goals={p for p in main[path] if p in incoming and any(a not in main[path] for a in incoming[p]) and dist(p,nominal)<1800}
   # A directional entry-only node is already the verified merge.
   if dest.get('access',{}).get(path,{}).get('exit') is False:goals={nominal}
   edges=walk(graph,start,lambda p:p in goals)
   points=[edges[0][0]]+[edge[1] for edge in edges]
   records.append({'path':path,'from':ref,'to':target,'points':points,'wayIds':list(dict.fromkeys(w['id'] for a,b,w in edges))})
# An outside-network journey ends on the local road, not at an imaginary
# re-entry after the last regular exit.
for path,last,refs in [('A3-koeln','29',['33','31','30a','29']),('A3-frankfurt','44',['43','44'])]:
 e=next(e for e in data['exits'] if e['road']=='A3' and e['ref']==last);start=tuple(e['directional'][path]['position'])
 terminal=walk(graph,start,lambda p:p in street)[-1][1]
 for ref in refs:
  e=next(e for e in data['exits'] if e['road']=='A3' and e['ref']==ref)
  if not e.get('access',{}).get(path,{'exit':True})['exit']:continue
  start=tuple(e['directional'][path]['position']);edges=walk(graph,start,lambda p:p==terminal)
  points=[edges[0][0]]+[edge[1] for edge in edges]
  records.append({'path':path,'from':ref,'to':'end-'+path,'points':points,'wayIds':list(dict.fromkeys(w['id'] for a,b,w in edges))})
payload={'sourceTimestamp':source['osm3s']['timestamp_osm_base'],'routes':records}
(ROOT/'data/regional-detours.json').write_text(json.dumps(payload,separators=(',',':'))+'\n')
(ROOT/'src/regional-detours.ts').write_text("import type {Point} from './core.js';\nexport const regionalDetours:{path:string;from:string;to:string;points:Point[];wayIds:number[]}[]="+json.dumps(records,separators=(',',':'))+';\n')
print('Exact local routes',len(records))
