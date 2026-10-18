#!/usr/bin/env python3
"""Close map geometry gaps ONLY by importing existing OSM motorway ways.

No extrapolated chords, connector geometry, or local-road routing. The algorithm
accepts a candidate chain only if it joins TWO formerly disconnected components
of the SAME directional motorway through exact shared OSM coordinates.
"""
import collections
import datetime as dt
import heapq
import json
import math
from pathlib import Path
import re
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / 'src/geodata.ts'
HOSTS = (
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
)
QUERY = '''[out:json][timeout:120];(
  way["highway"="motorway"]["ref"~"^A ?3$"](50.34,7.28,50.72,8.15);
  way["highway"="motorway"]["ref"~"^A ?48$"](50.34,7.28,50.72,8.15);
);out body geom;'''


def key(p):
    return (round(p[0], 7), round(p[1], 7))


def metres(a, b):
    return math.hypot((a[0]-b[0])*111195, (a[1]-b[1])*111195*math.cos(math.radians((a[0]+b[0])/2)))


def length(points):
    return sum(metres(a, b) for a,b in zip(points,points[1:]))


def fetch_osm():
    if len(__import__('sys').argv) > 1:
        return json.loads(Path(__import__('sys').argv[1]).read_text())['elements']
    errors=[]
    for host in HOSTS:
        for attempt in range(2):
            try:
                print('Fetching verified OSM motorway geometry', host, 'attempt', attempt+1, flush=True)
                req=urllib.request.Request(host,
                    data=urllib.parse.urlencode({'data':QUERY}).encode('utf8'),
                    headers={'User-Agent':'Traffic-Sinulator A3A48 motorway geometry fix/0.4','Accept':'application/json'},
                    method='POST')
                with urllib.request.urlopen(req,timeout=135) as response:
                    items=json.load(response)['elements']
                if len(items)<250:raise ValueError('Overpass returned fewer than 250 motorway ways')
                print('Received',len(items),'motorway ways',flush=True)
                return items
            except Exception as exc:
                errors.append(str(exc)[:120]);time.sleep(2+attempt)
    raise RuntimeError('No verified OSM download: '+str(errors))


def terminals(roads):
    ends=collections.defaultdict(list)
    for idx, road in enumerate(roads):
        for endpoint in [road['points'][0],road['points'][-1]]:
            ends[key(endpoint)].append(idx)
    return {pt:ids[0] for pt,ids in ends.items() if len(ids)==1}


def components(roads):
    terminal_owners={}
    parent=list(range(len(roads)))
    def find(i):
        while parent[i]!=i:
            parent[i]=parent[parent[i]];i=parent[i]
        return i
    for i, r in enumerate(roads):
        for p in [r['points'][0],r['points'][-1]]:
            k=key(p)
            if k in terminal_owners:
                a=find(i);b=find(terminal_owners[k]);parent[a]=b
            else:terminal_owners[k]=i
    return {i:find(i) for i in range(len(roads))}


def candidate_graph(elements, already_ids, motorway):
    graph=collections.defaultdict(list)
    for el in elements:
        if el.get('type')!='way' or el['id'] in already_ids:continue
        tags=el.get('tags',{})
        if tags.get('highway')!='motorway':continue
        refs={t.strip().replace(' ','') for t in tags.get('ref','').split(';')}
        if motorway not in refs:continue
        points=[[round(p['lat'],7),round(p['lon'],7)] for p in el.get('geometry',[])]
        if len(points)<2:continue
        total=length(points)
        if total<2 or total>450:continue
        a,b=key(points[0]),key(points[-1]);data=(el,points,total)
        graph[a].append((b,data));graph[b].append((a,data))
    return graph


def shortest_bridge(start, goals, graph, limit=400, max_hops=5):
    frontier=[(0,0,start,[])];best={(start,0):0}
    while frontier:
        cost,hops,node,path=heapq.heappop(frontier)
        if cost>limit:break
        if node in goals and node!=start and path:return cost,node,path
        if hops>=max_hops:continue
        for to,data in graph.get(node,[]):
            edge=data[2];new_cost=cost+edge
            if new_cost>limit or new_cost>=best.get((to,hops+1),float('inf')):continue
            best[(to,hops+1)]=new_cost
            heapq.heappush(frontier,(new_cost,hops+1,to,path+[(node,to,data)]))
    return None


def collect_verified_bridges(data, osm):
    existing={r['wayId'] for r in data['roads']}
    added=[];details={}
    for rid in ['A3-koeln','A3-frankfurt','A48-dernbach','A48-koblenz']:
        road_name='A3' if rid.startswith('A3-') else 'A48'
        entries=[r for r in data['roads'] if r['road']==rid]
        before=terminals(entries)
        graph=candidate_graph(osm,existing,road_name)
        original_components=components(entries)
        attempts=[]
        for source,index in before.items():
            targets={p for p,other in before.items() if original_components[index]!=original_components[other]
                and metres(source,p)<350}
            if not targets:continue
            result=shortest_bridge(source,targets,graph)
            if result:attempts.append((result[0],source,result[1],result[2]))
        taken=set()
        connected=set()
        for cost,start,end,path in sorted(attempts,key=lambda x:x[0]):
            ids=[edge[2][0]['id'] for edge in path]
            if start in connected or end in connected or any(w in existing or w in taken for w in ids):continue
            # No interpolated points: every added vertex must originate from OSM way.geometry.
            for a,b,(el,pts,dist) in path:
                tags=el['tags']
                forward=key(pts[0])==a
                oriented=pts if forward else list(reversed(pts))
                try:lanes=int(tags.get('lanes:forward') or tags.get('lanes') or '3')
                except ValueError:lanes=3
                lanes=max(1,min(7,lanes))
                matching=entries[before[start]]
                added.append({'id':'A'+('3' if road_name=='A3' else '48')+'-'+str(el['id']),
                    'wayId':el['id'],'road':rid,'points':oriented,'lanes':lanes,
                    'km':round(dist/1000,4),'posKm':matching['posKm'],
                    'tags':{k:str(tags[k]) for k in ('ref','maxspeed','lanes','lanes:forward') if tags.get(k)}})
                taken.add(el['id'])
            existing.update(ids)
            connected.update((start,end))
        after=terminals(entries+[r for r in added if r['road']==rid])
        details[rid]={'danglingBefore':len(before),'danglingAfter':len(after),'waysAdded':sum(r['road']==rid for r in added)}
    return added,details


def main():
    source=DATA_PATH.read_text()
    match=re.search(r'export const networkData:\s*MapData\s*=\s*(\{.*\});?\s*$',source,re.S)
    if not match:raise RuntimeError('Embedded dataset TypeScript syntax has changed')
    data=json.loads(match.group(1))
    if data['audit'].get('gapRepair'):
        print('Already repaired; no duplicate import');return
    osm=fetch_osm()
    repaired,report=collect_verified_bridges(data,osm)
    print('Repair audit:',json.dumps(report), 'Imported',len(repaired),'OSM motorway ways',flush=True)
    if len(repaired)<10:raise RuntimeError('Less than ten verifiable gap ways: import rejected')
    for road in ['A3-koeln','A3-frankfurt']:
        if report[road]['danglingAfter']>=report[road]['danglingBefore']-6:
            raise RuntimeError('A3 corridor gap repair did not meaningfully reduce open ends: '+road)
    data['roads']+=repaired
    data['roads'].sort(key=lambda r:(r['road'],r['posKm'],r['wayId']))
    data['audit']['gapRepair']={'verifiedWays':len(repaired),'terminalAudit':report,
       'method':'exact OSM node-to-node bridges; only highway=motorway and same A3/A48 ref'}
    data['created']=dt.datetime.now(dt.timezone.utc).isoformat()
    DATA_PATH.write_text(source[:match.start(1)]+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n')

if __name__=='__main__':main()
