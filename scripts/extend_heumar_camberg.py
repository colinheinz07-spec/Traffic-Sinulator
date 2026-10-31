"""Extend real A3 node chains, retaining every OSM vertex and directional anchor."""
import json,re,copy,collections,heapq,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def pt(p):return (round(p['lat'],7),round(p['lon'],7))
def dist(a,b):return math.hypot((a[0]-b[0])*111195,(a[1]-b[1])*111195*math.cos(math.radians((a[0]+b[0])/2)))
def read_data():return json.loads(re.search(r'networkData:\s*MapData\s*=\s*(\{.*\});?\s*$',(ROOT/'src/geodata.ts').read_text(),re.S)[1])
def walk(graph,start,goal):
 todo=[(0,start)];cost={start:0};prev={};finish=None
 while todo:
  n,a=heapq.heappop(todo)
  if n>cost[a]+.001:continue
  if goal(a):finish=a;break
  for b,w in graph.get(a,[]):
   d=n+dist(a,b)
   if d<cost.get(b,1e99):cost[b]=d;prev[b]=(a,w);heapq.heappush(todo,(d,b))
 if finish is None:raise ValueError('No exact OSM continuation from '+repr(start))
 edges=[];a=finish
 while a!=start:b,w=prev[a];edges.append((b,a,w));a=b
 edges.reverse();return edges
def grouped(edges):
 groups=[]
 for a,b,w in edges:
  if groups and groups[-1][0]['id']==w['id']:groups[-1][1].append(b)
  else:groups.append((w,[a,b]))
 return groups

def compile_extension(data,source):
 data=copy.deepcopy(data);ways=[e for e in source['elements'] if e['type']=='way' and e.get('tags',{}).get('highway')=='motorway' and e['tags'].get('ref','').replace(' ','')=='A3']
 nodes=[e for e in source['elements'] if e['type']=='node'];graph=collections.defaultdict(list);reverse=collections.defaultdict(list)
 for w in ways:
  points=[pt(p) for p in w['geometry']]
  if w['tags'].get('oneway')=='-1':points.reverse()
  for a,b in zip(points,points[1:]):graph[a].append((b,w));reverse[b].append((a,w))
 added=[];anchors={}
 for path in ['A3-koeln','A3-frankfurt']:
  own=[r for r in data['roads'] if r['road']==path];counts=collections.Counter(tuple(p) for r in own for p in [r['points'][0],r['points'][-1]])
  ends=[p for p,n in counts.items() if n==1]
  assert len(ends)==2,(path,ends)
  for north in [True,False]:
   start=max(ends) if north else min(ends)
   targets={pt(n) for n in nodes if n.get('tags',{}).get('ref')==('28' if north else '44') and ('Heumar' if north else 'Camberg') in n.get('tags',{}).get('name','')}
   forward=(path=='A3-koeln')==north
   edges=walk(graph if forward else reverse,start,lambda a:a in targets)
   if not north:
    finish=edges[-1][1]
    south=min(p[0] for p in targets)-.0045
    edges+=walk(graph if forward else reverse,finish,lambda p:p[0]<south)
   gs=grouped(edges)
   for w,points in gs:
    if not forward:points=points[::-1]
    length=sum(dist(a,b) for a,b in zip(points,points[1:]))/1000
    # Existing clipping may split one OSM way. Append/prepend only shared
    # original vertices, never a geometric connector.
    old=next((r for r in data['roads'] if r['wayId']==w['id'] and r['road']==path),None)
    if old:
     a=[tuple(p) for p in old['points']]
     if a[-1]==points[0]:old['points']=[list(p) for p in a+points[1:]]
     elif points[-1]==a[0]:old['points']=[list(p) for p in points+a[1:]]
     else:raise ValueError('Ambiguous split OSM way '+str(w['id']))
     old['km']=round(old['km']+length,4);continue
    r={'id':'A3-'+str(w['id']),'wayId':w['id'],'road':path,'lanes':3,'km':round(length,4),'posKm':max(r['posKm'] for r in own)+1 if north else min(r['posKm'] for r in own)-1,'points':[list(p) for p in points],'tags':w['tags']}
    own.append(r);data['roads'].append(r);added.append(r)
  anchors[path]={tuple(p) for r in data['roads'] if r['road']==path for p in r['points']}
 for ref,name in [('28','AD Köln-Heumar'),('29','Königsforst'),('30a','Rösrath'),('30b','Lohmar-Nord'),('31','Lohmar'),('44','Bad Camberg')]:
  directional={}
  for path,vertices in anchors.items():
   found=[n for n in nodes if n.get('tags',{}).get('ref')==ref and pt(n) in vertices]
   if not found and ref in ['30a','30b']:continue
   if len(found)!=1:raise ValueError('Missing/ambiguous directional junction '+path+' '+ref+': '+str(len(found)))
   directional[path]={'position':list(pt(found[0])),'nodeId':found[0]['id']}
  access={}
  if ref in ['30a','30b']:
   for path in anchors:
    if path in directional:access[path]={'entry':False,'exit':True};continue
    reference=next(iter(directional.values()))['position'];entries=[]
    for way in source['elements']:
     if way['type']!='way' or way.get('tags',{}).get('highway')!='motorway_link':continue
     points=[pt(p) for p in way['geometry']];ids=way['nodes']
     if way['tags'].get('oneway')=='-1':points.reverse();ids=ids[::-1]
     if points[-1] in anchors[path] and dist(points[-1],reference)<1800:
      entries.append((dist(points[-1],reference),points[-1],ids[-1]))
    if not entries:raise ValueError('Missing half-junction entry '+path+' '+ref)
    _,point,node=min(entries);directional[path]={'position':list(point),'nodeId':node};access[path]={'entry':True,'exit':False}
  data['exits'].append({'road':'A3','ref':ref,'name':name,'source':'osm-junction','position':next(iter(directional.values()))['position'],'directional':directional,**({'access':access} if access else {})})
 data['audit']['regionalExtension']={'sourceTimestamp':source['osm3s']['timestamp_osm_base'],'wayIds':[r['wayId'] for r in added],'method':'exact directed OSM node chains; normal three A3 through lanes, auxiliary lanes kept in raw tags'}
 return data
if __name__=='__main__':
 data=compile_extension(read_data(),json.loads((ROOT/'data/a3-heumar-camberg-osm.json').read_text()))
 (ROOT/'src/geodata.ts').write_text("import type {MapData} from './core.js';\nexport const networkData:MapData="+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n')
 print('roads',len(data['roads']),'exits',len(data['exits']))
