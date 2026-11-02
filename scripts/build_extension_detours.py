"""Bundle directed OSM local and neighbouring-motorway alternatives.
No official U-number is inferred from a computed route.
"""
import json,collections,heapq,math
from extend_heumar_camberg import ROOT,read_data,pt,dist
bundle=json.loads((ROOT/'data/extension-junctions.json').read_text());core=read_data()
features=bundle['routes'];junctions=core['exits']+bundle['junctions']
sources=[json.loads((ROOT/p).read_text())['elements'] for p in ['data/a3-heumar-camberg-osm.json','data/a59-a560-osm.json','data/cologne-triangle-osm.json','data/bonn-a59-a562-osm.json', 'data/a4-koeln-sued-osm.json']]
ways=list({e['id']:e for source in sources for e in source if e['type']=='way' and e.get('geometry') and any(50.65<p['lat']<50.97 and 6.94<p['lon']<7.4 for p in e['geometry'])}.values())
# Build core directional chains by exact endpoint topology.
trunks={f['id']:list(map(tuple,f['points'])) for f in features if f['kind']=='motorway'}
for key in ['A3-koeln','A3-frankfurt']:
 rs=[r for r in core['roads'] if r['road']==key];adj=collections.defaultdict(list)
 for r in rs:
  for a,b in zip(r['points'],r['points'][1:]):a,b=tuple(a),tuple(b);adj[a].append(b);adj[b].append(a)
 start=min(p for p,ns in adj.items() if len(ns)==1) if key=='A3-koeln' else max(p for p,ns in adj.items() if len(ns)==1)
 ps=[start];prev=None
 while True:
  nxt=[b for b in adj[ps[-1]] if b!=prev]
  if not nxt:break
  prev=ps[-1];ps.append(nxt[0])
 trunks[key]=ps
positions={key:{p:i for i,p in enumerate(ps)} for key,ps in trunks.items()}
# Mainland entry nodes are exact on-ramp joins, not the nominal exit anchor.
incoming=collections.defaultdict(set)
for w in ways:
 t=w.get('tags',{})
 if t.get('highway')!='motorway_link':continue
 ps=list(map(pt,w['geometry']))
 if t.get('oneway')=='-1':ps.reverse()
 incoming[ps[-1]].add(ps[0])
speed={'motorway':110,'motorway_link':55,'trunk':70,'primary':60,'secondary':50,'tertiary':40,'residential':25,'unclassified':35,'primary_link':30,'secondary_link':25,'tertiary_link':20,'trunk_link':40}
graphs={}
for key in trunks:
 for mode in ['local','network']:
  g=collections.defaultdict(list);own=set(trunks[key])
  for w in ways:
   t=w.get('tags',{});h=t.get('highway');ref=t.get('ref','').replace(' ','')
   if h not in speed or t.get('access') in ['private','no','agricultural','forestry'] or t.get('motor_vehicle') in ['private','no'] or t.get('motorcar') in ['private','no']:continue
   ps=list(map(pt,w['geometry']))
   retained=any(any(p in positions[k] for p in ps) for k in trunks) if h=='motorway' else False
   if h=='motorway' and mode=='local' and retained:continue
   # Only the retained connected motorway network belongs in an alternative.
   if h=='motorway' and not retained and ref.startswith('A'):continue
   if t.get('oneway')=='-1':ps.reverse()
   directed=h in ['motorway','motorway_link'] or t.get('oneway') in ['yes','1','-1'] or t.get('junction')=='roundabout'
   for a,b in zip(ps,ps[1:]):
    if h=='motorway' and a in own and b in own:continue
    length=dist(a,b);cost=length/speed[h]*(1.6 if h=='residential' else 1)
    g[a].append((b,w,length,cost))
    if not directed:g[b].append((a,w,length,cost))
  graphs[key,mode]=g
anchors={}
for key,ps in trunks.items():
 road=next(road for prefix,road in [('A3-','A3'),('extra-a4-','A4'),('extra-a559-','A559'),('extra-a59-','A59'),('extra-a560-','A560'),('extra-a562-','A562')] if key.startswith(prefix));anchors[key]=[]
 for j in junctions:
  if j['road']!=road or key not in j.get('directional',{}):continue
  p=tuple(j['directional'][key]['position'])
  if p not in positions[key]:continue
  if road=='A3' and j['ref'] not in ['27','28','29','30a','30b','31','32','33']:continue
  anchors[key].append((positions[key][p],j,p))
 anchors[key].sort(key=lambda x:x[0])
def shortest(g,start,goals):
 todo=[(0,start)];cost={start:0};prev={}
 while todo:
  c,a=heapq.heappop(todo)
  if c!=cost[a]:continue
  if a in goals:
   edges=[];finish=a
   while a!=start:b,w,l=prev[a];edges.append((b,a,w,l));a=b
   return edges[::-1],finish
  for b,w,length,weight in g.get(a,[]):
   n=c+weight
   if n<cost.get(b,1e99):cost[b]=n;prev[b]=(a,w,length);heapq.heappush(todo,(n,b))
 return None,None
records=[]
for key,items in anchors.items():
 ps=trunks[key]
 for index,j,start in items:
  if j.get('access',{}).get(key,{}).get('exit') is False:continue
  for mode in ['local','network']:
   if mode=='local' and j['name'].startswith(('AD ','AK ')):continue
   for target,targets in anchors.items():
    if mode=='local' and target!=key and dist(start,targets[0][2])>35000:continue
    # Preserve destination direction: cross routes are useful only for
    # documented short inter-motorway transfers; main through journeys rejoin same direction.
    for ti,tj,nominal in targets:
     if target==key and ti<=index:continue
     if target!=key and (mode!='local' or dist(start,nominal)>8000 or key.startswith('A3') and target.startswith('A3')):continue
     if tj.get('access',{}).get(target,{}).get('entry') is False:continue
     if tj['name'].startswith(('AD ','AK ')) and mode=='local':continue
     goals={p for p in positions[target] if p in incoming and dist(p,nominal)<1600 and any(a not in positions[target] for a in incoming[p])}
     goals={p for p in goals if positions[target][p]>=ti}
     if goals:goals={min(goals,key=lambda p:positions[target][p])}
     if tj['name'].startswith(('AD ','AK ')):goals.add(nominal)
     if not goals:continue
     edges,finish=shortest(graphs[key,mode],start,goals)
     if not edges:continue
     # Never label a second identical local route as motorway alternative.
     motorway=any(w['tags'].get('highway')=='motorway' and any(a in positions[k] and b in positions[k] for k in trunks if k!=key) for a,b,w,l in edges)
     if mode=='network' and not motorway:continue
     points=[edges[0][0]]+[b for a,b,w,l in edges];length=sum(l for a,b,w,l in edges)
     minutes=sum(l/1000/speed[w['tags']['highway']]*60 for a,b,w,l in edges)
     if length>90000:continue
     legs=[]
     for other,vertices in positions.items():
      if other==key:continue
      used=[(vertices[a],vertices[b]) for a,b,w,l in edges if a in vertices and b in vertices]
      if used:legs.append(dict(path=other,fromPoint=trunks[other][min(min(a,b) for a,b in used)],toPoint=trunks[other][max(max(a,b) for a,b in used)]))
     records.append(dict(id='EXT-'+key+'-'+j['ref']+'-'+target+'-'+tj['ref']+'-'+mode,path=key,targetPath=target,fromRef=j['ref'],toRef=tj['ref'],fromPoint=start,toPoint=finish,points=points,wayIds=list(dict.fromkeys(w['id'] for a,b,w,l in edges)),lengthKm=length/1000,freeMinutes=minutes,motorway=motorway,exitIsInterchange=j['name'].startswith(('AD ','AK ')),legs=legs))
for key,items in anchors.items():
 regular=[i for i in items if not i[1]['name'].startswith(('AD ','AK ')) and i[1].get('access',{}).get(key,{}).get('exit') is not False]
 if not regular:continue
 last=regular[-1];streets={p for w in ways if w['tags'].get('highway') not in ['motorway','motorway_link'] for p in map(pt,w['geometry'])}
 terminalEdges,terminal=shortest(graphs[key,'local'],last[2],streets)
 if not terminalEdges:continue
 for index,j,start in regular:
  edges,finish=shortest(graphs[key,'local'],start,{terminal})
  if not edges:continue
  length=sum(l for a,b,w,l in edges);minutes=sum(l/1000/speed[w['tags']['highway']]*60 for a,b,w,l in edges)
  records.append(dict(id='EXT-'+key+'-'+j['ref']+'-end',path=key,targetPath=key,fromRef=j['ref'],toRef='end',fromPoint=start,toPoint=trunks[key][-1],points=[edges[0][0]]+[b for a,b,w,l in edges],wayIds=list(dict.fromkeys(w['id'] for a,b,w,l in edges)),lengthKm=length/1000,freeMinutes=minutes,motorway=False,exitIsInterchange=False,legs=[]))
print('Bundled alternatives' ,len(records),'; motorway alternatives',sum(r['motorway'] for r in records),flush=True)
# Deduplicate vertices and compact route indices; hundreds of alternatives
# reuse the same streets. Decode once at module load, never on a timer tick.
import base64,struct
pool=[];indices={}
for r in records:
 ids=[]
 for point in r.pop('points'):
  if point not in indices:indices[point]=len(pool);pool.append(point)
  ids.append(indices[point])
 assert len(pool)<65536
 r['vertexIds']=base64.b64encode(struct.pack('<'+'H'*len(ids),*ids)).decode()
header="import type {Point} from './core.js';\nexport interface ExtensionDetour {id:string;path:string;targetPath:string;fromRef:string;toRef:string;fromPoint:Point;toPoint:Point;points:Point[];wayIds:number[];lengthKm:number;freeMinutes:number;motorway:boolean;exitIsInterchange:boolean;motorwayBypass?:boolean;capacityVph?:number;legs:{path:string;fromPoint:Point;toPoint:Point}[]}\n"
text=header+'const vertices:Point[]='+json.dumps(pool,separators=(',',':'))+';\nconst packed='+json.dumps(records,separators=(',',':'))+";\nexport const extensionDetours:ExtensionDetour[]=packed.map(({vertexIds,...record})=>{const bytes=atob(vertexIds);return {...record,fromPoint:record.fromPoint as Point,toPoint:record.toPoint as Point,legs:record.legs.map(l=>({...l,fromPoint:l.fromPoint as Point,toPoint:l.toPoint as Point})),points:Array.from({length:bytes.length/2},(_,i)=>vertices[bytes.charCodeAt(i*2)+256*bytes.charCodeAt(i*2+1)]!)};});\n"
(ROOT/'src/extension-detours-data.ts').write_text(text)
print('Vertices',len(pool),'module bytes',len(text),flush=True)
