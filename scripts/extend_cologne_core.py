"""Extend the shared A3/A4 core carriageways through Kreuz Köln-Ost."""
import json,collections
from extend_heumar_camberg import ROOT,read_data,pt,dist,walk,grouped
source=json.loads((ROOT/'data/cologne-triangle-osm.json').read_text())
source['elements']=list({(e['type'],e['id']):e for e in json.loads((ROOT/'data/a59-a560-osm.json').read_text())['elements']+source['elements']}.values())
data=read_data();ways=[e for e in source['elements'] if e['type']=='way' and e.get('tags',{}).get('highway')=='motorway' and 'A 3' in e['tags'].get('ref','').split(';')]
for key in ['A3-koeln','A3-frankfurt']:
 own=[r for r in data['roads'] if r['road']==key];counts=collections.Counter(tuple(p) for r in own for p in [r['points'][0],r['points'][-1]])
 start=max(p for p,n in counts.items() if n==1)
 if start[0]>=50.9605:continue
 graph=collections.defaultdict(list)
 for w in ways:
  ps=list(map(pt,w['geometry']))
  if key=='A3-frankfurt':ps.reverse()
  for a,b in zip(ps,ps[1:]):graph[a].append((b,w))
 for w,points in grouped(walk(graph,start,lambda p:p[0]>=50.9605)):
  if key=='A3-frankfurt':points.reverse()
  length=sum(dist(a,b) for a,b in zip(points,points[1:]))/1000
  old=next((r for r in own if r['wayId']==w['id']),None)
  if old:
   a=list(map(tuple,old['points']))
   if a[-1]==points[0]:old['points']=a+points[1:]
   elif points[-1]==a[0]:old['points']=points+a[1:]
   else:raise ValueError('Ambiguous Heumar chain')
   old['km']+=length
  else:
   turns=w['tags'].get('turn:lanes','').split('|');through=sum(not ('merge_to_' in t or t in ['left','right','slight_right','slight_left']) for t in turns)
   lanes=min(4,int(w['tags'].get('lanes','3')));lanes=min(lanes,through) if len(turns)>1 and through>=3 else lanes
   r=dict(normalLaneCount=lanes,id='A3-'+str(w['id']),wayId=w['id'],road=key,lanes=3,km=length,posKm=max(r['posKm'] for r in own)+1,points=points,tags={**w['tags'],'ref':'A 3'})
   own.append(r);data['roads'].append(r)
junction=next((e for e in data['exits'] if e['road']=='A3' and e['ref']=='27'),None)
if not junction:
 directional={}
 for key in ['A3-koeln','A3-frankfurt']:
  vertices={tuple(p) for r in data['roads'] if r['road']==key for p in r['points']}
  nodes=[e for e in source['elements'] if e['type']=='node' and e.get('tags',{}).get('ref')=='27' and 'Köln-Ost' in e.get('tags',{}).get('name','') and pt(e) in vertices]
  if len(nodes)!=1:raise ValueError('Missing directional Köln-Ost anchor '+key+': '+str(len(nodes)))
  directional[key]=dict(position=pt(nodes[0]),nodeId=nodes[0]['id'])
 data['exits'].append(dict(road='A3',ref='27',name='AK Köln-Ost',position=directional['A3-koeln']['position'],directional=directional,source='osm-junction'))
for road in data['roads']:
 if road.get('normalLaneCount') is not None:
  raw=next((w for w in ways if w['id']==road['wayId']),None)
  if raw:road['tags']['ref']=raw['tags']['ref']
(ROOT/'src/geodata.ts').write_text("import type {MapData} from './core.js';\nexport const networkData:MapData="+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n')
