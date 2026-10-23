#!/usr/bin/env python3
"""Extend *only* the real A3 ways from AS Diez to AS Limburg-Sued using OSM.

No OSRM route, straight substitute, artificial branch connector or drawn interpolation.
Runs on GitHub Actions (network-enabled), writes TypeScript's embedded map data.
"""
import datetime as dt
import json
import math
import pathlib
import re
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
TS_FILE = ROOT / 'src' / 'geodata.ts'
HOSTS = (
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
)
# The points are used solely for coarse geographic exclusion, never displayed as roads.
CORRIDOR = ((50.4242, 7.9276), (50.405, 8.010), (50.397, 8.075), (50.382, 8.104))


def distance(a, b):
    return math.hypot((b[0]-a[0])*111320, (b[1]-a[1])*111320*math.cos(math.radians((a[0]+b[0])/2)))


def nearest_to_polyline(pt, poly):
    best = float('inf')
    for a, b in zip(poly, poly[1:]):
        dx=(b[1]-a[1])*math.cos(math.radians(pt[0]))*111320
        dy=(b[0]-a[0])*111320
        px=(pt[1]-a[1])*math.cos(math.radians(pt[0]))*111320
        py=(pt[0]-a[0])*111320
        u = max(0, min(1, (dx*px+dy*py)/(dx*dx+dy*dy))) if dx*dx+dy*dy else 0
        q=(a[0]+u*(b[0]-a[0]),a[1]+u*(b[1]-a[1]))
        best=min(best,distance(pt,q))
    return best


def get_elements():
    # Geography bounded to the A3 between Diez and Limburg-Sued; include margin
    # so that OSM 'way' fragments overlapping the existing network are found.
    query=('''[out:json][timeout:90];(
      way["highway"="motorway"]["ref"~"^A ?3$"](50.351,7.905,50.434,8.129);
      node["highway"="motorway_junction"](50.351,7.905,50.434,8.129);
    );out body geom;''')
    errors=[]
    for host in HOSTS:
        for attempt in range(2):
            try:
                req=urllib.request.Request(host,
                    data=urllib.parse.urlencode({'data': query}).encode('utf8'),
                    headers={'User-Agent': 'Traffic-Sinulator map extension/0.2 (OSM credit in README)', 'Accept':'application/json'},
                    method='POST')
                print('Overpass:',host,'attempt',attempt+1,flush=True)
                with urllib.request.urlopen(req,timeout=110) as f:data=json.load(f)
                entries=data.get('elements',[])
                if len(entries)<15:raise RuntimeError('OSM response too short')
                print('Received',len(entries),'OSM objects',flush=True)
                return entries
            except Exception as e:
                errors.append(str(e)[:150]);time.sleep(2+attempt)
    raise RuntimeError('Unable to retrieve OSM A3 geometry: '+' | '.join(errors))


def compile_extension(data, elements):
    known={w['wayId'] for w in data['roads']}
    roads=[]
    for el in elements:
        tags=el.get('tags',{})
        if el['type']!='way' or tags.get('highway')!='motorway':continue
        refs={part.replace(' ','').upper() for part in str(tags.get('ref','')).split(';')}
        if 'A3' not in refs or el['id'] in known:continue
        geom=el.get('geometry') or []
        if len(geom)<2:continue
        points=[[round(x['lat'],7),round(x['lon'],7)] for x in geom]
        if tags.get('oneway')=='-1':points.reverse()
        # Exclude old sections outside the extension and unrelated A3 ways.
        midpoint=points[len(points)//2]
        if not (midpoint[1]>=7.924 and midpoint[0]<50.427):continue
        if nearest_to_polyline(midpoint,CORRIDOR)>2800:continue
        first,last=points[0],points[-1]
        # Mainline A3 is SE-bound toward Frankfurt (longitude generally rising).
        # This direction check uses actual OSM way order and no route snapping.
        progress=(last[1]-first[1])*math.cos(math.radians(50.4))-(last[0]-first[0])*.3
        if abs(progress)<.000012:continue
        road='A3-frankfurt' if progress>0 else 'A3-koeln'
        length=sum(distance(a,b) for a,b in zip(points,points[1:]))
        if length<8:continue
        value=tags.get('lanes:forward') or tags.get('lanes')
        try: lanes=int(str(value))
        except (ValueError,TypeError):lanes=3
        lanes=max(1,min(5,lanes))
        # New extension positions are negative relative to Diez, unlike northbound baseline.
        span=distance(CORRIDOR[0],midpoint)/1000
        roads.append({'id':f'A3-{el["id"]}', 'wayId':el['id'], 'road':road,
          'points':points, 'lanes':lanes, 'km':round(length/1000,4),
          'posKm':-round(span,4),
          'tags':{k:str(tags[k]) for k in ('ref','maxspeed','lanes','lanes:forward') if tags.get(k)}})
    # A named interchange can have off-ramps far apart in each direction.
    # Match OSM junction nodes to the actual carriageway, not the closest
    # point to a coarse corridor (which mixed Limburg's two directions).
    mainline_points={road:{tuple(p) for w in data['roads']+roads if w['road']==road for p in w['points']}
        for road in ('A3-frankfurt','A3-koeln')}
    for ref,label in [('42','Limburg-Nord'),('43','Limburg-Süd')]:
        directional={}
        for e in elements:
            if e['type']!='node' or e.get('tags',{}).get('highway')!='motorway_junction':continue
            refs={s.strip() for s in str(e.get('tags',{}).get('ref','')).replace(' ','').split(';')}
            if ref not in refs:continue
            p=[e['lat'],e['lon']]
            for road,points in mainline_points.items():
                if tuple(p) not in points:continue
                if road in directional:raise RuntimeError(f'Ambiguous OSM junction {ref} on {road}')
                directional[road]={'position':p,'nodeId':e['id']}
        if len(directional)!=2:raise RuntimeError(f'Missing directional OSM junction {ref} {label}')
        data['exits']=[x for x in data['exits'] if not(x['road']=='A3' and x['ref']==ref)]
        data['exits'].append({'road':'A3','ref':ref,'name':label,
            'position':directional['A3-frankfurt']['position'],'source':'osm-junction','directional':directional})
    for road in ('A3-frankfurt','A3-koeln'):
        south=[x for x in roads if x['road']==road]
        if len(south)<8 or sum(r['km'] for r in south)<9:
            raise RuntimeError(f'Unverified southbound extension {road}: {len(south)} ways and {sum(r["km"] for r in south):.2f} km')
        if not any(any(p[1]>8.085 and p[0]<50.399 for p in item['points']) for item in south):
            raise RuntimeError(f'OSM roads do not reach Limburg-Sued in {road}')
        if not any(any(abs(p[1]-7.927)<.004 and abs(p[0]-50.421)<.011 for p in item['points']) for item in south):
            raise RuntimeError(f'Extension not connected to the Diez area in {road}')
    data['roads']+=roads
    data['roads'].sort(key=lambda r:(r['road'],r['posKm'],r['wayId']))
    data['audit']['extension']='A3 Diez(41) – Limburg-Nord(42) – Limburg-Süd(43), OSM mainline only'
    data['audit']['extensionWays']=len(roads)
    data['audit']['extensionLengthsKm']={road:round(sum(r['km'] for r in roads if r['road']==road),2)
        for road in ('A3-koeln','A3-frankfurt')}
    # Original directional coverage was computed for Diez–Bad Honnef, not the extension.
    data['audit']['originalCoverageOnly']=True
    data['created']=dt.datetime.now(dt.timezone.utc).isoformat()
    print('Added',len(roads),'mainline ways',data['audit']['extensionLengthsKm'],'13 ->',len(data['exits']),'exits',flush=True)
    return data


def main():
    text=TS_FILE.read_text(encoding='utf8')
    match=re.search(r'export const networkData:\s*MapData\s*=\s*(\{.*\});?\s*$',text,re.S)
    if not match:raise RuntimeError('TypeScript geodata shape not found')
    old=json.loads(match.group(1))
    if any(e['road']=='A3' and e['ref']=='43' for e in old['exits']):
        print('Already extended; refusing duplicate import');return
    data=compile_extension(old,get_elements())
    assert len(data['exits'])==15
    prefix=text[:match.start(1)]
    TS_FILE.write_text(prefix+json.dumps(data,separators=(',',':'),ensure_ascii=False)+';\n',encoding='utf8')

if __name__=='__main__':main()
