#!/usr/bin/env python3
"""Audit lane counts against CURRENT raw OSM way tags, without guessing missing values.

No map editing. Produces a reproducible report with source IDs and tag provenance.
"""
import collections
import datetime as dt
import json
from pathlib import Path
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
SOURCES=(
 'https://overpass.private.coffee/api/interpreter',
 'https://overpass-api.de/api/interpreter',
 'https://overpass.kumi.systems/api/interpreter'
)
LANE_TAGS=('lanes','lanes:forward','lanes:backward','turn:lanes','turn:lanes:forward','destination:lanes','change:lanes','placement','oneway','highway','ref','maxspeed','shoulder','lanes:psv')

def parse_dataset(text):
 match=re.search(r'export const networkData:\s*MapData\s*=\s*(\{.*\});?\s*$',text,re.S)
 if not match:raise ValueError('Expected embedded TypeScript OSM dataset missing')
 return json.loads(match.group(1))

def parse_tag_lanes(tags):
 """Only trust explicit OSM lanes on one-way ways, never a guessed fallback."""
 value=tags.get('lanes')
 if isinstance(value,str) and re.fullmatch(r'[1-9]\d?',value):return int(value)
 # Other lanes:forward tags are only meaningful if direction and oneway agree.
 value=tags.get('lanes:forward')
 if tags.get('oneway')!='-1' and isinstance(value,str) and re.fullmatch(r'[1-9]\d?',value):return int(value)
 return None

def make_report(data,ways):
 known=set(map(int,ways))
 original={int(r['wayId']) for r in data['roads']}
 ramp_ways={int(w) for r in data['ramps'] for w in r['wayIds']}
 rows=[];groups=collections.defaultdict(lambda:collections.Counter())
 for r in data['roads']:
  k=int(r['wayId']); osm=ways.get(k,{});tags=osm.get('tags',{});seen=k in known
  found=parse_tag_lanes(tags) if seen else None
  status=('missing_osm' if not seen else 'untagged' if found is None else 'matches' if found==r['lanes'] else 'mismatch')
  groups[r['road']][status]+=1
  rows.append({'wayId':k,'road':r['road'],'km':r['km'],'modelLanes':r['lanes'],
   'osmLanes':found,'status':status,'tags':{key:tags[key] for key in LANE_TAGS if key in tags},
   'nearDernbach':any(50.437<p[0]<50.491 and 7.74<p[1]<7.794 for p in (r['points'][0],r['points'][len(r['points'])//2],r['points'][-1]))})
 ramps=[]
 for ramp in data['ramps']:
  segment=[]
  for way_id in ramp['wayIds']:
   tags=ways.get(int(way_id),{}).get('tags',{})
   segment.append({'wayId':way_id,'lanes':parse_tag_lanes(tags) if way_id in known else None,
    'hasSource':int(way_id) in known,'tags':{key:tags[key] for key in LANE_TAGS if key in tags}})
  annotated=[seg['lanes'] for seg in segment if seg['lanes'] is not None]
  ramps.append({'id':ramp['id'],'name':ramp['name'],'modelLanes':ramp['lanes'],'sourceSections':segment,
   'explicitLanes':sorted(set(annotated)),'untaggedSections':sum(seg['lanes'] is None for seg in segment)})
 return {'created':dt.datetime.now(dt.timezone.utc).isoformat(),'source':'OSM tags through Overpass; lane counts do not verify current physical markings',
  'roadSummary':{g:dict(c) for g,c in groups.items()},'roads':rows,'ramps':ramps,
  'queriedIds':len(original|ramp_ways),'receivedIds':len(ways),
  'lastImportDate':data.get('created')}

def download(ids):
 ways={}
 for idx in range(0,len(ids),160):
  chunk=ids[idx:idx+160]
  query='[out:json][timeout:100];way(id:'+','.join(str(i) for i in chunk)+');out tags;'
  failures=[]
  for source in SOURCES:
   for attempt in range(2):
    try:
     request=urllib.request.Request(source,data=urllib.parse.urlencode({'data':query}).encode(),
      headers={'User-Agent':'Traffic-Sinulator-lanes-audit/0.5 (OpenStreetMap attribution)','Accept':'application/json'},method='POST')
     with urllib.request.urlopen(request,timeout=120) as resp:obj=json.load(resp)
     if 'elements' not in obj:raise ValueError('No OSM elements')
     for element in obj['elements']:
      if element.get('type')=='way' and element.get('id') in chunk:ways[int(element['id'])]=element
     print(f'Batch {idx//160+1}: {len(obj["elements"])} ways',flush=True)
     break
    except Exception as exc:
     failures.append(str(exc)[:150]);time.sleep(1+attempt)
   else:continue
   break
  else:raise RuntimeError(f'OSM unreachable for batch {idx//160+1}: {failures}')
 return ways

def main():
 data=parse_dataset((ROOT/'src/geodata.ts').read_text())
 ids=sorted({int(r['wayId']) for r in data['roads']}|{int(i) for ramp in data['ramps'] for i in ramp['wayIds']})
 if len(sys.argv)>1:
  raw=json.loads(Path(sys.argv[1]).read_text())
  ways={int(w['id']):w for w in raw.get('elements',[])}
 else:ways=download(ids)
 report=make_report(data,ways)
 if report['receivedIds']<int(.96*report['queriedIds']):
  raise RuntimeError(f'Incomplete live query: {report["receivedIds"]}/{report["queriedIds"]} OSM ways')
 out=ROOT/'data/lane-audit.json';out.parent.mkdir(exist_ok=True)
 out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print('LANE AUDIT',json.dumps({'roadSummary':report['roadSummary'],
  'ramps':[{k:r[k] for k in ('name','explicitLanes','untaggedSections')} for r in report['ramps']],
  'total':report['receivedIds']},ensure_ascii=False),flush=True)

if __name__=='__main__':main()
