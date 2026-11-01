"""Refresh the A3 Idstein–Wiesbadener Kreuz corridor; public OSM map tiles, ODbL."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
import urllib.request,urllib.parse,concurrent.futures,json
centers=([(50.225-i*.01,8.245+i*.0075) for i in range(19)]+[(50.155-i*.01,8.325+i*.005) for i in range(11)]+[(50.235+i*.01,lon) for lon in [8.22,8.25] for i in range(7)])
def f(c):
 lat,lon=c;bbox=f'{lon-.017},{lat-.008},{lon+.017},{lat+.008}'
 u='https://api.openstreetmap.org/api/0.6/map.json?'+urllib.parse.urlencode({'bbox':bbox})
 for attempt in range(2):
  try:
   b=urllib.request.urlopen(u,timeout=35).read();x=json.loads(b);print(c,len(x['elements']),flush=True);return x['elements']
  except Exception as e:print(c,e,flush=True)
 return []
all=json.load(open(ROOT/'data/a3-wiesbaden-osm.json'))['elements'] if (ROOT/'data/a3-wiesbaden-osm.json').exists() else []
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as p:
 for result in p.map(f,centers):all+=result
items={(e['type'],e['id']):e for e in all};nodes={e['id']:e for e in items.values() if e['type']=='node'}
ways=[e for e in items.values() if e['type']=='way' and e.get('tags',{}).get('highway') in ['motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','residential','unclassified']]
for w in ways:
 if w.get('geometry'):continue
 w['geometry']=[dict(lat=nodes[n]['lat'],lon=nodes[n]['lon']) for n in w['nodes']]
js=[e for e in nodes.values() if e.get('tags',{}).get('highway')=='motorway_junction']
json.dump(dict(source='OpenStreetMap API 0.6 map; © OpenStreetMap contributors; ODbL',elements=ways+js),open(ROOT/'data/a3-wiesbaden-osm.json','w'))
print('SAVED',len(ways),len(js),flush=True)
