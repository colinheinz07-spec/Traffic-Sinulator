"""Refresh the Cologne motorway triangle; public OSM map tiles, ODbL."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
import urllib.request,urllib.parse,concurrent.futures,json
centers=[(50.947,7.04),(50.939,7.048),(50.929,7.04),(50.922,7.025),(50.915,7.012),(50.911,6.998),(50.921,6.998),(50.915,7.007),(50.908,7.017),(50.901,7.028),(50.9,7.043),(50.903,7.056),(50.906,7.067),(50.958,7.04),(50.965,7.037),(50.911,7.045),(50.915,7.035),(50.916,7.026),(50.922,7.02),(50.933,7.052),(50.92,7.047)]
def f(c):
 lat,lon=c;bbox=f'{lon-.008},{lat-.006},{lon+.008},{lat+.006}'
 u='https://api.openstreetmap.org/api/0.6/map.json?'+urllib.parse.urlencode({'bbox':bbox})
 for attempt in range(2):
  try:
   b=urllib.request.urlopen(u,timeout=35).read();x=json.loads(b);print(c,len(x['elements']),flush=True);return x['elements']
  except Exception as e:print(c,e,flush=True)
 return []
all=json.load(open(ROOT/'data/cologne-triangle-osm.json'))['elements'] if (ROOT/'data/cologne-triangle-osm.json').exists() else []
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as p:
 for result in p.map(f,centers):all+=result
items={(e['type'],e['id']):e for e in all};nodes={e['id']:e for e in items.values() if e['type']=='node'}
ways=[e for e in items.values() if e['type']=='way' and e.get('tags',{}).get('highway') in ['motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','residential','unclassified']]
for w in ways:
 if w.get('geometry'):continue
 w['geometry']=[dict(lat=nodes[n]['lat'],lon=nodes[n]['lon']) for n in w['nodes']]
js=[e for e in nodes.values() if e.get('tags',{}).get('highway')=='motorway_junction']
json.dump(dict(source='OpenStreetMap API 0.6 map; © OpenStreetMap contributors; ODbL',elements=ways+js),open(ROOT/'data/cologne-triangle-osm.json','w'))
print('SAVED',len(ways),len(js),flush=True)
