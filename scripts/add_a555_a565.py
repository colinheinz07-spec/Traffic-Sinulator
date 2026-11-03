"""Import A555 Köln-Süd–Bonn-Nord and A565 Bonn-Nord–Bonn-Nordost.
Directed OSM vertex chains only; no geometric straight-line shortcuts.
The public OpenStreetMap API is used in overlapping map tiles.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict
from math import cos, radians, hypot, ceil
import json, urllib.request, urllib.parse, heapq, time

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'data/a555-a565-bonn-osm.json'
HISTORIC=ROOT/'data/a565-bonn-bridge-2026-05-osm.json'
SOUTH=[(50.866,6.969),(50.850,6.971),(50.833,6.984),(50.813,7.000),
       (50.793,7.023),(50.777,7.045),(50.759,7.063),(50.7464,7.0739)]
EAST=[(50.7464,7.0739),(50.748,7.088),(50.754,7.106),(50.763,7.123),(50.765,7.134)]
TILE_LAT=.0115;TILE_LON=.016
ALLOWED={'motorway','motorway_link','trunk','trunk_link','primary','primary_link',
         'secondary','secondary_link','tertiary','tertiary_link','residential','unclassified'}
def point(p):return (round(p['lat'],7),round(p['lon'],7))
def metres(a,b):return 111195*hypot(a[0]-b[0],(a[1]-b[1])*cos(radians((a[0]+b[0])/2)))
def centres():
    out=set()
    for line in (SOUTH,EAST):
        for a,b in zip(line,line[1:]):
            count=ceil(max(abs(b[0]-a[0])/.009,abs(b[1]-a[1])/.013))
            for i in range(count+1):
                lat=a[0]+(b[0]-a[0])*i/count;lon=a[1]+(b[1]-a[1])*i/count
                for dl,do in ((0,0),(.009,0),(-.009,0),(0,.012),(0,-.012)):
                    out.add((round(lat+dl,3),round(lon+do,3)))
    # Grid snapping makes tile overlaps deterministic and deduplicates requests.
    return sorted({(round(lat/.009)*.009,round(lon/.012)*.012) for lat,lon in out})
def download_tile(c,half_lat=TILE_LAT,half_lon=TILE_LON,depth=0):
    lat,lon=c
    bbox=f'{lon-half_lon},{lat-half_lat},{lon+half_lon},{lat+half_lat}'
    url='https://api.openstreetmap.org/api/0.6/map.json?'+urllib.parse.urlencode({'bbox':bbox})
    error=None
    for attempt in range(3):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'Traffic-Sinulator-A555-A565/1.0 (OSM source audit)'})
            with urllib.request.urlopen(req,timeout=65) as response:data=json.load(response)
            # Retain only highway ways and their exact nodes *before* aggregating
            # tile responses: central Bonn otherwise contains millions of
            # unrelated building nodes and exhausts the CI runner memory.
            highway=[w for w in data['elements'] if w['type']=='way' and
                w.get('tags',{}).get('highway') in ALLOWED]
            nodeids={i for w in highway for i in w.get('nodes',[])}
            nodes=[n for n in data['elements'] if n['type']=='node' and
                (n['id'] in nodeids or n.get('tags',{}).get('highway')=='motorway_junction')]
            print('OSM tile',c,depth,len(highway),'highways',flush=True)
            return highway+nodes
        except urllib.error.HTTPError as e:
            error=e
            if e.code==400 and depth<4:
                # OSM API refuses very dense 0.6/map urban rectangles.
                # Four exact half-sized rectangles retain all shared vertices.
                out=[]
                for y in (-1,1):
                    for x in (-1,1):
                        out.extend(download_tile((lat+y*half_lat/2,lon+x*half_lon/2),
                           half_lat/2,half_lon/2,depth+1))
                return out
            if e.code not in (429,500,502,503,504):break
        except Exception as e:error=e
        time.sleep(1+attempt*3)
    raise RuntimeError(f'OSM tile {c} depth={depth}: {error}')
def collect():
    if SOURCE.exists():return json.loads(SOURCE.read_text())['elements']
    # Two selective, geometrically bounded requests. Unlike OSM map tiles,
    # this does not retrieve hundreds of thousands of unrelated building nodes.
    bboxes=[(50.739,6.951,50.877,7.088),(50.737,7.059,50.778,7.151)]
    mirrors=[
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
        'https://overpass.private.coffee/api/interpreter']
    all_items={}
    for bbox in bboxes:
        bounds=','.join(map(str,bbox))
        query='[out:json][timeout:150];(way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link)$"]('+bounds+');node["highway"="motorway_junction"]('+bounds+'););out body geom;'
        error=None;data=None
        for mirror in mirrors:
            try:
                url=mirror+'?'+urllib.parse.urlencode({'data':query})
                req=urllib.request.Request(url,headers={'User-Agent':'Traffic-Sinulator-Bonn-OSM/1.0'})
                with urllib.request.urlopen(req,timeout=170) as response:data=json.load(response)
                print('Overpass',mirror,bounds,len(data['elements']),flush=True)
                break
            except Exception as e:
                error=e
                print('Overpass mirror unavailable',mirror,str(e)[:160],flush=True)
        if not data:raise RuntimeError('Selective OSM road query failed: '+str(error))
        for e in data['elements']:
            if e['type']=='way' and e.get('tags',{}).get('highway') in ALLOWED:
                if e.get('geometry') and len(e['geometry'])==len(e.get('nodes',[])):
                    all_items[e['type'],e['id']]=e
            elif e['type']=='node' and e.get('tags',{}).get('highway')=='motorway_junction':
                all_items[e['type'],e['id']]=e
    ways=[w for w in all_items.values() if w['type']=='way']
    assert len(ways)>80,'Selective OSM dataset too small'
    for ref,minways in [('A555',10),('A565',5)]:
        matched=[w for w in ways if w.get('tags',{}).get('highway')=='motorway' and
                 ref in w.get('tags',{}).get('ref','').replace(' ','').split(';')]
        assert len(matched)>=minways,(ref,len(matched))
    SOURCE.write_text(json.dumps({'source':'Overpass OSM highway geometries / © OpenStreetMap contributors / ODbL',
          'bounding_boxes':bboxes,'elements':list(all_items.values())},separators=(',',':')))
    return list(all_items.values())
def collect_historic():
    """Use pre-closure OSM topology ONLY for the simulator's normal-state scenario.
    The Bonn-Nord bridge/approaches are currently closed and under replacement.
    """
    if HISTORIC.exists():return json.loads(HISTORIC.read_text())['elements']
    # Only the former left-bank approach and Rhine bridge gap need history.
    # Historic Overpass queries for the entire Bonn motorway system time out.
    bbox='50.743,7.065,50.758,7.102'
    query='[out:json][timeout:95][date:"2026-05-15T12:00:00Z"];way["highway"="motorway"]["ref"~"A ?565"]('+bbox+');out body geom;'
    mirrors=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter',
             'https://overpass.private.coffee/api/interpreter']
    error=None;data=None
    for mirror in mirrors:
        try:
            url=mirror+'?'+urllib.parse.urlencode({'data':query})
            req=urllib.request.Request(url,headers={'User-Agent':'Traffic-Sinulator-Bonn-OSM-Historical/1.0'})
            with urllib.request.urlopen(req,timeout=110) as response:data=json.load(response)
            print('Historical A565 OSM',mirror,len(data['elements']),flush=True)
            break
        except Exception as e:
            error=e;print('Historical Overpass unavailable',mirror,str(e)[:180],flush=True)
    if not data:raise RuntimeError('Cannot verify historic Bonn-Nord bridge geometry: '+str(error))
    elements=[e for e in data['elements'] if e['type']=='node' and e.get('tags',{}).get('highway')=='motorway_junction'
        or e['type']=='way' and e.get('geometry') and e.get('tags',{}).get('highway') in ('motorway','motorway_link')]
    assert sum('A565' in e.get('tags',{}).get('ref','').replace(' ','') for e in elements)>=2
    HISTORIC.write_text(json.dumps({'source':'OSM historical snapshot 2026-05-15 / ODbL',
       'historical_not_currently_open':True,'elements':elements},separators=(',',':')))
    return elements
def directed(w):
    ps=list(map(point,w['geometry']))
    return ps[::-1] if w.get('tags',{}).get('oneway')=='-1' else ps
def graph(ways):
    g=defaultdict(list)
    for w in ways:
        ps=directed(w)
        for a,b in zip(ps,ps[1:]):
            if a!=b:g[a].append((b,w))
    return g
def reverse(g):
    r=defaultdict(list)
    for a,items in g.items():
        for b,w in items:r[b].append((a,w))
    return r
def shortest(g,start,target,minlength=0,maxlength=30000,radius=450):
    """Dijkstra on directed OSM edges, never joining by near-coordinate."""
    todo=[(0,start)];cost={start:0};prev={}
    while todo:
        d,a=heapq.heappop(todo)
        if d>cost[a]+.001:continue
        if d>=minlength and metres(a,target)<radius:
            edges=[]
            while a!=start:
                p,w=prev[a];edges.append((p,a,w));a=p
            return edges[::-1]
        if d>maxlength:continue
        for b,w in g.get(a,()):
            nd=d+metres(a,b)
            if nd<cost.get(b,float('inf'))-.00001:
                cost[b]=nd;prev[b]=(a,w);heapq.heappush(todo,(nd,b))
    closest=sorted(((round(metres(p,target)),p,round(cost[p])) for p in cost),key=lambda x:x[0])[:12]
    raise ValueError(f'No exact directed motorway chain {start} -> {target}; graph nodes {len(g)}; reached {len(cost)}; nearest {closest}')
def lane(w,kind,key=None,segment=None):
    tags=w.get('tags',{})
    raw=tags.get('lanes:forward') or tags.get('lanes') or ('2' if kind=='motorway' else '1')
    try:n=int(raw.split(';')[0])
    except (TypeError,ValueError):n=2 if kind=='motorway' else 1
    n=max(1,min(5,n))
    turns=tags.get('turn:lanes','').split('|')
    if len(turns)>1:
        normal=sum(t not in ['left','right','slight_left','slight_right'] and 'merge_to_' not in t for t in turns)
        if normal>=2:n=min(n,normal)
    if key=='extra-a565-koblenz':n=min(n,2)
    if key=='extra-a565-siegburg' and segment and (segment[1][1]+segment[-1][1])/2<7.101:n=min(n,2)
    return n
def feature(key,title,kind,edges,zone,demand):
    assert edges,'Empty OSM route '+key
    points=[edges[0][0]];sections=[];way_ids=[];metre=0
    for a,b,w in edges:
        assert points[-1]==a,(key,'disconnected OSM edge',points[-1],a)
        points.append(b)
        length=metres(a,b)
        n=lane(w,kind,key,points[-2:])
        if sections and sections[-1]['lanes']==n:
            sections[-1]['toM']+=length
        else:sections.append({'fromM':metre,'toM':metre+length,'lanes':n})
        metre+=length
        if w['id'] not in way_ids:way_ids.append(w['id'])
    assert metre>(1 if kind=='ramp' else 35) and len(points)>=(2 if kind=='ramp' else 3),(key,metre)
    return {'id':key,'name':title,'zone':zone,'kind':kind,
        'lanes':max(s['lanes'] for s in sections) if kind=='motorway' else min(s['lanes'] for s in sections),
        'laneSegments':sections,'points':[list(p) for p in points],
        'wayIds':way_ids,'demandVph':demand,'freeKmh':130 if kind=='motorway' else 80}
def build():
    new=collect()
    historic=collect_historic()
    refs=['data/a4-koeln-sued-osm.json','data/bonn-a59-a562-osm.json','data/a59-a560-osm.json']
    combined={}
    for path in refs:
        for e in json.loads((ROOT/path).read_text())['elements']:
            if e['type']=='way' and e.get('geometry') or e['type']=='node':
                combined[e['type'],e['id']]=e
    for e in new:combined[e['type'],e['id']]=e
    ways=[e for e in combined.values() if e['type']=='way' and e.get('geometry')]
    # Keep historical A565 motorway edges as parallel source evidence. Do not
    # turn today's removed/closed bridge into an allegedly open real road.
    ways += [e for e in historic if e['type']=='way' and e.get('tags',{}).get('highway')=='motorway' and
       'A565' in e.get('tags',{}).get('ref','').replace(' ','').split(';')]
    nodes=[e for e in combined.values() if e['type']=='node']+[e for e in historic if e['type']=='node']
    bundle=json.loads((ROOT/'data/extension-junctions.json').read_text())
    routes=bundle['routes'];junctions=bundle['junctions']
    byid={r['id']:r for r in routes}
    def motorways(ref):
        return [w for w in ways if w.get('tags',{}).get('highway')=='motorway' and
          ref in w['tags'].get('ref','').replace(' ','').split(';')]
    g555=graph(motorways('A555'));r555=reverse(g555)
    old_s=byid['extra-a555-bonn'];old_n=byid['extra-a555-koeln']
    center=(50.74639,7.07389)
    south=shortest(g555,tuple(old_s['points'][-1]),center,12000,26000,380)
    north_back=shortest(r555,tuple(old_n['points'][0]),center,12000,26000,380)
    # Reverse the backward OSM search into the northbound driving direction.
    north=[(b,a,w) for a,b,w in reversed(north_back)]
    def extend(old,edges,front):
        add=feature('temp','temp','motorway',edges,'temp',0)
        if front:
            assert add['points'][-1]==old['points'][0],'Unconnected A555 northern prepend'
            delta=add['laneSegments'][-1]['toM']
            old['points']=add['points'][:-1]+old['points']
            old['laneSegments']=add['laneSegments']+[
                dict(section,fromM=section['fromM']+delta,toM=section['toM']+delta)
                for section in old['laneSegments']]
            old['wayIds']=list(dict.fromkeys(add['wayIds']+old['wayIds']))
        else:
            assert add['points'][0]==old['points'][-1],'Unconnected A555 southward append'
            delta=old['laneSegments'][-1]['toM']
            old['points']+=add['points'][1:]
            old['laneSegments'] += [
                dict(section,fromM=section['fromM']+delta,toM=section['toM']+delta)
                for section in add['laneSegments']]
            old['wayIds']=list(dict.fromkeys(old['wayIds']+add['wayIds']))
        old['lanes']=max(section['lanes'] for section in old['laneSegments'])
        old['zone']='A555 AK Köln-Süd–AK Bonn-Nord'
        old['name']='A555 → '+('Köln-Süd' if front else 'Bonn-Nord')
        old['demandVph']=2400
    extend(old_s,south,False);extend(old_n,north,True)
    g565=graph(motorways('A565'));r565=reverse(g565)
    # The east/west ends are existing OSM nodes adjoining A59 motorway_link geometry.
    east_end=(50.7648316,7.1319802);west_end=(50.7649664,7.1325051)
    e_back=shortest(r565,east_end,center,3300,11000,460)
    e_edges=[(b,a,w) for a,b,w in reversed(e_back)]
    w_edges=shortest(g565,west_end,center,3300,11000,460)
    for f in [feature('extra-a565-siegburg','A565 → Siegburg / AD Bonn-Nordost','motorway',
        e_edges,'A565 Bonn-Nord–Bonn-Nordost',1850),
      feature('extra-a565-koblenz','A565 → Koblenz / AK Bonn-Nord','motorway',
        w_edges,'A565 Bonn-Nord–Bonn-Nordost',1900)]:
        assert f['id'] not in byid
        routes.append(f);byid[f['id']]=f
    print('Mainline lengths (metres):',[(key,round(byid[key]['laneSegments'][-1]['toM']))
          for key in ['extra-a555-bonn','extra-a555-koeln','extra-a565-siegburg','extra-a565-koblenz']],flush=True)
    # Add official junctions at EXACT motorway vertices; anchor positions
    # are sourced from junction nodes where available, never invented geometry.
    sites=[
      ('A555','4','Köln-Godorf',(50.842,6.976)),
      ('A555','5','Wesseling',(50.816,7.002)),
      ('A555','6','Bornheim (Rhld.)',(50.762,7.057)),
      ('A555','7','AK Bonn-Nord',center),
      ('A565','1','AD Bonn-Nordost',(50.7653,7.135)),
      ('A565','2','Bonn-Beuel-Nord',(50.759,7.11)),
      ('A565','3','Bonn-Auerberg',(50.749,7.087)),
      ('A565','4','AK Bonn-Nord',center)]
    def closest_node(road,ref,geo,vertices):
        tagged=[point(n) for n in nodes if n.get('tags',{}).get('ref')==ref
          and point(n) in vertices and metres(point(n),geo)<1750]
        choices=tagged or list(vertices)
        return min(choices,key=lambda p:metres(p,geo))
    for road,ref,name,geo in sites:
        target=[byid[k] for k in (
          ['extra-a555-bonn','extra-a555-koeln'] if road=='A555' else
          ['extra-a565-siegburg','extra-a565-koblenz'])]
        existing=next((j for j in junctions if j['road']==road and j['ref']==ref),None)
        if not existing:
            existing={'road':road,'ref':ref,'name':name,'position':list(geo),
              'source':'osm-positioned-junction','directional':{}}
            junctions.append(existing)
        existing['name']=name
        for f in target:
            vertices=set(map(tuple,f['points']))
            vertex=closest_node(road,ref,geo,vertices)
            if metres(vertex,geo)>1900:raise ValueError(f'{road} {ref}: no verified vertex within 1.9km')
            node=next((n for n in nodes if point(n)==vertex),None)
            existing.setdefault('directional',{})[f['id']]={'position':list(vertex),'nodeId':node['id'] if node else 0}
        existing['position']=existing['directional'][target[0]['id']]['position']
    # All previously known Köln-Süd / Rodenkirchen junctions acquire the new
    # long-direction anchors by remapping onto the extended exact OSM chain.
    for j in junctions:
        if j['road']!='A555' or j['ref'] not in ('2','3'):continue
        for key in ('extra-a555-bonn','extra-a555-koeln'):
            if key in j.get('directional',{}):continue
            route=byid[key];p=min(map(tuple,route['points']),key=lambda x:metres(x,j['position']))
            j.setdefault('directional',{})[key]={'position':list(p),'nodeId':0}
    # Link chains are constructed as genuine directed OSM walks. Existing A4
    # and A59 ramps stay untouched, and attached ramps acquire their new
    # connections automatically when the A555/A565 trunks are installed.
    owned={id for f in routes if f['kind']=='ramp' for id in f['wayIds']}
    g_link=graph([w for w in ways if w.get('tags',{}).get('highway')=='motorway_link'
          and w.get('tags',{}).get('access') not in ('no','private')])
    trunk_keys=['extra-a555-bonn','extra-a555-koeln',
        'extra-a565-siegburg','extra-a565-koblenz',
        'extra-a59-koeln','extra-a59-bonn','extra-a4-aachen','extra-a4-olpe']
    trunk={key:set(map(tuple,byid[key]['points'])) for key in trunk_keys if key in byid}
    for name,geo,span,pairs in [
      ('AK Bonn-Nord',center,2500,('extra-a555','extra-a565')),
      ('AD Bonn-Nordost',(50.7653,7.135),2600,('extra-a565','extra-a59'))]:
        for src,v in trunk.items():
            if not src.startswith(pairs):continue
            for dest,t in trunk.items():
                if dest==src or not dest.startswith(pairs) or src.split('-')[1]==dest.split('-')[1]:continue
                starts=[p for p in v if p in g_link and metres(p,geo)<span]
                goals={p for p in t if metres(p,geo)<span}
                options=[]
                for start in starts:
                    # A true candidate must end exactly on a target motorway vertex.
                    todo=[(0,start)];best={start:0};prev={};end=None
                    while todo:
                        d,p=heapq.heappop(todo)
                        if d>best[p]+.001:continue
                        if p in goals and d>35:end=p;break
                        if d>2400:continue
                        for q,w in g_link.get(p,()):
                            nd=d+metres(p,q)
                            if nd<best.get(q,1e99)-.00001:
                                best[q]=nd;prev[q]=(p,w);heapq.heappush(todo,(nd,q))
                    if end:
                        edges=[];p=end
                        while p!=start:
                            a,w=prev[p];edges.append((a,p,w));p=a
                        edges.reverse()
                        if edges and 40<sum(metres(a,b) for a,b,w in edges)<2400:options.append(edges)
                if not options:continue
                bestpath=min(options,key=lambda edges:sum(metres(a,b) for a,b,w in edges))
                ids=[w['id'] for a,b,w in bestpath]
                if all(id in owned for id in ids):continue
                fid='extra-bonn-turn-'+src+'-to-'+dest+'-'+str(ids[0])
                if fid in byid:continue
                item=feature(fid,name+' · '+src+' → '+dest,'ramp',bestpath,name,600)
                routes.append(item);byid[fid]=item;owned.update(item['wayIds'])
    # Include all as-yet unrepresented motorway-link OSM ways that belong to a
    # new A555 / A565 interchange or its local AS. They remain one-way links,
    # not falsely given a second mainline lane or imaginary continuation.
    touched=set(map(tuple,sum((byid[k]['points'] for k in
          ('extra-a555-bonn','extra-a555-koeln','extra-a565-siegburg','extra-a565-koblenz')),[])))
    newlinks=[w for w in ways if w.get('tags',{}).get('highway')=='motorway_link'
        and w['id'] not in owned and
        (point(w['geometry'][0]) in touched or point(w['geometry'][-1]) in touched)]
    # Traverse adjacent motorway-link way endpoints from the trunk junctions,
    # retaining branches without painting an arbitrary shortcut.
    by_end=defaultdict(list)
    for w in ways:
        if w.get('tags',{}).get('highway')!='motorway_link':continue
        ps=directed(w)
        by_end[ps[0]].append(w)
    frontier=list(newlinks);seen=set()
    while frontier:
        w=frontier.pop()
        if w['id'] in seen:continue
        seen.add(w['id']);ps=directed(w)
        if w['id'] not in owned:
            name='A555 / A565 · Auf-/Abfahrt'
            if metres(ps[len(ps)//2],center)<2100:name='AK Bonn-Nord · Rampenzweig'
            elif metres(ps[len(ps)//2],(50.7653,7.135))<1900:name='AD Bonn-Nordost · Rampenzweig'
            else:name='A555 / A565 · Anschlussstellenrampe'
            f=feature('extra-bonn-ramp-'+str(w['id']),name,'ramp',
                [(a,b,w) for a,b in zip(ps,ps[1:])],name,450)
            routes.append(f);byid[f['id']]=f;owned.add(w['id'])
        if len(seen)>180:break
        for endpoint in (ps[0],ps[-1]):
            for nxt in by_end.get(endpoint,()):
                if nxt['id'] not in seen and metres(endpoint,center)<2100 or (
                  nxt['id'] not in seen and any(metres(endpoint,s)<1000 for _,_,_,s in sites)):
                    frontier.append(nxt)
    bundle['routes']=routes;bundle['junctions']=junctions
    (ROOT/'data/extension-junctions.json').write_text(json.dumps(bundle,separators=(',',':')))
    oldtext=(ROOT/'src/network-extensions.ts').read_text()
    start='export const extensionRampBoundaryPoints:Point[]='
    oldboundary=json.loads(oldtext.split(start,1)[1].split(';',1)[0])
    localways=[w for w in ways if w.get('tags',{}).get('highway') in ALLOWED-{'motorway','motorway_link'}]
    localpts={p for w in localways for p in map(point,w['geometry'])}
    ramps={p for f in routes if f['kind']=='ramp' for p in map(tuple,f['points'])}
    boundaries=sorted(set(map(tuple,oldboundary))|(ramps&localpts))
    ids=[f['id'] for f in routes]
    assert len(ids)==len(set(ids)),'Duplicate route IDs'
    header="import type {Point,Exit} from './core.js';\n"
    header+="export const EXTENSION_IDS="+json.dumps(ids)+" as const;\n"
    header+="export type ExtensionId=typeof EXTENSION_IDS[number];\n"
    header+="export interface ExtensionRoute {id:ExtensionId;name:string;zone:string;kind:'motorway'|'ramp';lanes:number;laneSegments:{fromM:number;toM:number;lanes:number}[];points:Point[];wayIds:number[];demandVph:number;freeKmh:number}\n"
    header+="export const extensionRoutes:ExtensionRoute[]="+json.dumps(routes,separators=(',',':'))+";\n"
    header+="export const extensionJunctions:Exit[]="+json.dumps(junctions,separators=(',',':'))+";\n"
    header+="export const extensionRampBoundaryPoints:Point[]="+json.dumps(boundaries,separators=(',',':'))+";\n"
    header+="const byId=new Map<string,ExtensionRoute>(extensionRoutes.map(r=>[r.id,r]));\nexport const extensionRoute=(id:string)=>byId.get(id);\n"
    (ROOT/'src/network-extensions.ts').write_text(header)
    print('A555 / A565 expansion complete:',len(routes),'routes;',len(junctions),'junctions;',len(seen),'new ramp way candidates',flush=True)
if __name__=='__main__':
    import sys
    (collect(),collect_historic()) if '--fetch-only' in sys.argv else build()
