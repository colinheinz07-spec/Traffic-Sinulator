#!/usr/bin/env python3
"""Build only OSM-connected A1 Leverkusen arms and real AK Leverkusen turns.

The mainline stubs end at the OSM coverage boundary; they are not a claim
that the A1 is already connected to Cologne-West or the entire Ruhrgebiet.
No connector between nearby but non-shared road vertices is created.
"""
import collections,json
from pathlib import Path
from import_a3_leverkusen import ROOT,pt,dist,directed,groups,walk,length

def main():
 document=json.loads((ROOT/'data/a3-leverkusen-osm.json').read_text())
 ways=[w for w in document['elements'] if w['type']=='way' and w.get('geometry')]
 a1=[w for w in ways if w.get('tags',{}).get('highway')=='motorway'
     and 'A1' in [t.replace(' ','') for t in w['tags'].get('ref','').split(';')]]
 graph=collections.defaultdict(list);incoming=collections.Counter()
 for w in a1:
  points=directed(w)
  for p,q in zip(points,points[1:]):
   graph[p].append((q,w));incoming[q]+=1
 starts=[p for p in graph if incoming[p]==0]
 ends={p for p in incoming if not graph[p]}
 if len(starts)!=2 or len(ends)!=2:
  raise ValueError('A1 has not exactly two directed carriageways at Leverkusen')
 def extract(s,a,b): return json.loads(s.split(a,1)[1].split(b,1)[0])
 path=ROOT/'src/network-extensions.ts';text=path.read_text()
 routes=extract(text,'export const extensionRoutes:ExtensionRoute[]=',';\nexport const extensionJunctions')
 junctions=extract(text,'export const extensionJunctions:Exit[]=',';\nexport const extensionRampBoundaryPoints')
 if any(r['id'].startswith('extra-a1-leverkusen-') for r in routes):
  raise ValueError('Leverkusen A1 already imported')
 added=[];trunks={}
 for start in starts:
  edges,finish=walk(graph,start,lambda p:p in ends,minimum=2500)
  if len(edges)<25:raise ValueError('Too-short A1 motorway corridor')
  east=finish[1]>start[1]
  key='extra-a1-leverkusen-dortmund' if east else 'extra-a1-leverkusen-koeln'
  points=[edges[0][0]]+[b for a,b,w in edges];lanes=[];segments=[];metre=0
  way_ids=[]
  for w,ps in groups(edges):
   tag=w.get('tags',{});raw=tag.get('lanes','')
   if not raw.isdigit() or int(raw)<1 or int(raw)>7:raise ValueError('Unverified A1 lanes for '+str(w['id']))
   metres=length(ps);count=int(raw)
   segments.append({'fromM':metre,'toM':metre+metres,'lanes':count});metre+=metres
   way_ids.append(w['id']);lanes.append(count)
  added.append({'id':key,
   'name':'A1 → Dortmund / Wuppertal' if east else 'A1 → Köln / Koblenz',
   'zone':'AK Leverkusen (A1/A3)','kind':'motorway','lanes':max(lanes),
   'laneSegments':segments,'points':[list(p) for p in points],
   'wayIds':list(dict.fromkeys(way_ids)),'demandVph':1800,'freeKmh':120})
  trunks[key]=set(points)
  print('A1',key,'metres',round(metre),'OSM ways',len(way_ids),flush=True)
 # The two directional A1 ramps and both A3 directions use the same
 # retained original OSM nodes, not nearest-point snapping.
 core=ROOT/'src/geodata.ts'
 import re
 data=json.loads(re.search(r'networkData:MapData=(\{.*\});\s*$',core.read_text(),re.S)[1])
 for road in ('A3-koeln','A3-frankfurt'):
  trunks[road]={tuple(p) for r in data['roads'] if r['road']==road for p in r['points']}
 for ref,name in [('98','AK Leverkusen'),('99','AK Leverkusen-West')]:
  directional={}
  for n in document['elements']:
   if (n['type']!='node' or n.get('tags',{}).get('ref')!=ref or
      n.get('tags',{}).get('highway')!='motorway_junction'):continue
   for key,vertices in trunks.items():
    if not key.startswith('extra-a1-leverkusen-') or pt(n) not in vertices:continue
    directional[key]={'position':list(pt(n)),'nodeId':n['id']}
  if directional:
   junctions.append({'road':'A1','ref':ref,'name':name,'position':next(iter(directional.values()))['position'],
    'source':'osm-junction','directional':directional})
 # All A3/A1 motorway-to-motorway turns are exact directed motorway_link
 # walks. Some movements cannot be represented from the available OSM
 # coverage; do not invent them or connect opposing carriageways.
 links=collections.defaultdict(list)
 for w in ways:
  tags=w.get('tags',{})
  if (tags.get('highway')!='motorway_link' or tags.get('access') in ('no','private') or
      tags.get('motor_vehicle') in ('no','private')):continue
  points=directed(w)
  for p,q in zip(points,points[1:]):links[p].append((q,w))
 names={'A3-koeln':'A3 Köln','A3-frankfurt':'A3 Frankfurt',
  'extra-a1-leverkusen-dortmund':'A1 Dortmund','extra-a1-leverkusen-koeln':'A1 Köln'}
 turns=[]
 for source,from_points in trunks.items():
  for target,to_points in trunks.items():
   if source==target or (source.startswith('A3-')==target.startswith('A3-')):continue
   candidates=[]
   for start in from_points & links.keys():
    if start[0]<51.031:continue
    try:edges,finish=walk(links,start,lambda p:p in to_points,minimum=40)
    except ValueError:continue
    if edges and sum(dist(a,b) for a,b,w in edges)<5500:candidates.append(edges)
   if not candidates:continue
   edges=min(candidates,key=lambda es:sum(dist(a,b) for a,b,w in es))
   points=[edges[0][0]]+[b for a,b,w in edges]
   segments=[];metre=0;count=1
   for w,ps in groups(edges):
    raw=w.get('tags',{}).get('lanes','1')
    n=int(raw) if raw.isdigit() else 1
    n=max(1,min(3,n));count=max(count,n)
    metres=length(ps);segments.append({'fromM':metre,'toM':metre+metres,'lanes':n});metre+=metres
   turns.append({'id':'extra-leverkusen-turn-'+source+'-to-'+target,
    'name':'AK Leverkusen · '+names[source]+' → '+names[target],
    'zone':'AK Leverkusen (A1/A3)','kind':'ramp','lanes':count,
    'laneSegments':segments,'points':[list(p) for p in points],
    'wayIds':list(dict.fromkeys(w['id'] for a,b,w in edges)),
    'demandVph':650,'freeKmh':65})
 print('Complete actual A3/A1 motorway-link turns:',len(turns),flush=True)
 if len(turns)<4:raise ValueError('Too few physically connected A1/A3 movements')
 # Do not draw each already-covered link twice as an additional independent
 # queue. A complete AK turn uses its own capacity-constrained path.
 complete_ids={wid for t in turns for wid in t['wayIds']}
 routes=[r for r in routes if not
  (r['id'].startswith('extra-a3-lev-ramp-') and r['wayIds'][0] in complete_ids)]
 routes+=added+turns
 ids=[r['id'] for r in routes]
 if len(ids)!=len(set(ids)):raise ValueError('Non-unique Leverkusen road ids')
 old='export const EXTENSION_IDS='+text.split('export const EXTENSION_IDS=',1)[1].split(' as const;',1)[0]+' as const;'
 text=text.replace(old,'export const EXTENSION_IDS='+json.dumps(ids)+' as const;')
 start='export const extensionRoutes:ExtensionRoute[]='
 original=text.split(start,1)[1].split(';\nexport const extensionJunctions',1)[0]
 text=text.replace(start+original+';',start+json.dumps(routes,ensure_ascii=False,separators=(',',':'))+';')
 start='export const extensionJunctions:Exit[]='
 original=text.split(start,1)[1].split(';\nexport const extensionRampBoundaryPoints',1)[0]
 text=text.replace(start+original+';',start+json.dumps(junctions,ensure_ascii=False,separators=(',',':'))+';')
 path.write_text(text)
 cache=ROOT/'data/extension-junctions.json'
 cache.write_text(json.dumps({'routes':routes,'junctions':junctions},ensure_ascii=False,separators=(',',':')))
if __name__=='__main__':main()
