"""Retain selectable A560 and Heumar paths as exact directed OSM walks."""
import json,collections,re,math
from pathlib import Path
from extend_heumar_camberg import pt,dist,walk
ROOT=Path(__file__).resolve().parents[1]
x=json.loads((ROOT/'data/a3-heumar-camberg-osm.json').read_text())
ways=[w for w in x['elements'] if w['type']=='way' and w.get('geometry')]
features=[]
def add(key,name,zone,kind,parts):
 points=[];lanes=[];ids=[]
 for w,ps in parts:
  if points and points[-1]!=ps[0]:raise ValueError('Disconnected path '+key)
  points+=ps[1:] if points else ps;lanes.append(int(w.get('tags',{}).get('lanes','1')));ids.extend(w.get('wayIds',[w['id']]))
 if len(points)<2:return
 features.append(dict(id=key,name=name,zone=zone,kind=kind,lanes=min(lanes),points=points,wayIds=list(dict.fromkeys(ids)),
  demandVph=1400 if kind=='motorway' else 500*min(lanes),freeKmh=130 if kind=='motorway' else 80))
a560=[w for w in ways if w.get('tags',{}).get('highway')=='motorway' and w['tags'].get('ref','').replace(' ','')=='A560']
graph=collections.defaultdict(list);incoming=collections.Counter()
for w in a560:
 ps=[pt(p) for p in w['geometry']]
 if w['tags'].get('oneway')=='-1':ps.reverse()
 for a,b in zip(ps,ps[1:]):graph[a].append((b,w));incoming[b]+=1
starts=[p for p in graph if not incoming[p]];ends={p for p in incoming if not graph[p]}
candidates=[]
for start in starts:
 try:
  edges=walk(graph,start,lambda p:p in ends)
  if edges:candidates.append(edges)
 except ValueError:pass
for east,key,label in [(True,'extra-a560-hennef','A560 → Hennef'),(False,'extra-a560-bonn','A560 → Bonn / Sankt Augustin')]:
 options=[e for e in candidates if (e[-1][1][1]>e[0][0][1])==east]
 edges=max(options,key=lambda es:sum(dist(a,b) for a,b,w in es));parts=[]
 for a,b,w in edges:
  if parts and parts[-1][0]['id']==w['id']:parts[-1][1].append(b)
  else:parts.append((w,[a,b]))
 add(key,label,'AK Bonn/Siegburg','motorway',parts)
for r in json.loads((ROOT/'data/siegburg-connections.json').read_text())['connections']:
 w={'id':r['wayIds'][0],'wayIds':r['wayIds'],'tags':{'lanes':str(r['lanes'])}}
 add('extra-'+r['id'],r['from'].replace('A3-frankfurt','A3 Frankfurt').replace('A3-koeln','A3 Köln').replace('A560-hennef','A560 Hennef').replace('A560-bonn','A560 Bonn')+' → '+r['to'].replace('A3-frankfurt','A3 Frankfurt').replace('A3-koeln','A3 Köln').replace('A560-hennef','A560 Hennef').replace('A560-bonn','A560 Bonn'),'AK Bonn/Siegburg','ramp',[(w,[tuple(p) for p in r['points']])])
links=[]
for w in ways:
 if w.get('tags',{}).get('highway')!='motorway_link':continue
 if not any(50.895<=p['lat']<=50.936 and 7.045<=p['lon']<=7.087 for p in w['geometry']):continue
 ps=[pt(p) for p in w['geometry']]
 if w['tags'].get('oneway')=='-1':ps.reverse()
 links.append((w,ps))
byStart=collections.defaultdict(list);byEnd=collections.defaultdict(list)
for i,(w,ps) in enumerate(links):byStart[ps[0]].append(i);byEnd[ps[-1]].append(i)
used=set()
for seed in range(len(links)):
 if seed in used:continue
 start=seed;back=set()
 while len(byEnd[links[start][1][0]])==1:
  prev=byEnd[links[start][1][0]][0]
  if prev in used or prev in back or len(byStart[links[prev][1][-1]])!=1:break
  back.add(start);start=prev
 parts=[];i=start
 while i not in used:
  used.add(i);parts.append(links[i]);end=links[i][1][-1]
  if len(byEnd[end])!=1 or len(byStart[end])!=1:break
  i=byStart[end][0]
 tags=[w.get('tags',{}) for w,ps in parts]
 dest=next((t.get('destination') for t in reversed(tags) if t.get('destination')),None)
 ref=next((t.get('destination:ref',t.get('ref')) for t in reversed(tags) if t.get('destination:ref',t.get('ref'))),None)
 zone='AD Köln-Heumar' if max(p[0] for w,ps in parts for p in ps)>=50.912 else 'Heumar / A59-Umfeld'
 label=('Heumar · Überleitung' if zone=='AD Köln-Heumar' else 'Heumar-Umfeld · Überleitung')+(' → '+(ref or '')+(' · ' if ref and dest else '')+(dest or '') if ref or dest else ' '+str(parts[0][0]['id']))
 add('extra-heumar-'+str(parts[0][0]['id']),label,zone,'ramp',parts)
ids=[f['id'] for f in features]
text="import type {Point} from './core.js';\nexport const EXTENSION_IDS="+json.dumps(ids)+" as const;\nexport type ExtensionId=typeof EXTENSION_IDS[number];\nexport interface ExtensionRoute {id:ExtensionId;name:string;zone:string;kind:'motorway'|'ramp';lanes:number;points:Point[];wayIds:number[];demandVph:number;freeKmh:number}\nexport const extensionRoutes:ExtensionRoute[]="+json.dumps(features,separators=(',',':'))+";\nconst byId=new Map<string,ExtensionRoute>(extensionRoutes.map(r=>[r.id,r]));\nexport const extensionRoute=(id:string)=>byId.get(id);\n"
(ROOT/'src/network-extensions.ts').write_text(text)
print('Generated',len(features),'directed extension paths;',sum(len(f['points']) for f in features),'original vertices')
