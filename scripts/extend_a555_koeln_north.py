"""Repair the missing A555 northbound Cologne approach using offline OSM Ways.
The motorway terminates at the real directed fork; both ends to surface streets
are motorway_link ramps, never an invented connecting motorway.
Called by add_a555_a565.py after generating routes and before ramp import.
"""
import json
from math import hypot, cos, radians
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
WAY_IDS=(20661568,20661572,1451715037,230940374,1451715031,4400143,235824475,178797123)
ROUTE='extra-a555-koeln'
def dist(a,b):
 return 111195*hypot(a[0]-b[0],(a[1]-b[1])*cos(radians((a[0]+b[0])/2)))
def extend():
 path=ROOT/'src/network-extensions.ts'
 text=path.read_text()
 marker='export const extensionRoutes:ExtensionRoute[]='
 routes=json.loads(text.split(marker,1)[1].split(';',1)[0])
 route=next(r for r in routes if r['id']==ROUTE)
 if set(WAY_IDS).issubset(set(route['wayIds'])):
  assert tuple(route['points'][-1])==(50.8913065,6.9678547),'A555 north terminal altered'
  return False
 assert not set(WAY_IDS).intersection(route['wayIds']),'Partial north A555 import'
 assert tuple(route['points'][-1])==(50.8852476,6.9684847),'Unexpected A555 source boundary'
 source=json.loads((ROOT/'data/a4-koeln-sued-osm.json').read_text())
 by_id={w['id']:w for w in source['elements'] if w.get('type')=='way'}
 metre=route['laneSegments'][-1]['toM']
 for id in WAY_IDS:
  w=by_id[id]
  tags=w['tags']
  assert tags.get('highway')=='motorway' and tags.get('oneway')=='yes' and tags.get('ref')=='A 555',id
  points=[[p['lat'],p['lon']] for p in w['geometry']]
  assert route['points'][-1]==points[0],f'Disconnected OSM way {id}'
  length=sum(dist(a,b) for a,b in zip(points,points[1:]))
  lanes=int(tags.get('lanes',1))
  assert 1<=lanes<=4 and length>1,id
  route['points']+=points[1:]
  route['wayIds'].append(id)
  route['laneSegments'].append({'fromM':metre,'toM':metre+length,'lanes':lanes})
  metre+=length
 assert route['points'][-1]==[50.8913065,6.9678547]
 blob=json.dumps(routes,ensure_ascii=False,separators=(',',':'))
 head,tail=text.split(marker,1)
 after=tail.split(';',1)[1]
 path.write_text(head+marker+blob+';'+after)
 return True
if __name__=='__main__':
 print('Extended actual A555 Cologne approach:',extend())
