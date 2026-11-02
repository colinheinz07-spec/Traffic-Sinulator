"""Fetch exact A4 Köln-Süd–Köln-West, A1 crossing, Köln-Klettenberg/Eifeltor.
OSM API 0.6, original geometry and nodes, © OpenStreetMap contributors ODbL.
"""
import concurrent.futures,json,urllib.parse,urllib.request,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CENTERS=[(lat,lon) for lat in (50.890,50.904,50.918,50.932,50.946)
         for lon in (6.848,6.866,6.884,6.902,6.920,6.938,6.956,6.972)]
ALLOWED={'motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary',
 'secondary_link','tertiary','tertiary_link','residential','unclassified','service'}
def tile(pos):
 lat,lon=pos;bbox=f'{lon-.011},{lat-.0095},{lon+.011},{lat+.0095}'
 url='https://api.openstreetmap.org/api/0.6/map.json?'+urllib.parse.urlencode({'bbox':bbox})
 for n in range(4):
  try:
   req=urllib.request.Request(url,headers={'User-Agent':'Traffic-Simulator-OSM-A4-Koeln-West/1.0 (public map data)'})
   with urllib.request.urlopen(req,timeout=55) as response:data=json.load(response)
   print('OSM West',pos,len(data['elements']),flush=True)
   return data['elements']
  except Exception as ex:
   if n==3:raise RuntimeError(f'OSM tile {pos}: {ex}')
   time.sleep(3*(n+1))
def main():
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:tiles=list(pool.map(tile,CENTERS))
 items={(e['type'],e['id']):e for group in tiles for e in group}
 nodes={n['id']:n for n in items.values() if n['type']=='node'}
 roads=[]
 for w in items.values():
  if w['type']!='way' or w.get('tags',{}).get('highway') not in ALLOWED:continue
  if not all(i in nodes for i in w.get('nodes',[])):continue
  w['geometry']=[{'lat':nodes[i]['lat'],'lon':nodes[i]['lon']} for i in w['nodes']]
  roads.append(w)
 junctions=[n for n in nodes.values() if n.get('tags',{}).get('highway')=='motorway_junction']
 for road in ('A4','A1'):
  found=[w for w in roads if w.get('tags',{}).get('highway')=='motorway' and
         road in w.get('tags',{}).get('ref','').replace(' ','').split(';')]
  assert len(found)>10, f'Missing OSM motorway {road} on Cologne western ring'
 print('West Köln OSM',len(roads),'roads;',len(junctions),'motorway junctions',flush=True)
 (ROOT/'data/a4-koeln-west-osm.json').write_text(json.dumps({
 'source':'OpenStreetMap API 0.6; © OpenStreetMap contributors; ODbL',
 'tiles':CENTERS,'elements':roads+junctions},separators=(',',':')))
if __name__=='__main__':main()
