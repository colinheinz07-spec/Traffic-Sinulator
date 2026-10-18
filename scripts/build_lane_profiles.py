#!/usr/bin/env python3
"""Create exact OSM-tagged lane profiles for four AD Dernbach ramps (no fabricated lanes)."""
import json
import re
from pathlib import Path
import time
import urllib.parse
import urllib.request

BASE=Path(__file__).resolve().parents[1]
HOSTS=['https://overpass.private.coffee/api/interpreter','https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']

def data_from_ts():
 s=(BASE/'src/geodata.ts').read_text()
 m=re.search(r'export const networkData:\s*MapData\s*=\s*(\{.*\});?\s*$',s,re.S)
 if not m:raise RuntimeError('Cannot parse TypeScript dataset')
 return json.loads(m.group(1))

def retrieve(ids):
 q='[out:json][timeout:100];way(id:'+','.join(map(str,ids))+');out geom;'
 errors=[]
 for host in HOSTS:
  for i in range(2):
   try:
    request=urllib.request.Request(host, data=urllib.parse.urlencode({'data':q}).encode(),
     headers={'User-Agent':'Traffic-Sinulator lane profiles/0.5 (OSM contributors credited)', 'Accept':'application/json'}, method='POST')
    with urllib.request.urlopen(request,timeout=110) as resp:payload=json.load(resp)
    ways={way['id']:way for way in payload['elements'] if way.get('type')=='way'}
    if len(ways)!=len(ids):raise RuntimeError(f'Missing OSM ways {set(ids)-set(ways)}')
    return ways
   except Exception as e:errors.append(str(e)[:90]);time.sleep(i+1)
 raise RuntimeError('Cannot fetch complete AD ramp profiles: '+str(errors))

def build_profiles(data,ways,audit):
 profile={}
 for ramp in data['ramps']:
  sections=[]
  for id in ramp['wayIds']:
   w=ways[id]
   if w.get('tags',{}).get('highway')!='motorway_link':raise RuntimeError(f'Not a motorway_link {id}')
   text=w.get('tags',{}).get('lanes')
   if not (isinstance(text,str) and text.isdigit() and 1<=int(text)<=5):raise RuntimeError(f'Unverified ramp lane count {id}')
   pts=[[round(x['lat'],7),round(x['lon'],7)] for x in w['geometry']]
   if len(pts)<2:raise RuntimeError(f'Missing geometric path on {id}')
   # Source vertices for each way MUST occur in the existing rendered path.
   route={tuple(p) for p in ramp['points']}
   if min(sum(tuple(p) in route for p in pts),2)<2:raise RuntimeError(f'OSM ramp geometry diverges from embedded route {id}')
   sections.append({'wayId':id,'lanes':int(text),'points':pts})
  profile[ramp['id']]=sections
 unver=[int(x['wayId']) for x in audit['roads'] if x['status']!='matches']
 assert all(len(profile[r['id']])==len(r['wayIds']) for r in data['ramps'])
 return profile,sorted(unver)

def main():
 data=data_from_ts();audit=json.loads((BASE/'data/lane-audit.json').read_text())
 ids=sorted({int(id) for ramp in data['ramps'] for id in ramp['wayIds']})
 ways=retrieve(ids)
 profile,unver=build_profiles(data,ways,audit)
 source=("/** OSM motorway_link geometry + tagged lane counts. © OpenStreetMap contributors, ODbL. "
  "No lane guess and no routing fallback. */\nimport type {Point} from './core.js';\n"
  "export type LaneWay={wayId:number;lanes:number;points:Point[]};\n"
  "export const rampLaneWays:Record<string,LaneWay[]>="
  +json.dumps(profile,ensure_ascii=False,separators=(',',':'))+";\n"
  "export const unverifiedRoadWays:readonly number[]="+json.dumps(unver)+";\n"
  "export const laneAuditDate="+json.dumps(audit['created'])+";\n")
 (BASE/'src/lane-profiles.ts').write_text(source)
 print('OSM lane profiles written', {k:[s['lanes'] for s in v] for k,v in profile.items()},'unverified',unver,flush=True)

if __name__=='__main__':main()
