"""Retain motorway-only Porz–Gremberg–Heumar bypasses on exact OSM edges."""
import json,collections
from extend_heumar_camberg import ROOT,pt,dist,walk
bundle=json.loads((ROOT/'data/extension-junctions.json').read_text());features={r['id']:r for r in bundle['routes']}
ways=list({w['id']:w for f in ['a3-heumar-camberg-osm.json','a59-a560-osm.json','cologne-triangle-osm.json'] for w in json.loads((ROOT/'data'/f).read_text())['elements'] if w['type']=='way' and w.get('geometry')}.values())
records=[]
for key,ref,targetref,start,end in [
 ('extra-a59-koeln','33','31',features['extra-a559-gremberg']['points'][0],features['extra-a4-olpe']['points'][-1]),
 ('extra-a59-bonn','31','33',features['extra-a4-aachen']['points'][0],features['extra-a559-porz']['points'][-1])]:
 source=features[key];owned={(tuple(a),tuple(b)) for a,b in zip(source['points'],source['points'][1:])};g=collections.defaultdict(list)
 for w in ways:
  t=w.get('tags',{})
  if t.get('highway') not in ['motorway','motorway_link'] or t.get('access') in ['private','no'] or t.get('motor_vehicle') in ['private','no']:continue
  ps=list(map(pt,w['geometry']))
  if not any(50.89<p[0]<50.94 and 7.0<p[1]<7.09 for p in ps):continue
  if t.get('oneway')=='-1':ps.reverse()
  for a,b in zip(ps,ps[1:]):
   if (a,b) not in owned:g[a].append((b,w))
 edges=walk(g,tuple(start),lambda p:p==tuple(end));points=[edges[0][0]]+[b for a,b,w in edges]
 length=sum(dist(a,b) for a,b,w in edges);minutes=sum(dist(a,b)/1000/(70 if w['tags']['highway']=='motorway_link' else 110)*60 for a,b,w in edges)
 capacity=min(int(w['tags'].get('lanes','1'))*(1500 if w['tags']['highway']=='motorway_link' else 2000) for a,b,w in edges)
 legs=[]
 for other,f in features.items():
  if other==key or f['kind']!='motorway':continue
  vertices={tuple(p):i for i,p in enumerate(f['points'])};used=[(vertices[a],vertices[b]) for a,b,w in edges if a in vertices and b in vertices]
  if used:legs.append(dict(path=other,fromPoint=f['points'][min(min(a,b) for a,b in used)],toPoint=f['points'][max(max(a,b) for a,b in used)]))
 records.append(dict(id='RING-'+key,path=key,targetPath=('A3-koeln' if key=='extra-a59-koeln' else key),fromRef=ref,toRef=targetref,fromPoint=start,toPoint=end,points=points,wayIds=list(dict.fromkeys(w['id'] for a,b,w in edges)),lengthKm=length/1000,freeMinutes=minutes,motorway=True,exitIsInterchange=True,motorwayBypass=True,capacityVph=capacity,legs=legs))
 print(key,'via',[l['path'] for l in legs],round(length/1000,2),'km',capacity,'veh/h')
(ROOT/'src/ring-detours-data.ts').write_text("import type {ExtensionDetour} from './extension-detours-data.js';\nexport const ringDetours:ExtensionDetour[]="+json.dumps(records,separators=(',',':'))+';\n')
