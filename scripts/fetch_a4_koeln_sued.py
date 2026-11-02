"""Fetch verified A4 Köln-Poll—AK Köln-Süd and A555 connector geometry from public OSM API."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json, urllib.parse, urllib.request, time
ROOT=Path(__file__).resolve().parents[1]
# Overlapping tiles retain exact directional nodes; avoid approximated coordinates.
CENTERS=[(round(50.885+i*.011,6),round(6.956+j*.015,6)) for i in range(4) for j in range(5)] + [(50.863,6.971),(50.873,6.971),(50.863,6.986)]
HIGHWAYS={'motorway','motorway_link','trunk','trunk_link','primary','primary_link',
          'secondary','secondary_link','tertiary','tertiary_link','residential','unclassified'}
def tile(center):
 lat,lon=center
 bbox=f'{lon-.010},{lat-.008},{lon+.010},{lat+.008}'
 url='https://api.openstreetmap.org/api/0.6/map.json?'+urllib.parse.urlencode({'bbox':bbox})
 error=None
 for i in range(4):
  try:
   req=urllib.request.Request(url,headers={'User-Agent':'Traffic-Simulator-OSM-Koeln-Sued/1.0 (public open mapping)'})
   with urllib.request.urlopen(req,timeout=55) as response: out=json.load(response)
   print('OSM',center,len(out['elements']),flush=True)
   return out['elements']
  except Exception as e:
   error=e;time.sleep(2+i*4)
 raise RuntimeError(f'OSM tile {center}: {error}')
def main():
 with ThreadPoolExecutor(max_workers=3) as pool: tiles=list(pool.map(tile,CENTERS))
 items={(e['type'],e['id']):e for group in tiles for e in group}
 nodes={e['id']:e for e in items.values() if e['type']=='node'}
 roads=[]
 for way in items.values():
  if way['type']!='way' or way.get('tags',{}).get('highway') not in HIGHWAYS:continue
  if not all(n in nodes for n in way.get('nodes',[])):continue
  way['geometry']=[{'lat':nodes[n]['lat'],'lon':nodes[n]['lon']} for n in way['nodes']]
  roads.append(way)
 junctions=[n for n in nodes.values() if n.get('tags',{}).get('highway')=='motorway_junction']
 def motorway(ref):
  return [w for w in roads if w.get('tags',{}).get('highway')=='motorway' and
          ref in w.get('tags',{}).get('ref','').replace(' ','').split(';')]
 assert len(motorway('A4'))>=12, 'A4 mainline OSM geometry incomplete'
 assert len(motorway('A555'))>=4, 'A555 motorway approaches missing'
 assert any(any(p['lon']<6.98 for p in w['geometry']) for w in motorway('A4')),'No AK Köln-Süd west end'
 output=ROOT/'data/a4-koeln-sued-osm.json'
 output.write_text(json.dumps({'source':'OpenStreetMap API 0.6; © OpenStreetMap contributors; ODbL',
  'tiles':CENTERS,'elements':roads+junctions},separators=(',',':')))
 print('Verified',len(roads),'roads,',len(junctions),'junction nodes',flush=True)
if __name__=='__main__':main()
