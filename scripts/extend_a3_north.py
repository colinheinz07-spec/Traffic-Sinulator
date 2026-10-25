#!/usr/bin/env python3
"""Import the A3 to AK Bonn/Siegburg from the retained OSM source.

Walk exact, directed OSM node edges from each existing northern endpoint.
No snapped connectors, generated road vertices, reverse carriageways or
fallback lane counts. The last point is a real OSM vertex north of the AK.
The input snapshot is retained so this import is reproducible offline.
"""
import collections
import copy
import heapq
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / 'src/geodata.ts'
SOURCE_PATH = ROOT / 'data/a3-north-osm.json'
END_LAT = 50.785


def point(p):
    return (round(p['lat'], 7), round(p['lon'], 7))


def metres(a, b):
    return math.hypot((a[0]-b[0])*111195,
        (a[1]-b[1])*111195*math.cos(math.radians((a[0]+b[0])/2)))


def compile_extension(original, source):
    data = copy.deepcopy(original)
    if any(e['road']=='A3' and e['ref']=='33' for e in data['exits']):
        raise ValueError('A3 northern extension already present')
    ways = [e for e in source['elements'] if e['type']=='way'
        and e.get('tags', {}).get('highway')=='motorway'
        and e['tags'].get('ref', '').replace(' ', '')=='A3']
    # Reverse the graph only for the upstream walk of the Frankfurt road.
    adjacency = collections.defaultdict(list)
    for w in ways:
        pts = [point(p) for p in w['geometry']]
        if w['tags'].get('oneway')=='-1':
            pts.reverse()
        for a, b in zip(pts, pts[1:]):
            adjacency[a].append((b, w))
    added = []
    endpoints, lengths, vertices = {}, {}, {}
    for path in ['A3-koeln', 'A3-frankfurt']:
        old = [r for r in data['roads'] if r['road']==path]
        counts = collections.Counter(tuple(p) for w in old
            for p in (w['points'][0], w['points'][-1]))
        terminals = [p for p, n in counts.items() if n==1]
        if len(terminals)!=2:
            raise ValueError('Existing motorway is not continuous: '+path)
        start = max(terminals)
        graph = adjacency
        if path=='A3-frankfurt':
            graph = collections.defaultdict(list)
            for a, edges in adjacency.items():
                for b, way in edges:
                    graph[b].append((a, way))
        frontier, costs, previous = [(0, start)], {start: 0}, {}
        finish = None
        while frontier:
            cost, at = heapq.heappop(frontier)
            if cost>costs[at]+.001:
                continue
            if at[0]>=END_LAT:
                finish=at
                break
            for to, way in graph[at]:
                new_cost=cost+metres(at, to)
                if new_cost<costs.get(to, float('inf')):
                    costs[to]=new_cost
                    previous[to]=(at, way)
                    heapq.heappush(frontier, (new_cost, to))
        if finish is None:
            raise ValueError('No exact OSM continuation to Bonn/Siegburg: '+path)
        edges, at = [], finish
        while at!=start:
            before, way=previous[at]
            edges.append((before, at, way))
            at=before
        edges.reverse()
        groups=[]
        for a, b, way in edges:
            if groups and groups[-1][0]['id']==way['id']:
                groups[-1][1].append(b)
            else:
                groups.append((way, [a, b]))
        vertices[path]={p for _, pts in groups for p in pts}
        for way, pts in groups:
            raw=way['tags'].get('lanes')
            if not raw or not raw.isdigit() or not 1<=int(raw)<=5:
                raise ValueError('Unverified OSM lane count on '+str(way['id']))
            if any(r['wayId']==way['id'] for r in data['roads']):
                raise ValueError('Extension would duplicate an existing OSM way')
            if path=='A3-frankfurt':
                pts=list(reversed(pts))
            length=sum(metres(a,b) for a,b in zip(pts,pts[1:]))
            added.append({'id':f'A3-{way["id"]}', 'wayId':way['id'],
                'road':path, 'points':[list(p) for p in pts], 'lanes':int(raw),
                'km':round(length/1000,4), 'posKm':round(max(r['posKm'] for r in old)+(costs[pts[0]]+costs[pts[-1]])/2000,4),
                'tags':{k:v for k,v in way['tags'].items()
                    if k in ['ref','lanes','maxspeed','oneway','highway']}})
        endpoints[path]=list(finish)
        lengths[path]=round(costs[finish]/1000,4)
    junctions=[]
    for ref, name in [('33','Siebengebirge'), ('32','AK Bonn/Siegburg (A560)')]:
        directional={}
        for n in source['elements']:
            if n['type']!='node' or n.get('tags',{}).get('ref')!=ref:
                continue
            for path, pts in vertices.items():
                if point(n) not in pts:
                    continue
                if path in directional:
                    raise ValueError('Ambiguous motorway junction '+ref)
                directional[path]={'position':list(point(n)), 'nodeId':n['id']}
                junctions.append({**n,'paths':[path]})
        if len(directional)!=2:
            raise ValueError('Missing directional OSM junction '+ref)
        data['exits'].append({'road':'A3','ref':ref,'name':name,
            'source':'osm-junction','position':directional['A3-frankfurt']['position'],
            'directional':directional})
    data['roads']+=added
    data['audit']['northExtension']={'sourceTimestamp':source['osm3s']['timestamp_osm_base'],
        'ways':len(added),'wayIds':[r['wayId'] for r in added],
        'lengthsKm':lengths,'endpoints':endpoints,
        'method':'exact directed OSM node edges; clipped only at original OSM vertices'}
    return data, added, junctions


def main():
    text=DATA_PATH.read_text()
    match=re.search(r'networkData:\s*MapData\s*=\s*(\{.*\});?\s*$',text,re.S)
    if not match:
        raise ValueError('Embedded map data not found')
    original=json.loads(match[1])
    data, added, junctions=compile_extension(original,json.loads(SOURCE_PATH.read_text()))
    DATA_PATH.write_text(text[:match.start(1)]+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n')
    audit_path=ROOT/'data/junction-audit.json'
    audit=json.loads(audit_path.read_text())
    audit['junctions']+=junctions
    audit['wayIds']=sorted(set(audit['wayIds'])|{r['wayId'] for r in added})
    audit['selected'] += [{k:e[k] for k in ['road','ref','name','directional']} for e in data['exits'] if e['road']=='A3' and e['ref'] in ['32','33']]
    audit['northernExtension']={'imported':'2026-10-25',**data['audit']['northExtension']}
    audit_path.write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
    lane_path=ROOT/'data/lane-audit.json'
    lane=json.loads(lane_path.read_text())
    raw={w['id']:w for w in json.loads(SOURCE_PATH.read_text())['elements'] if w['type']=='way'}
    for r in added:
        lane['roads'].append({'wayId':r['wayId'],'road':r['road'],'km':r['km'],
            'modelLanes':r['lanes'],'osmLanes':int(raw[r['wayId']]['tags']['lanes']),
            'status':'matches','tags':r['tags'],'nearDernbach':False})
        lane['roadSummary'][r['road']]['matches']+=1
    lane['queriedIds']+=len(added)
    lane['receivedIds']+=len(added)
    lane['northernExtension']={'imported':'2026-10-25',**data['audit']['northExtension']}
    lane_path.write_text(json.dumps(lane,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(data['audit']['northExtension'],ensure_ascii=False))


if __name__=='__main__':
    main()
