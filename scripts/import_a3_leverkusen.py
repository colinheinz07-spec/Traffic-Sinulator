#!/usr/bin/env python3
"""Reproducible OSM-only northern A3 import, Köln-Ost to AK Leverkusen.
No invented connectors: every mainline and motorway_link segment is from
a directed OSM way and exact shared OSM coordinates.
"""
from __future__ import annotations
import collections, concurrent.futures, copy, heapq, json, math, re, time, urllib.parse, urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'data/a3-leverkusen-osm.json'
def pt(g): return (round(g['lat'],7),round(g['lon'],7))
def dist(a,b):
 return math.hypot((a[0]-b[0])*111195,(a[1]-b[1])*111195*math.cos(math.radians((a[0]+b[0])/2)))
def length(ps): return sum(dist(a,b) for a,b in zip(ps,ps[1:]))
def directed(w):
 ps=[pt(p) for p in w['geometry']]
 return ps[::-1] if w.get('tags',{}).get('oneway')=='-1' else ps
def ref_tokens(w):
 return [r.replace(' ','').upper() for r in re.split('[;,]',w.get('tags',{}).get('ref',''))]
def download_tile(arg):
 lat,lon=arg
 box=f'{lon-.015},{lat-.009},{lon+.015},{lat+.009}'
 url='https://api.openstreetmap.org/api/0.6/map.json?'+urllib.parse.urlencode({'bbox':box})
 for attempt in range(5):
  try:
   request=urllib.request.Request(url,headers={'User-Agent':'Traffic-Sinulator-OSM-study/1.0 (github.com/colinheinz07-spec/Traffic-Sinulator)','Accept':'application/json'})
   with urllib.request.urlopen(request,timeout=80) as response:
    doc=json.load(response)
   print('OSM tile',arg,'elements',len(doc['elements']),flush=True)
   return doc['elements']
  except Exception as err:
   print('retry',arg,attempt,str(err),flush=True)
   time.sleep(min(20,2**attempt*2))
 raise RuntimeError('Missing OSM tile: '+str(arg))
def load_source():
 if SOURCE.exists():
  result=json.loads(SOURCE.read_text()); print('Using retained OSM source',len(result['elements']),flush=True)
  return result
 # 32 overlapping API map cells cover the A3 between Köln-Ost and the
 # Leverkusener Kreuz, along with connected surface roads and motorway links.
 # Keep the ORIGINAL OSM nodes/ways; no spatial interpolation of road lines.
 tiles=[(round(50.952+row*.013,4),round(6.990+col*.028,4))
        for row in range(8) for col in range(4)]
 items={}
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
  for chunk in pool.map(download_tile,tiles):
   for e in chunk: items[(e['type'],e['id'])]=e
 nodes={e['id']:e for e in items.values() if e['type']=='node'}
 allowed={'motorway','motorway_link','trunk','trunk_link','primary','primary_link',
  'secondary','secondary_link','tertiary','tertiary_link',
  'residential','unclassified','living_street'}
 ways=[]
 for e in items.values():
  if e['type']!='way' or e.get('tags',{}).get('highway') not in allowed: continue
  if any(n not in nodes for n in e['nodes']):
   if e.get('tags',{}).get('highway') in ('motorway','motorway_link'):
    raise ValueError('Incomplete motorway OSM node list '+str(e['id']))
   continue
  row={k:e[k] for k in ('type','id','nodes','tags') if k in e}
  row['geometry']=[{'lat':nodes[n]['lat'],'lon':nodes[n]['lon']} for n in e['nodes']]
  ways.append(row)
 junctions=[e for e in nodes.values() if e.get('tags',{}).get('highway')=='motorway_junction']
 result={'source':'OpenStreetMap API 0.6 map; © OpenStreetMap contributors; ODbL',
  'fetchedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
  'elements':ways+junctions}
 SOURCE.parent.mkdir(parents=True,exist_ok=True)
 SOURCE.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')))
 print('Saved',len(ways),'OSM highway ways and',len(junctions),'junction nodes',flush=True)
 return result

def walk(graph,start,goal,minimum=0):
 todo=[(0,start)];cost={start:0};previous={};end=None
 while todo:
  d,u=heapq.heappop(todo)
  if d>cost[u]+.001: continue
  if d>=minimum and goal(u): end=u;break
  for v,w in graph.get(u,()):
   nd=d+dist(u,v)
   if nd<cost.get(v,float('inf')):
    cost[v]=nd;previous[v]=(u,w);heapq.heappush(todo,(nd,v))
 if end is None: raise ValueError('No exact directed OSM carriageway walk from '+str(start))
 edges=[];p=end
 while p!=start:
  before,w=previous[p];edges.append((before,p,w));p=before
 return edges[::-1],end

def groups(edges):
 result=[]
 for a,b,w in edges:
  if result and result[-1][0]['id']==w['id']: result[-1][1].append(b)
  else: result.append((w,[a,b]))
 return result
def endpoints(rows):
 counts=collections.Counter(tuple(p) for r in rows for p in [r['points'][0],r['points'][-1]])
 ends=[p for p,n in counts.items() if n==1]
 if len(ends)!=2: raise ValueError('Disconnected original A3 geometry: '+str(ends))
 return ends

def import_core(doc):
 path=ROOT/'src/geodata.ts';raw=path.read_text()
 match=re.search(r'networkData:MapData=(\{.*\});\s*$',raw,re.S)
 if not match: raise ValueError('Cannot parse embedded networkData')
 data=json.loads(match[1])
 if any(x['road']=='A3' and x['ref']=='23' for x in data['exits']):
  raise ValueError('Leverkusen already imported; not safe to duplicate')
 a3=[w for w in doc['elements'] if w['type']=='way'
     and w.get('tags',{}).get('highway')=='motorway' and 'A3' in ref_tokens(w)]
 graph=collections.defaultdict(list)
 for w in a3:
  ps=directed(w)
  for a,b in zip(ps,ps[1:]):graph[a].append((b,w))
 junctions=[n for n in doc['elements'] if n['type']=='node'
     and n.get('tags',{}).get('highway')=='motorway_junction']
 ak23={pt(n) for n in junctions if n.get('tags',{}).get('ref','').strip()=='23'}
 if not ak23: raise ValueError('OSM dataset lacks AK Leverkusen (AS 23) motorway junction')
 added=[]
 new_roads,vertices={},{}
 for road in ('A3-koeln','A3-frankfurt'):
  old=[r for r in data['roads'] if r['road']==road]
  start=max(endpoints(old))
  road_graph=graph if road=='A3-koeln' else collections.defaultdict(list)
  if road!='A3-koeln':
   for a,edges in graph.items():
    for b,w in edges:road_graph[b].append((a,w))
  edges,at=walk(road_graph,start,lambda p:p in ak23,minimum=2500)
  # Give the crossing actual exit/entry room beyond the 23 diverge.
  extra,finish=walk(road_graph,at,lambda p:dist(p,at)>=300,minimum=300)
  edges+=extra
  if len(edges)<12:raise ValueError('A3 Leverkusen continuation is unexpectedly short: '+road)
  new_roads[road]=edges
  vertices[road]={p for a,b,w in edges for p in (a,b)}
  for w,points in groups(edges):
   tag=w.get('tags',{});raw_count=tag.get('lanes','')
   if not raw_count.isdigit() or not 1<=int(raw_count)<=8:
    raise ValueError('Unverified OSM lane count '+road+' way '+str(w['id'])+': '+str(raw_count))
   ps=points if road=='A3-koeln' else points[::-1]
   existing=next((r for r in old if r['wayId']==w['id']),None)
   if existing:
    prev=list(map(tuple,existing['points']))
    if prev[-1]==ps[0]: existing['points']=[list(p) for p in prev+ps[1:]]
    elif ps[-1]==prev[0]: existing['points']=[list(p) for p in ps+prev[1:]]
    else: raise ValueError('Unconnected retained OSM way '+str(w['id']))
    existing['km']=round(length(list(map(tuple,existing['points'])))/1000,4)
   else:
    if any(r['wayId']==w['id'] for r in old):raise ValueError('Duplicate A3 way '+str(w['id']))
    entry={'id':'A3-'+str(w['id']),'wayId':w['id'],'road':road,
      'lanes':int(raw_count),'km':round(length(ps)/1000,4),
      'posKm':round(max(r['posKm'] for r in old)+len(data['roads'])/1000,4),
      'points':[list(p) for p in ps],
      'tags':{k:v for k,v in tag.items() if k in
       ('ref','highway','oneway','lanes','turn:lanes','maxspeed','destination')}}
    data['roads'].append(entry);old.append(entry);added.append(w['id'])
  print('Extended',road,'by',round(length([a for a,b,w in edges]+[edges[-1][1]])/1000,2),
   'km, ending',finish,flush=True)
 # Verify full northbound and southbound anchors directly on mapped A3.
 all_vertices={road:{tuple(p) for r in data['roads'] if r['road']==road for p in r['points']}
               for road in ('A3-koeln','A3-frankfurt')}
 new_exits=[]
 for ref,fallback in [('26','Köln-Dellbrück'),('25','Köln-Mülheim'),('24','Leverkusen'),('23','AK Leverkusen')]:
  direction={}
  for road,verts in all_vertices.items():
   found=[n for n in junctions if n.get('tags',{}).get('ref','').strip()==ref and pt(n) in verts]
   if len(found)!=1:raise ValueError('Missing/ambiguous A3 directional AS '+ref+' '+road+': '+str(len(found)))
   n=found[0];direction[road]={'position':list(pt(n)),'nodeId':n['id']}
  name=next((n.get('tags',{}).get('name') for n in junctions if
     n.get('tags',{}).get('ref','').strip()==ref and n.get('tags',{}).get('name')),fallback)
  if ref=='23':name='AK Leverkusen'
  exit={'road':'A3','ref':ref,'name':name,'position':direction['A3-koeln']['position'],
        'source':'osm-junction','directional':direction}
  data['exits'].append(exit);new_exits.append(exit)
 data['audit']['leverkusenExtension']={'source':doc.get('source','OSM'),
   'wayIds':sorted(set(added)), 'method':'directed OSM way-node walks, no constructed connector',
   'junctionRefs':[23,24,25,26]}
 path.write_text(raw[:match.start(1)]+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n')
 return data,new_exits,vertices,doc

def import_links(data,new_exits,vertices,doc):
 path=ROOT/'src/network-extensions.ts'
 raw=path.read_text()
 def extract(a,b):
  return json.loads(raw.split(a,1)[1].split(b,1)[0])
 routes=extract('export const extensionRoutes:ExtensionRoute[]=',';\nexport const extensionJunctions')
 points=extract('export const extensionRampBoundaryPoints:Point[]=',';\nconst byId')
 existing={id for r in routes for id in r['wayIds']}
 all_ways=[w for w in doc['elements'] if w['type']=='way' and
     w.get('tags',{}).get('highway')=='motorway_link' and
     w.get('tags',{}).get('access') not in ('no','private') and
     w.get('tags',{}).get('motor_vehicle') not in ('no','private')]
 bypoint=collections.defaultdict(list)
 for w in all_ways:
  for p in (directed(w)[0],directed(w)[-1]):bypoint[p].append(w)
 roots=vertices['A3-koeln']|vertices['A3-frankfurt']
 queue=collections.deque([w for w in all_ways if any(p in roots for p in
      (directed(w)[0],directed(w)[-1]))])
 selected={}
 while queue:
  w=queue.popleft()
  if w['id'] in selected:continue
  selected[w['id']]=w
  for p in (directed(w)[0],directed(w)[-1]):
   for nxt in bypoint[p]:
    if nxt['id'] not in selected:queue.append(nxt)
 new=[]
 for w in sorted(selected.values(),key=lambda w:w['id']):
  if w['id'] in existing:continue
  ps=directed(w)
  if len(ps)<2 or not any(50.947<=p[0]<=51.051 for p in ps):continue
  span=length(ps)
  if span<1:continue
  nearest=min(new_exits,key=lambda x:min(dist(p,tuple(x['position'])) for p in (ps[0],ps[-1])))
  near_m=min(dist(p,tuple(nearest['position'])) for p in (ps[0],ps[-1]))
  if near_m>3700:continue
  zone=(nearest['name'] if nearest['ref']=='23' else
    'A3 AS '+nearest['ref']+' '+nearest['name'])
  count=w.get('tags',{}).get('lanes','1')
  lane=int(count) if count.isdigit() else 1
  lane=max(1,min(4,lane))
  new.append({'id':'extra-a3-lev-ramp-'+str(w['id']),
    'name':zone+' · OSM-Verbindungsfahrbahn '+str(w['id']),
    'zone':zone,'kind':'ramp','lanes':lane,
    'laneSegments':[{'fromM':0,'toM':span,'lanes':lane}],
    'points':[list(p) for p in ps],'wayIds':[w['id']],
    'demandVph':min(1100,450*lane),'freeKmh':70})
 if len(new)<12:raise ValueError('Too few connected OSM A3 motorway_link sections '+str(len(new)))
 routes+=new
 path.write_text(raw.replace('export const EXTENSION_IDS='+raw.split('export const EXTENSION_IDS=',1)[1].split(' as const;',1)[0]+' as const;',
   'export const EXTENSION_IDS='+json.dumps([r['id'] for r in routes])+' as const;')
   .replace('export const extensionRoutes:ExtensionRoute[]='+raw.split('export const extensionRoutes:ExtensionRoute[]=',1)[1].split(';\nexport const extensionJunctions',1)[0]+';',
    'export const extensionRoutes:ExtensionRoute[]='+json.dumps(routes,separators=(',',':'))+';'))
 # Keep derived cache in sync for reproducible existing detour generators.
 cache=ROOT/'data/extension-junctions.json'
 stored=json.loads(cache.read_text());stored['routes']=routes
 cache.write_text(json.dumps(stored,ensure_ascii=False,separators=(',',':')))
 print('Added',len(new),'verified directed OSM motorway-link sections',flush=True)
 return new

def main():
 import sys
 doc=load_source()
 if '--fetch-only' in sys.argv:return
 data,exits,vertices,_=import_core(doc)
 links=import_links(data,exits,vertices,doc)
 # Ensure all four required newly imported junctions have a directional
 # position and every displayed link has a raw OSM way ID.
 for e in exits:
  assert all(k in e['directional'] for k in ('A3-koeln','A3-frankfurt')),e
 for f in links:assert len(f['wayIds'])==1 and len(f['points'])>=2
 print('Leverkusen A3 source and mapped ramps ready',flush=True)
if __name__=='__main__':main()
