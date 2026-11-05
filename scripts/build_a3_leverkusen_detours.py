#!/usr/bin/env python3
"""Calculate only legally directed local A3-Leverkusen alternatives on OSM.
Output contains actual way vertices and shared way IDs, not straight lines.
Turn-restriction relations and signal phases remain unmodelled assumptions.
"""
from __future__ import annotations
import collections,heapq,json,math,re
from pathlib import Path
from import_a3_leverkusen import ROOT,pt,dist,directed,length

SOURCE=ROOT/'data/a3-leverkusen-osm.json'
SPEED={'motorway_link':55,'trunk':65,'trunk_link':40,'primary':55,
 'primary_link':35,'secondary':45,'secondary_link':30,'tertiary':35,
 'tertiary_link':25,'residential':25,'unclassified':30,'living_street':12}
def read_core():
 s=(ROOT/'src/geodata.ts').read_text()
 return json.loads(re.search(r'networkData:MapData=(\{.*\});\s*$',s,re.S)[1])
def a3_chain(core,path):
 rows=[r for r in core['roads'] if r['road']==path]
 adjacency=collections.defaultdict(list)
 for r in rows:
  ps=list(map(tuple,r['points']))
  for a,b in zip(ps,ps[1:]):adjacency[a].append(b);adjacency[b].append(a)
 ends=[p for p,bs in adjacency.items() if len(bs)==1]
 if len(ends)!=2:raise ValueError('Disconnected core A3 '+path)
 start=min(ends) if path=='A3-koeln' else max(ends)
 points=[start];previous=None;seen={start}
 while True:
  others=[p for p in adjacency[points[-1]] if p!=previous]
  if not others:break
  if len(others)!=1 or others[0] in seen:raise ValueError('A3 branched or looped '+path)
  previous=points[-1];points.append(others[0]);seen.add(others[0])
 return points
def shortest(graph,start,goals):
 frontier=[(0,start)];lengths={start:0};prev={}
 while frontier:
  d,p=heapq.heappop(frontier)
  if d>lengths[p]+1e-9:continue
  if p in goals:
   edges=[]
   while p!=start:
    before,w=prev[p];edges.append((before,p,w));p=before
   return edges[::-1]
  for to,w in graph.get(p,()):
   nd=d+dist(p,to)/1000/SPEED[w['tags']['highway']]*60
   if nd<lengths.get(to,float('inf')):
    lengths[to]=nd;prev[to]=(p,w);heapq.heappush(frontier,(nd,to))
 return None
def main():
 doc=json.loads(SOURCE.read_text());core=read_core()
 ways=[w for w in doc['elements'] if w['type']=='way' and
     w.get('tags',{}).get('highway') in SPEED and
     w.get('tags',{}).get('access') not in ('private','no') and
     w.get('tags',{}).get('motor_vehicle') not in ('private','no') and
     w.get('tags',{}).get('motorcar') not in ('private','no')]
 graph=collections.defaultdict(list)
 for w in ways:
  ps=directed(w);oneway=w['tags'].get('oneway')!='no' and (w['tags'].get('oneway') in ('yes','1','-1') or w['tags']['highway'].endswith('_link') or w['tags'].get('junction')=='roundabout')
  for a,b in zip(ps,ps[1:]):
   graph[a].append((b,w))
   if not oneway:graph[b].append((a,w))
 records=[]
 for path in ('A3-koeln','A3-frankfurt'):
  ps=a3_chain(core,path);positions={p:i for i,p in enumerate(ps)}
  anchors=[]
  for j in core['exits']:
   if j['road']!='A3' or j['ref'] not in ('23','24','25','26'):continue
   p=tuple(j['directional'][path]['position'])
   if p not in positions:raise ValueError('Lost original motorway anchor '+path+' '+j['ref'])
   anchors.append((positions[p],j,p))
  anchors.sort(key=lambda x:x[0])
  if len(anchors)!=4:raise ValueError('Four A3 Leverkusen interchanges not retained')
  # Actual incoming motorway_link endpoints on this directed carriageway.
  entrances=collections.defaultdict(set)
  for w in ways:
   if w['tags']['highway']!='motorway_link':continue
   psw=directed(w)
   if psw[-1] in positions and psw[0] not in positions:
    entrances[psw[-1]].add(w['id'])
  for idx,j,start in anchors:
   if j['ref']=='23':continue # an AK is not a generic local-street exit
   # Match physically downstream ordinary AS only, not A1 at AK Leverkusen.
   for ti,tj,nominal in anchors:
    if ti<=idx or tj['ref']=='23':continue
    # Only the next two junctions; distant arrivals require separate choices.
    if sum(1 for k,_,_ in anchors if idx<k<=ti)>2:continue
    targets={p for p in entrances if positions[p]>idx and
      dist(p,nominal)<900}
    if not targets:continue
    edges=shortest(graph,start,targets)
    if not edges:continue
    if not any(w['tags']['highway']!='motorway_link' for a,b,w in edges):continue
    points=[edges[0][0]]+[b for a,b,w in edges]
    km=length(points)/1000
    if not 0.6<km<30:continue
    ids=list(dict.fromkeys(w['id'] for a,b,w in edges))
    minutes=sum(dist(a,b)/1000/SPEED[w['tags']['highway']]*60 for a,b,w in edges)
    record={'id':'LEV-'+path+'-'+j['ref']+'-to-'+tj['ref'],
     'path':path,'targetPath':path,'fromRef':j['ref'],'toRef':tj['ref'],
     'fromPoint':list(start),'toPoint':list(points[-1]),
     'points':[list(p) for p in points],'wayIds':ids,'lengthKm':km,
     'freeMinutes':minutes,'motorway':False,'exitIsInterchange':False,
     'capacityVph':900,'legs':[]}
    records.append(record)
 print('Retained',len(records),'distinct verified A3 urban alternatives',flush=True)
 # No routes are invented to connect missing OSM geometry. The ordinary
 # bundled simulator remains available when the local OSM graph lacks a route.
 output=("import type {ExtensionDetour} from './extension-detours-data.js';\n"+
   'export const leverkusenDetours:ExtensionDetour[]='+json.dumps(records,ensure_ascii=False,separators=(',',':'))+';\n')
 (ROOT/'src/leverkusen-detours-data.ts').write_text(output)
if __name__=='__main__':main()
