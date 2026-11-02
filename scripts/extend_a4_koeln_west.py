"""Extend existing A4 to AK Köln-West; add A1 north/south arms and all
exact OSM verified A4/A1 turn links, AS Köln-Klettenberg/Eifeltor.
Run AFTER scripts/extend_a4_koeln_sued.py. No approximate road segments.
"""
import collections,heapq,json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'data/a4-koeln-west-osm.json'
assert source.exists(),'Fetch original western Köln OSM first'
package=json.loads((ROOT/'data/extension-junctions.json').read_text())
features=package['routes'];junctions=package['junctions']
oldtext=(ROOT/'src/network-extensions.ts').read_text()
boundary=json.loads(oldtext.split('export const extensionRampBoundaryPoints:Point[]=')[1].split(';')[0])
data=json.loads(source.read_text())['elements']
south=json.loads((ROOT/'data/a4-koeln-sued-osm.json').read_text())['elements']
items={(e['type'],e['id']):e for e in data+south}
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
  vertices=set(map(tuple,f['points']))
  # A junction exit must sit on a real off-ramp divergence and inside the
  # retained carriageway. Never place an AS at metre=route.lengthM.
  interior=vertices-{tuple(f['points'][0]),tuple(f['points'][-1])}
  tagged=[point(n) for n in nodes if n.get('tags',{}).get('ref')==ref
          and point(n) in interior and metres(point(n),position)<2000]
  departures=[directed(w)[0] for w in ways if w.get('tags',{}).get('highway')=='motorway_link'
          and directed(w)[0] in interior and metres(directed(w)[0],position)<1800]
  candidates=(tagged or departures or list(interior))
  near=min(candidates,key=lambda p:metres(p,position))
  node=next((n for n in nodes if point(n)==near),None)
  j.setdefault('directional',{})[f['id']]={'position':list(near),'nodeId':node['id'] if node else 0}
 return j
# Continue exact OSM A4 ways, preserving all pre-existing Heumar segments.
a4w=next(f for f in features if f['id']=='extra-a4-aachen')
a4e=next(f for f in features if f['id']=='extra-a4-olpe')
# The westbound A4 fork at AK Köln-Süd contains OSM motorway_link
# connectors between named A4 carriageway ways. Follow only actual directed
# links immediately around the junction; never make a straight bridge.
def south_interchange_link(w):
 if w.get('tags',{}).get('highway')!='motorway_link':return False
 return any(metres(point(p),(50.88552,6.9683))<1600 for p in w['geometry'])
g4,rev4=graphs([w for w in ways if allowed(w,'A4') or south_interchange_link(w)])
akwest=(50.925833,6.845278)
goal=lambda p: 50.914<p[0]<50.946 and p[1]<6.855
west=walk(g4,tuple(a4w['points'][-1]),goal,maxdist=19000)
back=walk(rev4,tuple(a4e['points'][0]),goal,maxdist=19000)
def reachable(g,start):
 seen={start};pending=[start]
 for p in pending:
  for b,w in g.get(p,[]):
   if b not in seen:seen.add(b);pending.append(b)
 return seen
seen=reachable(g4,tuple(a4w['points'][-1]))
print('A4 West reachability',len(seen),'westmost',min(seen,key=lambda p:p[1]),
 'northmost',max(seen,key=lambda p:p[0]),
 'near-end nodes',sorted(seen,key=lambda p:p[1])[:5],flush=True)
print('A4 debug west/back',bool(west),bool(back),'startW',a4w['points'][-1],
 'startE',a4e['points'][0],'nodes',len(g4),'W start exists',tuple(a4w['points'][-1]) in g4,
 'E reverse exists',tuple(a4e['points'][0]) in rev4,flush=True)
assert west and back,'Missing continuous directed A4 to AK Köln-West: do NOT draw fake link'
assert 6000<length(west)<16000,('Westbound A4 OSM length',length(west))
assert 6000<length(back)<16000,('Eastbound A4 OSM length',length(back))
append_parts(a4w,west);append_parts(a4e,[(b,a,w) for a,b,w in reversed(back)],True)
a4w['name']='A4 → Köln-West / Aachen'
a4e['name']='A4 → Köln-Süd / Heumar / Olpe'
a4w['zone']=a4e['zone']='A4 AK Köln-West–AD Köln-Heumar'
# Two exact directed A1 carriageway arms across AK Köln-West.
g1,_=graphs([w for w in ways if allowed(w,'A1')])
def a1_route(north):
 starts=[p for p in g1 if 6.819<p[1]<6.879 and
         (50.898<p[0]<50.916 if north else 50.938<p[0]<50.954)]
 starts.sort(key=lambda p:abs(p[0]-(50.904 if north else 50.947)))
 end=(lambda p:50.936<p[0]<50.954 and 6.82<p[1]<6.885) if north else (lambda p:50.895<p[0]<50.918 and 6.82<p[1]<6.885)
 options=[]
 for p in starts[:120]:
  e=walk(g1,p,end,11000)
  if e and 2000<length(e)<10000:options.append(e)
 if not options:raise ValueError('A1 motorway has no exact directed crossing at Köln-West '+str(north))
 return max(options,key=length)
north=a1_route(True);southbound=a1_route(False)
a1north=new_feature('extra-a1-dortmund','A1 → Dortmund / Köln-Nord','motorway',north,'AK Köln-West A1',2800)
a1south=new_feature('extra-a1-koblenz','A1 → Koblenz / Köln-Süd','motorway',southbound,'AK Köln-West A1',2800)
features.extend([a1north,a1south])
# Numbered and directional actual motorway anchor locations.
junction('10','A4','AK Köln-West',akwest,'osm-junction',[a4w,a4e])
junction('11a','A4','Köln-Klettenberg',(50.9030,6.9007),'osm-junction',[a4w,a4e])
junction('11b','A4','Köln-Eifeltor',(50.8924,6.9348),'osm-junction',[a4w,a4e])
junction('104','A1','AK Köln-West',akwest,'osm-junction',[a1north,a1south])
# Directed inter-motorway links: all legal exact OSM junction paths; preserve
# branch-by-branch lane counts, no path or forbidden turn inferred.
trunks={f['id']:set(map(tuple,f['points'])) for f in [a4w,a4e,a1north,a1south]}
linkways=[w for w in ways if w.get('tags',{}).get('highway')=='motorway_link'
 and w.get('tags',{}).get('access') not in ('no','private')
 and any(metres(point(p),akwest)<3000 for p in w['geometry'])]
g,_=graphs(linkways)
count=0
for source,vertices in trunks.items():
 for target,goals in trunks.items():
  if ('extra-a4-' in source)==('extra-a4-' in target):continue
  choices=[]
  for start in vertices & g.keys():
   edges=walk(g,start,lambda p:p in goals,4000)
   if edges and 45<length(edges)<3800:choices.append(edges)
  if not choices:continue
  edges=min(choices,key=length)
  name='AK Köln-West · '+('A4' if source.startswith('extra-a4') else 'A1')+' → '+('A4' if target.startswith('extra-a4') else 'A1')
  key='extra-koelnwest-turn-'+source+'-to-'+target+'-'+str(edges[0][2]['id'])
  if any(f['id']==key for f in features):continue
  features.append(new_feature(key,name,'ramp',edges,'AK Köln-West',0));count+=1
assert count>=2,'No verifiable A1/A4 turn ramps at Köln-West'
# Other exact OSM motorway_link portions of the interchange and local AS.
used={i for f in features for i in f['wayIds']}
for w in linkways:
 if w['id'] in used:continue
 ps=directed(w)
 if not any(p in v for p in ps for v in trunks.values()):continue
 near=min((('AK Köln-West',akwest),('AS Köln-Klettenberg',(50.9030,6.9007)),
           ('AS Köln-Eifeltor',(50.8924,6.9348))),key=lambda x:metres(ps[len(ps)//2],x[1]))
 if metres(ps[len(ps)//2],near[1])>2500:continue
 pathkey='extra-koelnwest-link-'+str(w['id'])
 features.append(new_feature(pathkey,near[0]+' · Rampenzweig','ramp',
  [(a,b,w) for a,b in zip(ps,ps[1:])],near[0],0))
# Extend local ramp boundary points for local-road exit routing.
streetkinds={'trunk','trunk_link','primary','primary_link','secondary','secondary_link',
 'tertiary','tertiary_link','residential','unclassified'}
street={point(p) for w in ways if w.get('tags',{}).get('highway') in streetkinds for p in w['geometry']}
rampverts={tuple(p) for f in features if f['kind']=='ramp' for p in f['points']}
boundary=sorted(set(map(tuple,boundary))|(street&rampverts))
ids=[f['id'] for f in features];assert len(ids)==len(set(ids))
package['routes']=features;package['junctions']=junctions
(ROOT/'data/extension-junctions.json').write_text(json.dumps(package,separators=(',',':')))
text="import type {Point,Exit} from './core.js';\\n"
text+="export const EXTENSION_IDS="+json.dumps(ids)+" as const;\\n"
text+="export type ExtensionId=typeof EXTENSION_IDS[number];\\n"
text+="export interface ExtensionRoute {id:ExtensionId;name:string;zone:string;kind:'motorway'|'ramp';lanes:number;laneSegments:{fromM:number;toM:number;lanes:number}[];points:Point[];wayIds:number[];demandVph:number;freeKmh:number}\\n"
text+="export const extensionRoutes:ExtensionRoute[]="+json.dumps(features,separators=(',',':'))+";\\n"
text+="export const extensionJunctions:Exit[]="+json.dumps(junctions,separators=(',',':'))+";\\n"
text+="export const extensionRampBoundaryPoints:Point[]="+json.dumps(boundary,separators=(',',':'))+";\\n"
text+="const byId=new Map<string,ExtensionRoute>(extensionRoutes.map(r=>[r.id,r]));\\nexport const extensionRoute=(id:string)=>byId.get(id);\\n"
# Replace escaped line separators as actual newline in TS output.
(ROOT/'src/network-extensions.ts').write_text(text.replace('\\n','\n'))
print('A4 to AK Köln-West:',round(length(west)/1000,2),round(length(back)/1000,2),
 'km; A1 arms:',round(length(north)/1000,2),round(length(southbound)/1000,2),
 'km; verified A1/A4 turns',count,'total paths',len(features),flush=True)
