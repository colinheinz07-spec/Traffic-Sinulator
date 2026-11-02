"""Fetch exact A4 Köln-Süd–Köln-West, A1 crossing, Köln-Klettenberg/Eifeltor.
OSM API 0.6, original geometry and nodes, © OpenStreetMap contributors ODbL.
"""
import concurrent.futures,json,urllib.parse,urllib.request,urllib.error,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
# Minimal overlapping corridor tiles rather than city-wide OSM downloads.
# Full-city tiles would exceed the public API bandwidth budget.
CENTERS=[(50.886,6.962),(50.893,6.944),(50.898,6.927),
         (50.903,6.911),(50.909,6.893),(50.915,6.875),
         (50.921,6.858),(50.927,6.845),(50.938,6.845),
         (50.948,6.845),(50.905,6.846),(50.893,6.848),
         (50.889,6.931)]
ALLOWED={'motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary',
 'secondary_link','tertiary','tertiary_link','residential','unclassified','service'}
def fetch_bbox(lat,lon,half_lon,half_lat,depth=0):
 bbox=f'{lon-half_lon},{lat-half_lat},{lon+half_lon},{lat+half_lat}'
 url='https://api.openstreetmap.org/api/0.6/map.json?'+urllib.parse.urlencode({'bbox':bbox})
 for n in range(3):
  try:
   req=urllib.request.Request(url,headers={'User-Agent':'Traffic-Simulator-OSM-A4-Koeln-West/1.0 (public map data)'})
   with urllib.request.urlopen(req,timeout=55) as response:data=json.load(response)
   return data['elements']
  except urllib.error.HTTPError as ex:
   # OSM rejects bounding boxes with too many elements (HTTP 400).
   # Split into four exact overlapping tiles; no missing road vertices.
   if ex.code==400 and depth<3:
    out=[]
    for x in (-.5,.5):
     for y in (-.5,.5):
      out+=fetch_bbox(lat+y*half_lat,lon+x*half_lon,half_lon/2,half_lat/2,depth+1)
    return out
   if n==2:raise RuntimeError(f'OSM bbox {bbox}: {ex}')
   time.sleep(2*(n+1))
  except Exception as ex:
   if n==2:raise RuntimeError(f'OSM bbox {bbox}: {ex}')
   time.sleep(2*(n+1))
def tile(pos):
 lat,lon=pos
 result=fetch_bbox(lat,lon,.011,.0095)
 print('OSM West',pos,len(result),flush=True)
 return result
def main():
 output=ROOT/'data/a4-koeln-west-osm.json'
 previous=json.loads(output.read_text()) if output.exists() else {'elements':[],'tiles':[]}
 done={tuple(c) for c in previous['tiles']}
 pending=[c for c in CENTERS if c not in done]
 print('OSM west cached tiles',len(done),'new tiles',pending,flush=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:tiles=list(pool.map(tile,pending))
 items={(e['type'],e['id']):e for e in previous['elements']}
 for group in tiles:
  for e in group:items[e['type'],e['id']]=e
 nodes={n['id']:n for n in items.values() if n['type']=='node'}
 roads=[]
 for w in items.values():
  if w['type']!='way' or w.get('tags',{}).get('highway') not in ALLOWED:continue
  if 'geometry' not in w:
   if not all(i in nodes for i in w.get('nodes',[])):continue
   w['geometry']=[{'lat':nodes[i]['lat'],'lon':nodes[i]['lon']} for i in w['nodes']]
  roads.append(w)
 junctions=[n for n in nodes.values() if n.get('tags',{}).get('highway')=='motorway_junction']
 for road in ('A4','A1'):
  found=[w for w in roads if w.get('tags',{}).get('highway')=='motorway' and
         road in w.get('tags',{}).get('ref','').replace(' ','').split(';')]
  assert len(found)>10, f'Missing OSM motorway {road} on Cologne western ring'
 print('West Köln OSM',len(roads),'roads;',len(junctions),'motorway junctions',flush=True)
 output.write_text(json.dumps({
 'source':'OpenStreetMap API 0.6; © OpenStreetMap contributors; ODbL',
 'tiles':[list(c) for c in CENTERS],'elements':roads+junctions},separators=(',',':')))

if __name__=='__main__':main()
