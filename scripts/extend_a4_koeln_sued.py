"""Extend both A4 carriageways to AK Köln-Süd and attach real A555/AS ramps.
Every retained segment uses source OSM directed nodes. Never bridge missing edges.
Run after build_network_extensions.py (or against its generated artifacts).
"""
import collections,heapq,json,math
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'data/a4-koeln-sued-osm.json'
assert source.exists(),'Fetch public OSM first: scripts/fetch_a4_koeln_sued.py'
package=json.loads((ROOT/'data/extension-junctions.json').read_text())
features=package['routes'];junctions=package['junctions']
oldtext=(ROOT/'src/network-extensions.ts').read_text()
boundary=json.loads(oldtext.split('export const extensionRampBoundaryPoints:Point[]=')[1].split(';')[0])
data=json.loads(source.read_text())['elements']
old=json.loads((ROOT/'data/cologne-triangle-osm.json').read_text())['elements']
items={(e['type'],e['id']):e for e in old+data}
ways=[e for e in items.values() if e['type']=='way' and e.get('geometry')]
nodes=[e for e in items.values() if e['type']=='node']
point=lambda p: (p['lat'],p['lon'])
def metres(a,b):
 return 111195*math.hypot(a[0]-b[0],(a[1]-b[1])*math.cos(math.radians((a[0]+b[0])/2)))
def norm(s):return s.replace(' ','').replace('BAB','A')
def allowed(w,ref,kind='motorway'):
 t=w.get('tags',{})
 return t.get('highway')==kind and ref in norm(t.get('ref','')).split(';')
def directed(w):
 ps=[point(p) for p in w['geometry']]
 return ps[::-1] if w.get('tags',{}).get('oneway')=='-1' else ps
def graphs(ww):
 g=collections.defaultdict(list);rev=collections.defaultdict(list)
 for w in ww:
  ps=directed(w)
  for a,b in zip(ps,ps[1:]):
   if a==b:continue
   g[a].append((b,w));rev[b].append((a,w))
 return g,rev
def walk(graph,start,goal,maxdist=25000):
 heap=[(0,start)];best={start:0};previous={}
 while heap:
  d,a=heapq.heappop(heap)
  if d>best[a]+1e-8:continue
  if goal(a):
   edges=[]
   while a!=start:
    b,w=previous[a];edges.append((b,a,w));a=b
   return edges[::-1]
  if d>maxdist:continue
  for b,w in graph.get(a,[]):
   v=d+metres(a,b)
   if v<best.get(b,float('inf')):
    best[b]=v;previous[b]=(a,w);heapq.heappush(heap,(v,b))
 return None
def length(edges):return sum(metres(a,b) for a,b,w in edges)
def grouped(edges):
 groups=[]
 for a,b,w in edges:
  if groups and groups[-1][0]['id']==w['id']:groups[-1][1].append(b)
  else:groups.append((w,[a,b]))
 return groups
def seg(w,points,offset):
 t=w.get('tags',{});raw=t.get('lanes:forward') or t.get('lanes') or '1'
 try: lanes=int(raw.split(';')[0])
 except ValueError:lanes=1
 lanes=max(1,min(3,lanes))
 return {'fromM':offset,'toM':offset+sum(metres(a,b) for a,b in zip(points,points[1:])), 'lanes':lanes}
def append_parts(feature,edges,front=False):
 if not edges:return
 groups=grouped(edges);newpoints=[];sections=[];distance=0;ids=[]
 for w,ps in groups:
  if newpoints and newpoints[-1]!=ps[0]:raise ValueError('Disconnected A4 extension')
  newpoints+=ps[1:] if newpoints else ps
  s=seg(w,ps,distance);distance=s['toM'];sections.append(s);ids.append(w['id'])
 if front:
  assert newpoints[-1]==tuple(feature['points'][0]),'A4 eastbound join differs from exact OSM'
  feature['points']=[list(p) for p in newpoints[:-1]]+feature['points']
  feature['laneSegments']=sections+[dict(s,fromM=s['fromM']+distance,toM=s['toM']+distance) for s in feature['laneSegments']]
  feature['wayIds']=list(dict.fromkeys(ids+feature['wayIds']))
 else:
  assert newpoints[0]==tuple(feature['points'][-1]),'A4 westbound join differs from exact OSM'
  feature['points']+= [list(p) for p in newpoints[1:]]
  oldlength=feature['laneSegments'][-1]['toM']
  feature['laneSegments'] += [dict(s,fromM=s['fromM']+oldlength,toM=s['toM']+oldlength) for s in sections]
  feature['wayIds']=list(dict.fromkeys(feature['wayIds']+ids))
def new_feature(key,name,kind,edges,zone,flow):
 assert edges and length(edges)>50,'Missing retained OSM road '+key
 groups=grouped(edges);points=[];sections=[];ids=[];offset=0
 for w,ps in groups:
  assert not points or points[-1]==ps[0],key+' is disconnected'
  points+=ps[1:] if points else ps
  s=seg(w,ps,offset);sections.append(s);offset=s['toM'];ids.append(w['id'])
 lanes=max(s['lanes'] for s in sections) if kind=='motorway' else min(s['lanes'] for s in sections)
 return {'id':key,'name':name,'zone':zone,'kind':kind,'lanes':lanes,'laneSegments':sections,
  'points':[list(p) for p in points],'wayIds':list(dict.fromkeys(ids)),'demandVph':flow if kind=='motorway' else max(250,lanes*550),
  'freeKmh':130 if kind=='motorway' else 80}
def junction(ref,road,name,position,source,dirkeys):
 old=next((j for j in junctions if j['road']==road and j['ref']==ref),None)
 if old is not None:
  j=old
 else:
  j={'road':road,'ref':ref,'name':name,'position':list(position),'source':source,'directional':{}}
  junctions.append(j)
 for f in dirkeys:
  near=min((tuple(p) for p in f['points']),key=lambda p:metres(p,position))
  node=next((n for n in nodes if point(n)==near),None)
  j.setdefault('directional',{})[f['id']]={'position':list(near),'nodeId':node['id'] if node else 0}
 return j
# Extend the two existing OSM carriageways in opposite directions. No fake bridge.
w4=[w for w in ways if allowed(w,'A4')]
g4,rev4=graphs(w4)
a4w=next(f for f in features if f['id']=='extra-a4-aachen')
a4e=next(f for f in features if f['id']=='extra-a4-olpe')
southwest=lambda p:p[1]<=6.963 and 50.875<p[0]<50.899
west=walk(g4,tuple(a4w['points'][-1]),southwest)
back=walk(rev4,tuple(a4e['points'][0]),southwest)
assert west and back,'OSM does not join both A4 directions to west side of AK Köln-Süd'
append_parts(a4w,west)
append_parts(a4e,[(b,a,w) for a,b,w in reversed(back)],True)
a4w['name']='A4 → Aachen / Köln-Süd'
a4e['name']='A4 → Olpe / Köln-Gremberg / Heumar'
a4w['zone']=a4e['zone']='A4 Köln-Gremberg–Köln-Süd'
assert 4200<length(west)<13000,('A4 westward extension',length(west))
assert 4200<length(back)<13000,('A4 eastward extension',length(back))
# Short genuine A555 motorway arms: south beyond AS Rodenkirchen, north to Köln-Bayenthal.
w555=[w for w in ways if allowed(w,'A555')]
g555,rev555=graphs(w555)
def a555_path(north):
 candidates=[p for p in g555 if 6.94<p[1]<7.006 and
             (50.853<p[0]<50.872 if north else 50.899<p[0]<50.918)]
 candidates.sort(key=lambda p:abs(p[0]-(50.855 if north else 50.916)))
 goal=(lambda p:50.905<p[0]<50.923) if north else (lambda p:50.851<p[0]<50.865)
 possibilities=[]
 for p in candidates[:100]:
  edges=walk(g555,p,goal,13000)
  if edges and 2600<length(edges)<11000:possibilities.append(edges)
 if not possibilities:raise ValueError('A555 missing continuous OSM '+('northbound' if north else 'southbound'))
 return max(possibilities,key=length)
bonn=a555_path(False);koeln=a555_path(True)
a555s=new_feature('extra-a555-bonn','A555 → Bonn / Rodenkirchen','motorway',bonn,'A555 Köln-Süd–Rodenkirchen',3000)
a555n=new_feature('extra-a555-koeln','A555 → Köln / Verteilerkreis','motorway',koeln,'A555 Köln-Süd–Rodenkirchen',3150)
features.extend([a555s,a555n])
# Official numbered exits, anchored to the nearest EXACT OSM motorway vertex.
center=(50.88552,6.9683)
poll=(50.902,6.996)
rodenkirchen=(50.8668,6.972)
junction('12','A4','AK Köln-Süd',center,'osm-positioned-interchange',[a4w,a4e])
junction('13','A4','Köln-Poll',poll,'osm-positioned-junction',[a4w,a4e])
junction('2','A555','AK Köln-Süd',center,'osm-positioned-interchange',[a555s,a555n])
junction('3','A555','Rodenkirchen',rodenkirchen,'osm-positioned-junction',[a555s,a555n])
# Preserve only exact OSM motorway-link chains. Endpoints are actual trunk nodes.
trunks={f['id']:set(map(tuple,f['points'])) for f in (a4w,a4e,a555s,a555n)}
links=[w for w in ways if w.get('tags',{}).get('highway')=='motorway_link'
       and w.get('tags',{}).get('access') not in ('private','no')
       and any(50.858<p['lat']<50.92 and 6.94<p['lon']<7.023 for p in w['geometry'])]
linkgraph,_=graphs(links)
usedExisting={i for f in features for i in f['wayIds']}
turns=0
for sourcepath,vertices in trunks.items():
 for targetpath,targets in trunks.items():
  if sourcepath==targetpath or sourcepath.startswith('extra-a4')==targetpath.startswith('extra-a4'):continue
  options=[]
  for start in vertices & linkgraph.keys():
   edges=walk(linkgraph,start,lambda p:p in targets,4300)
   if edges and 40<length(edges)<4100:
    options.append(edges)
  if not options:continue
  edges=min(options,key=length);wid=edges[0][2]['id']
  key='extra-koelnsued-turn-'+sourcepath+'-to-'+targetpath+'-'+str(wid)
  if any(f['id']==key for f in features):continue
  name='AK Köln-Süd · '+('A4' if 'a4-' in sourcepath else 'A555')+' → '+('A4' if 'a4-' in targetpath else 'A555')
  features.append(new_feature(key,name,'ramp',edges,'AK Köln-Süd',0))
  turns+=1
assert turns>=2, 'Not enough verified motorway-to-motorway A4/A555 turns: '+str(turns)
# Other physical ramp branches at AS Köln-Poll and AK Köln-Süd.
for w in links:
 if w['id'] in usedExisting or any(w['id'] in f['wayIds'] for f in features if f['kind']=='ramp'):continue
 ps=directed(w)
 if not any(p in v for p in ps for v in trunks.values()):continue
 mid=ps[len(ps)//2]
 if not (metres(mid,poll)<1900 or metres(mid,center)<2100 or metres(mid,rodenkirchen)<1200):continue
 name='A4 AS 13 Köln-Poll' if metres(mid,poll)<metres(mid,center) else 'AK Köln-Süd'
 if metres(mid,rodenkirchen)<900:name='A555 AS 3 Rodenkirchen'
 f=new_feature('extra-koelnsued-link-'+str(w['id']),name+' · Rampenzweig','ramp',
     [(a,b,w) for a,b in zip(ps,ps[1:])],name,0)
 features.append(f)
# Supplement true local-road boundary nodes for multi-part on/off ramps.
streets={'trunk','trunk_link','primary','primary_link','secondary','secondary_link',
         'tertiary','tertiary_link','residential','unclassified'}
streetpoints={point(p) for w in ways if w.get('tags',{}).get('highway') in streets for p in w['geometry']}
rampvertices={tuple(p) for f in features if f['kind']=='ramp' for p in f['points']}
boundary=sorted(set(map(tuple,boundary)) | (rampvertices & streetpoints))
ids=[f['id'] for f in features];assert len(set(ids))==len(ids)
package['routes']=features;package['junctions']=junctions
(ROOT/'data/extension-junctions.json').write_text(json.dumps(package,separators=(',',':')))
head="import type {Point,Exit} from './core.js';\n"
head+="export const EXTENSION_IDS="+json.dumps(ids)+" as const;\n"
head+="export type ExtensionId=typeof EXTENSION_IDS[number];\n"
head+="export interface ExtensionRoute {id:ExtensionId;name:string;zone:string;kind:'motorway'|'ramp';lanes:number;laneSegments:{fromM:number;toM:number;lanes:number}[];points:Point[];wayIds:number[];demandVph:number;freeKmh:number}\n"
head+="export const extensionRoutes:ExtensionRoute[]="+json.dumps(features,separators=(',',':'))+";\n"
head+="export const extensionJunctions:Exit[]="+json.dumps(junctions,separators=(',',':'))+";\n"
head+="export const extensionRampBoundaryPoints:Point[]="+json.dumps(boundary,separators=(',',':'))+";\n"
head+="const byId=new Map<string,ExtensionRoute>(extensionRoutes.map(r=>[r.id,r]));\nexport const extensionRoute=(id:string)=>byId.get(id);\n"
(ROOT/'src/network-extensions.ts').write_text(head)
print('A4 westbound +',round(length(west)/1000,2),'km, eastbound +',round(length(back)/1000,2),
 'km; A555',round(length(koeln)/1000,2),round(length(bonn)/1000,2),'km;',turns,'cross-motorway turns;',len(features),'total paths',flush=True)
