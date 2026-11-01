"""Refresh OSM regional geometry; public API map tiles, ODbL."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
import urllib.request,urllib.parse,concurrent.futures,json
centers=[(50.79,7.15),(50.81,7.13),(50.825,7.105),(50.84,7.10),(50.855,7.09),(50.87,7.085),(50.885,7.065),(50.90,7.065),(50.915,7.065),(50.93,7.07),(50.811,7.132),(50.895,7.085),(50.902,7.08),(50.843,7.096),(50.882,7.095),(50.89,7.09),(50.924,7.076),(50.886,7.10),(50.886,7.085),(50.90,7.075)]
def f(c):
 lat,lon=c;bbox=f'{lon-.008},{lat-.006},{lon+.008},{lat+.006}'
 u='https://api.openstreetmap.org/api/0.6/map.json?'+urllib.parse.urlencode({'bbox':bbox})
 for attempt in range(2):
  try:
   b=urllib.request.urlopen(u,timeout=35).read();x=json.loads(b);print(c,len(x['elements']),flush=True);return x['elements']
  except Exception as e:print(c,e,flush=True)
 return []
all=json.load(open(ROOT/'data/a59-a560-osm.json'))['elements']
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as p:
 for result in p.map(f,centers):all+=result
items={(e['type'],e['id']):e for e in all};nodes={e['id']:e for e in items.values() if e['type']=='node'}
ways=[e for e in items.values() if e['type']=='way' and e.get('tags',{}).get('highway') in ['motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','residential','unclassified']]
for w in ways:
 if w.get('geometry'):continue
 w['geometry']=[dict(lat=nodes[n]['lat'],lon=nodes[n]['lon']) for n in w['nodes']]
js=[e for e in nodes.values() if e.get('tags',{}).get('highway')=='motorway_junction']
json.dump(dict(source='OpenStreetMap API 0.6 map; © OpenStreetMap contributors; ODbL',elements=ways+js),open(ROOT/'data/a59-a560-osm.json','w'))
print('SAVED',len(ways),len(js),flush=True)
