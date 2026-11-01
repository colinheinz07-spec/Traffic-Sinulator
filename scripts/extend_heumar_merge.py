"""Complete the Heumar shared A3/A4 carriageway up to the A59 merge."""
import json,collections
from extend_heumar_camberg import ROOT,read_data,pt,dist,walk,grouped
source=json.loads((ROOT/'data/a59-a560-osm.json').read_text())
data=read_data();ways=[e for e in source['elements'] if e['type']=='way' and e.get('tags',{}).get('highway')=='motorway' and 'A 3' in e['tags'].get('ref','').split(';')]
for key in ['A3-koeln','A3-frankfurt']:
 own=[r for r in data['roads'] if r['road']==key];counts=collections.Counter(tuple(p) for r in own for p in [r['points'][0],r['points'][-1]])
 start=max(p for p,n in counts.items() if n==1)
 if start[0]>=50.9315:continue
 graph=collections.defaultdict(list)
 for w in ways:
  ps=list(map(pt,w['geometry']))
  if key=='A3-frankfurt':ps.reverse()
  for a,b in zip(ps,ps[1:]):graph[a].append((b,w))
 for w,points in grouped(walk(graph,start,lambda p:p[0]>=50.9315)):
  if key=='A3-frankfurt':points.reverse()
  length=sum(dist(a,b) for a,b in zip(points,points[1:]))/1000
  old=next((r for r in own if r['wayId']==w['id']),None)
  if old:
   a=list(map(tuple,old['points']))
   if a[-1]==points[0]:old['points']=a+points[1:]
   elif points[-1]==a[0]:old['points']=points+a[1:]
   else:raise ValueError('Ambiguous Heumar chain')
   old['km']+=length
  else:
   r=dict(id='A3-'+str(w['id']),wayId=w['id'],road=key,lanes=3,km=length,posKm=max(r['posKm'] for r in own)+1,points=points,tags={**w['tags'],'ref':'A 3'})
   own.append(r);data['roads'].append(r)
(ROOT/'src/geodata.ts').write_text("import type {MapData} from './core.js';\nexport const networkData:MapData="+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n')
