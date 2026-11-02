"""Retain selectable A560 and Heumar paths as exact directed OSM walks."""
import json,collections,re,math
from pathlib import Path
from extend_heumar_camberg import pt,dist,walk
ROOT=Path(__file__).resolve().parents[1]
x=json.loads((ROOT/'data/a3-heumar-camberg-osm.json').read_text())
extra=json.loads((ROOT/'data/a59-a560-osm.json').read_text())
elements=list({(e['type'],e['id']):e for e in x['elements']+json.loads((ROOT/'data/a3-wiesbaden-osm.json').read_text())['elements']+extra['elements']+json.loads((ROOT/'data/cologne-triangle-osm.json').read_text())['elements']+json.loads((ROOT/'data/bonn-a59-a562-osm.json').read_text())['elements']}.values())
ways=[w for w in elements if w['type']=='way' and w.get('geometry')]
from extend_heumar_camberg import read_data
core=read_data()
corepoints={tuple(p) for r in core['roads'] if r['road'].startswith('A3') for p in r['points']}
def road_of(key):
 return next((road for prefix,road in [('A3-','A3'),('A48-','A48'),('extra-a59-','A59'),('extra-a560-','A560'),('extra-a562-','A562'),('extra-a4-','A4'),('extra-a559-','A559')] if key.startswith(prefix)),None)
features=[]
def add(key,name,zone,kind,parts):
 points=[];lanes=[];ids=[];segments=[];metre=0
 for w,ps in parts:
  if points and points[-1]!=ps[0]:raise ValueError('Disconnected path '+key)
  points+=ps[1:] if points else ps
  count=int(w.get('tags',{}).get('lanes','1'))
  turns=w.get('tags',{}).get('turn:lanes','').split('|');through=sum(not ('merge_to_' in t or t in ['left','right','slight_left','slight_right']) for t in turns)
  if len(turns)>1 and through>=2:count=min(count,through)
  count=min(count,2 if key.startswith(('extra-a560-','extra-a559-','extra-a562-')) else 3) if kind=='motorway' else count
  length=sum(dist(a,b) for a,b in zip(ps,ps[1:]));segments.append(dict(fromM=metre,toM=metre+length,lanes=count));metre+=length
  lanes.append(count);ids.extend(w.get('wayIds',[w['id']]))
 if len(points)<2:return
 features.append(dict(id=key,name=name,zone=zone,kind=kind,lanes=max(lanes) if kind=='motorway' else min(lanes),laneSegments=segments,points=points,wayIds=list(dict.fromkeys(ids)),
  demandVph=1400 if kind=='motorway' else 500*min(lanes),freeKmh=130 if kind=='motorway' else 80))
a560=[w for w in ways if w.get('tags',{}).get('highway')=='motorway' and (w['tags'].get('ref','').replace(' ','')=='A560' or not w['tags'].get('ref') and any(50.785<p['lat']<50.80 and 7.145<p['lon']<7.16 for p in w['geometry']))]
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
# Two exact A59 carriageways; motorway links at Porz are included in the
# A59 route, never connected with invented straight lines.
a59=[w for w in ways if w.get('tags',{}).get('highway')=='motorway_link' or w.get('tags',{}).get('ref','').replace(' ','')=='A59' or w.get('tags',{}).get('highway')=='motorway' and 'A 4' in w['tags'].get('ref','').split(';') and min(p['lat'] for p in w['geometry'])>50.922]
g59=collections.defaultdict(list)
main59=collections.defaultdict(list);incoming59=collections.Counter()
for w in a59:
 ps=[pt(p) for p in w['geometry']]
 if w['tags'].get('oneway')=='-1':ps.reverse()
 for a,b in zip(ps,ps[1:]):
  g59[a].append((b,w))
  if w.get('tags',{}).get('highway')=='motorway' and w['tags'].get('ref','').replace(' ','')=='A59':main59[a].append(b);incoming59[b]+=1
northStarts={p for p in main59 if p[0]<50.735 and not incoming59[p]}
southEnds={p for p in incoming59 if p[0]<50.735 and not main59[p]}
for north,key,label in [(True,'extra-a59-koeln','A59 → Köln / Heumar'),(False,'extra-a59-bonn','A59 → Bonn / Bonn-Ost')]:
 starts=[p for p in g59 if (p in northStarts if north else p in corepoints and p[0]>50.91)]
 candidates=[]
 for start in starts:
  try:
   edges=walk(g59,start,lambda p:p in corepoints and p[0]>50.91 if north else p in southEnds)
   if edges:candidates.append(edges)
  except ValueError:pass
 if not candidates:raise ValueError('A59 missing continuous directed carriageway '+key)
 edges=max(candidates,key=lambda es:sum(dist(a,b) for a,b,w in es))
 if not north:
  while len(edges)>1 and edges[0][1] in corepoints:edges.pop(0)
 parts=[]
 for a,b,w in edges:
  if parts and parts[-1][0]['id']==w['id']:parts[-1][1].append(b)
  else:parts.append((w,[a,b]))
 add(key,label,'A59 Bonn-Ost–Heumar','motorway',parts)
# The complete A562 is a pair of directed motorway walks, including the
# original Rhine bridge geometry. Ramp turns are separate selectable paths.
a562=[w for w in ways if w.get('tags',{}).get('highway')=='motorway' and 'A562' in w['tags'].get('ref','').replace(' ','').split(';')]
g562=collections.defaultdict(list);incoming562=collections.Counter()
for w in a562:
 ps=list(map(pt,w['geometry']))
 if w['tags'].get('oneway')=='-1':ps.reverse()
 for a,b in zip(ps,ps[1:]):g562[a].append((b,w));incoming562[b]+=1
ends562={p for p in incoming562 if not g562[p]};candidates562=[]
for start in list(g562):
 if incoming562[start]:continue
 try:edges=walk(g562,start,lambda p:p in ends562)
 except ValueError:continue
 if edges:candidates562.append(edges)
for east,key,label in [(True,'extra-a562-bonn-ost','A562 → Bonn-Ost / Königswinter'),(False,'extra-a562-bonn','A562 → Bonn / Bad Godesberg')]:
 options=[es for es in candidates562 if (es[-1][1][1]>es[0][0][1])==east]
 if not options:raise ValueError('Missing complete A562 direction '+key)
 edges=max(options,key=lambda es:sum(dist(a,b) for a,b,w in es));parts=[]
 for a,b,w in edges:
  if parts and parts[-1][0]['id']==w['id']:parts[-1][1].append(b)
  else:parts.append((w,[a,b]))
 add(key,label,'A562 Bonn / Rheinbrücke / Bonn-Ost','motorway',parts)
# Complete the west and south sides of the Cologne triangle. Shared
# A3/A4 and A4/A59 road sections keep their existing directional owner.
owned=corepoints|{tuple(p) for f in features if f['kind']=='motorway' for p in f['points']}
for ref,key,label,starts_at,goal_at,trim in [
 ('A 4','extra-a4-aachen','A4 → Aachen / Gremberg',lambda p:p in corepoints and p[0]>50.922,lambda p:p[1]<7.017,'front'),
 ('A 4','extra-a4-olpe','A4 → Olpe / Heumar / Köln-Ost',lambda p:7.014<p[1]<7.018,lambda p:p in owned,'back'),
 ('A 559','extra-a559-gremberg','A559 → Gremberg',lambda p:p[0]<50.905,lambda p:p[0]>50.919,'none'),
 ('A 559','extra-a559-porz','A559 → Porz / Bonn',lambda p:p[0]>50.919,lambda p:p[0]<50.903,'none')]:
 g=collections.defaultdict(list)
 for w in ways:
  if not (w.get('tags',{}).get('highway')=='motorway' and ref in w['tags'].get('ref','').split(';') or ref=='A 4' and w.get('tags',{}).get('highway')=='motorway_link' and any(50.918<p['lat']<50.935 and 7.043<p['lon']<7.08 for p in w['geometry'])):continue
  ps=list(map(pt,w['geometry']))
  if w['tags'].get('oneway')=='-1':ps.reverse()
  for a,b in zip(ps,ps[1:]):g[a].append((b,w))
 candidates=[]
 for start in list(g):
  if not starts_at(start):continue
  try:edges=walk(g,start,lambda p:p!=start and goal_at(p))
  except ValueError:continue
  if edges:candidates.append(edges)
 if not candidates:raise ValueError('Missing exact directed triangle route '+key)
 edges=max(candidates,key=lambda es:sum(dist(a,b) for a,b,w in es))
 if trim=='front':
  while len(edges)>1 and edges[0][1] in owned:edges.pop(0)
 if trim=='back':
  while len(edges)>1 and edges[-1][0] in owned:edges.pop()
 parts=[]
 for a,b,w in edges:
  if parts and parts[-1][0]['id']==w['id']:parts[-1][1].append(b)
  else:parts.append((w,[a,b]))
 add(key,label,'Kölner Autobahndreieck','motorway',parts)
for r in json.loads((ROOT/'data/siegburg-connections.json').read_text())['connections']:
 w={'id':r['wayIds'][0],'wayIds':r['wayIds'],'tags':{'lanes':str(r['lanes'])}}
 add('extra-'+r['id'],r['from'].replace('A3-frankfurt','A3 Frankfurt').replace('A3-koeln','A3 Köln').replace('A560-hennef','A560 Hennef').replace('A560-bonn','A560 Bonn')+' → '+r['to'].replace('A3-frankfurt','A3 Frankfurt').replace('A3-koeln','A3 Köln').replace('A560-hennef','A560 Hennef').replace('A560-bonn','A560 Bonn'),'AK Bonn/Siegburg','ramp',[(w,[tuple(p) for p in r['points']])])
# Complete all direct motorway-to-motorway link walks at Heumar and
# Sankt Augustin, including shared branches. Preserve each legal turn.
trunks={f['id']:set(map(tuple,f['points'])) for f in features if f['kind']=='motorway'}
for key in ['A3-koeln','A3-frankfurt']:trunks[key]={tuple(p) for r in core['roads'] if r['road']==key for p in r['points']}
lg=collections.defaultdict(list)
for w in ways:
 if w.get('tags',{}).get('highway')!='motorway_link' or w['tags'].get('access') in ['no','private'] or w['tags'].get('motor_vehicle') in ['no','private']:continue
 if any(w['id'] in f['wayIds'] for f in features if f['kind']=='motorway'):continue
 ps=list(map(pt,w['geometry']))
 if not any(50.695<=p[0]<=50.963 and 6.98<=p[1]<=7.315 for p in ps):continue
 if w['tags'].get('oneway')=='-1':ps.reverse()
 for a,b in zip(ps,ps[1:]):lg[a].append((b,w))
for source,vertices in trunks.items():
 for target,goals in trunks.items():
  if source==target or road_of(source)==road_of(target) or any(f['id'].startswith('extra-siegburg-') and f['points'][0] in vertices and f['points'][-1] in goals for f in features):continue
  for start in vertices & lg.keys():
   if start in goals:continue
   try:edges=walk(lg,start,lambda p:p in goals)
   except ValueError:continue
   if not edges:continue
   parts=[]
   for a,b,w in edges:
    if parts and parts[-1][0]['id']==w['id']:parts[-1][1].append(b)
    else:parts.append((w,[a,b]))
   label=source+' → '+target
   add('extra-turn-'+source+'-to-'+target+'-'+str(edges[0][2]['id']),label.replace('extra-','').replace('a59','A59').replace('a560','A560'),'AD Sankt Augustin / Heumar','ramp',parts)
links=[]
for w in ways:
 if w.get('tags',{}).get('highway')!='motorway_link' or w['tags'].get('access') in ['no','private'] or w['tags'].get('motor_vehicle') in ['no','private']:continue
 # Include every retained A3/A48 AS, rather than clipping ramp geometry
 # to the previous A59/A560 region. Exact connectivity filters below
 # exclude ramps belonging only to other motorways.
 if any(w['id'] in ramp['wayIds'] for ramp in core['ramps']):continue
 if not any(50.695<=p['lat']<=50.963 and 6.98<=p['lon']<=7.315 for p in w['geometry']) and not any(dist(pt(p),j['position'])<2200 for p in w['geometry'] for j in core['exits']):continue
 if any(w['id'] in f['wayIds'] for f in features if f['kind']=='ramp'):continue
 if w['id'] in {i for r in json.loads((ROOT/'data/siegburg-connections.json').read_text())['connections'] for i in r['wayIds']}:continue
 if any(w['id'] in f['wayIds'] for f in features if f['kind']=='motorway'):continue
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
 zone='AD Köln-Heumar' if max(p[0] for w,ps in parts for p in ps)>=50.912 else 'A59 / A560 Anschlüsse'
 label=('Heumar · Überleitung' if zone=='AD Köln-Heumar' else 'Heumar-Umfeld · Überleitung')+(' → '+(ref or '')+(' · ' if ref and dest else '')+(dest or '') if ref or dest else ' '+str(parts[0][0]['id']))
 add('extra-heumar-'+str(parts[0][0]['id']),label,zone,'ramp',parts)
# Retain only link chains that connect with a retained motorway or one
# another. Do not add disconnected nearby ramps from unrelated motorways.
mainpoints={tuple(p) for f in features if f['kind']=='motorway' for p in f['points']}
from extend_heumar_camberg import read_data
core=read_data();mainpoints.update(tuple(p) for r in core['roads'] for p in r['points'])
kept=[f for f in features if f['kind']=='motorway' or f['id'].startswith('extra-siegburg-')]
remaining=[f for f in features if f not in kept]
for _ in range(12):
 endpoints=mainpoints|{tuple(p) for f in kept for p in [f['points'][0],f['points'][-1]]}
 found=[f for f in remaining if tuple(f['points'][0]) in endpoints or tuple(f['points'][-1]) in endpoints]
 if not found:break
 kept+=found;remaining=[f for f in remaining if f not in found]
features=kept
# Saved events keep the original Heumar fragment IDs after the new
# complete turn walks supersede their geometry.
for legacy in json.loads((ROOT/'data/legacy-extension-paths.json').read_text()):
 if not any(f['id']==legacy['id'] for f in features):features.append(legacy)
junctions=[]
for f in features:
 if f['kind']!='motorway':continue
 road=road_of(f['id']);vertices=set(map(tuple,f['points']))
 for n in elements:
  t=n.get('tags',{})
  if n['type']!='node' or t.get('highway')!='motorway_junction' or not t.get('ref') or pt(n) not in vertices:continue
  ref=t['ref'];name=t.get('name',road+' '+ref)
  if road=='A559' and ref not in ['1','2','3']:continue
  if road=='A59' and ref not in ['32','33','34','35','36','37','38','39','40','41','42','43']:continue
  if name.startswith('Dreieck '):name='AD '+name[8:]
  if name.startswith('Kreuz '):name='AK '+name[6:]
  j=next((j for j in junctions if j['road']==road and j['ref']==ref),None)
  if not j:j=dict(road=road,ref=ref,name=name,position=pt(n),source='osm-junction',directional={});junctions.append(j)
  old=j['directional'].get(f['id']);order={tuple(p):i for i,p in enumerate(f['points'])}
  if not old or order[pt(n)]<order[tuple(old['position'])]:j['directional'][f['id']]=dict(position=pt(n),nodeId=n['id'])
# Bonn-Ost's northbound OSM diverge is tagged motorway_junction without
# a ref/name. Reuse that exact node for the already identified A59 AK 43.
bonnOst=next(j for j in junctions if j['road']=='A59' and j['ref']=='43')
north59=next(f for f in features if f['id']=='extra-a59-koeln')
vertices59=set(map(tuple,north59['points']))
unnumbered=[n for n in elements if n['type']=='node' and n.get('tags',{}).get('highway')=='motorway_junction' and not n['tags'].get('ref') and pt(n) in vertices59 and dist(pt(n),bonnOst['position'])<1800]
if unnumbered:
 node=min(unnumbered,key=lambda n:dist(pt(n),bonnOst['position']))
 bonnOst['directional']['extra-a59-koeln']=dict(position=pt(node),nodeId=node['id'])
northTurn=next((f for f in features if f['id'].startswith('extra-turn-extra-a59-koeln-to-extra-a562-bonn-')),None)
if northTurn:
 point=northTurn['points'][0]
 way=next(w for w in ways if w['id']==northTurn['wayIds'][0])
 bonnOst['directional']['extra-a59-koeln']=dict(position=point,nodeId=way['nodes'][0])
# Fill entry-only directions from an exact retained on-ramp merge, never
# from the opposing carriageway's exit node.
for j in junctions:
 j['access']={}
 for f in features:
  if f['kind']!='motorway' or road_of(f['id'])!=j['road']:continue
  vertices=set(map(tuple,f['points']))
  ins={pt(w['geometry'][-1]):w for w in ways if w.get('tags',{}).get('highway')=='motorway_link' and pt(w['geometry'][-1]) in vertices and pt(w['geometry'][0]) not in vertices}
  outs={pt(w['geometry'][0]):w for w in ways if w.get('tags',{}).get('highway')=='motorway_link' and pt(w['geometry'][0]) in vertices and pt(w['geometry'][-1]) not in vertices}
  nearIn=[p for p in ins if dist(p,j['position'])<1600];nearOut=[p for p in outs if dist(p,j['position'])<1600]
  if f['id'] not in j['directional'] and nearIn:
   p=min(nearIn,key=lambda p:dist(p,j['position']));j['directional'][f['id']]=dict(position=p,nodeId=ins[p]['nodes'][-1])
   j['access'][f['id']]=dict(entry=True,exit=False)
  elif f['id'] in j['directional']:j['access'][f['id']]=dict(entry=bool(nearIn),exit=True)
for road,ref,name,keys,ends in [('A4','15','AD Köln-Heumar',['extra-a4-aachen','extra-a4-olpe'],[0,-1]),('A559','1','AK Köln-Gremberg',['extra-a559-gremberg','extra-a559-porz'],[-1,0]),('A559','3','AD Köln-Porz',['extra-a559-gremberg','extra-a559-porz'],[0,-1]),('A59','31','AD Köln-Heumar',['extra-a59-koeln','extra-a59-bonn'],[-1,0]),('A560','1','AD Sankt Augustin-West',['extra-a560-hennef','extra-a560-bonn'],[0,-1])]:
 fs=[next(f for f in features if f['id']==k) for k in keys]
 if any(j['road']==road and j['ref']==ref for j in junctions):continue
 junctions.append(dict(road=road,ref=ref,name=name,position=fs[0]['points'][ends[0]],source='osm-topology',directional={k:dict(position=f['points'][end],nodeId=0) for k,f,end in zip(keys,fs,ends)}))
shared=next(e for e in core['exits'] if e['road']=='A3' and e['ref']=='27')
junctions.append({**shared,'road':'A4','ref':'16','sharedRoad':'A3','source':'osm-shared-junction'})
# Give every additional ramp its actual nearby junction, rather than
# calling all southern ramps Heumar.
for f in features:
 if f['kind']!='ramp' or f['id'].startswith('extra-siegburg-'):continue
 near=min(core['exits']+junctions,key=lambda j:min(dist(p,j['position']) for p in [f['points'][0],f['points'][-1]]))
 label=near['name'] if near['name'].startswith(('AD ','AK ')) else near['road']+' AS '+near['ref']+' '+near['name']
 f['zone']=label
 if f['id'].startswith('extra-heumar-'):
  motorwayVertices={key:{tuple(p) for r in core['roads'] if r['road']==key for p in r['points']} for key in ['A3-koeln','A3-frankfurt','A48-koblenz','A48-dernbach']}
  motorwayVertices.update({r['id']:set(map(tuple,r['points'])) for r in features if r['kind']=='motorway'})
  origin=next((key for key,vs in motorwayVertices.items() if tuple(f['points'][0]) in vs),None)
  target=next((key for key,vs in motorwayVertices.items() if tuple(f['points'][-1]) in vs),None)
  names={'A3-koeln':'A3 → Köln','A3-frankfurt':'A3 → Frankfurt','A48-koblenz':'A48 → Koblenz','A48-dernbach':'A48 → Dernbach'}
  names.update({r['id']:r['name'] for r in features if r['kind']=='motorway'})
  f['name']=label+(' · Abfahrt von '+names[origin] if origin else ' · Auffahrt auf '+names[target] if target else ' · Rampenzweig')
streetKinds={'trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','residential','unclassified','living_street','service'}
streetpoints={pt(p) for w in ways if w.get('tags',{}).get('highway') in streetKinds and w['tags'].get('access') not in ['private','no'] and w['tags'].get('motor_vehicle') not in ['private','no'] for p in w['geometry']}
rampBoundaryPoints=sorted({tuple(p) for f in features if f['kind']=='ramp' for p in f['points']} & streetpoints)
ids=[f['id'] for f in features]
assert len(ids)==len(set(ids)), 'Duplicate directed path IDs'
text="import type {Point,Exit} from './core.js';\nexport const EXTENSION_IDS="+json.dumps(ids)+" as const;\nexport type ExtensionId=typeof EXTENSION_IDS[number];\nexport interface ExtensionRoute {id:ExtensionId;name:string;zone:string;kind:'motorway'|'ramp';lanes:number;laneSegments:{fromM:number;toM:number;lanes:number}[];points:Point[];wayIds:number[];demandVph:number;freeKmh:number}\nexport const extensionRoutes:ExtensionRoute[]="+json.dumps(features,separators=(',',':'))+";\nexport const extensionJunctions:Exit[]="+json.dumps(junctions,separators=(',',':'))+";\nexport const extensionRampBoundaryPoints:Point[]="+json.dumps(rampBoundaryPoints,separators=(',',':'))+";\nconst byId=new Map<string,ExtensionRoute>(extensionRoutes.map(r=>[r.id,r]));\nexport const extensionRoute=(id:string)=>byId.get(id);\n"
(ROOT/'src/network-extensions.ts').write_text(text)
print('Generated',len(features),'directed extension paths;',sum(len(f['points']) for f in features),'original vertices')

(ROOT/'data/extension-junctions.json').write_text(json.dumps(dict(routes=features,junctions=junctions),separators=(',',':')))
# Reapply the official Köln-Süd A4/A555 OSM extension on every rebuild.
if (ROOT/'data/a4-koeln-sued-osm.json').exists():
 import runpy
 runpy.run_path(str(ROOT/'scripts/extend_a4_koeln_sued.py'),run_name='__main__')

