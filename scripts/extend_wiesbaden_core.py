"""Extend the A3 south using exact directed OSM geometry, through AK47."""
import json,collections
from extend_heumar_camberg import ROOT,read_data,pt,dist,walk,grouped
source=json.loads((ROOT/'data/a3-wiesbaden-osm.json').read_text());source['elements']=list({(e['type'],e['id']):e for e in json.loads((ROOT/'data/a3-heumar-camberg-osm.json').read_text())['elements']+source['elements']}.values());data=read_data()
ways=[w for w in source['elements'] if w['type']=='way' and w.get('tags',{}).get('highway')=='motorway' and 'A 3' in w['tags'].get('ref','').split(';')]
for key in ['A3-koeln','A3-frankfurt']:
 own=[r for r in data['roads'] if r['road']==key];counts=collections.Counter(tuple(p) for r in own for p in [r['points'][0],r['points'][-1]])
 start=min(p for p,n in counts.items() if n==1)
 if start[0]<50.05:continue
 graph=collections.defaultdict(list)
 for w in ways:
  ps=list(map(pt,w['geometry']))
  if w['tags'].get('oneway')=='-1':ps.reverse()
  if key=='A3-koeln':ps.reverse()
  for a,b in zip(ps,ps[1:]):graph[a].append((b,w))
 for w,points in grouped(walk(graph,start,lambda p:p[0]<50.048)):
  if key=='A3-koeln':points.reverse()
  length=sum(dist(a,b) for a,b in zip(points,points[1:]))/1000
  old=next((r for r in own if r['wayId']==w['id']),None)
  if old:
   a=list(map(tuple,old['points']))
   if a[-1]==points[0]:old['points']=a+points[1:]
   elif points[-1]==a[0]:old['points']=points+a[1:]
   else:raise ValueError('Ambiguous split OSM way')
   old['km']+=length
  else:
   r=dict(id='A3-'+str(w['id']),wayId=w['id'],road=key,lanes=3,normalLaneCount=3,km=length,posKm=min(r['posKm'] for r in own)-1,points=points,tags=w['tags']);own.append(r);data['roads'].append(r)
for ref,name in [('45','Idstein'),('46','Wiesbaden/Niedernhausen'),('47','AK Wiesbadener Kreuz')]:
 if any(e['road']=='A3' and e['ref']==ref for e in data['exits']):continue
 directional={}
 for key in ['A3-koeln','A3-frankfurt']:
  vertices={tuple(p) for r in data['roads'] if r['road']==key for p in r['points']}
  found=[n for n in source['elements'] if n['type']=='node' and n.get('tags',{}).get('ref')==ref and pt(n) in vertices]
  if len(found)!=1:raise ValueError('Missing directional junction '+key+' '+ref+': '+str(len(found)))
  directional[key]=dict(position=pt(found[0]),nodeId=found[0]['id'])
 data['exits'].append(dict(road='A3',ref=ref,name=name,position=directional['A3-koeln']['position'],directional=directional,source='osm-junction'))
(ROOT/'src/geodata.ts').write_text("import type {MapData} from './core.js';\nexport const networkData:MapData="+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n')
print('A3 south extended',len(data['roads']),'road segments')

audit=json.loads((ROOT/'data/junction-audit.json').read_text())
for e in data['exits']:
 if e['road']!='A3' or e['ref'] not in ['45','46','47']:continue
 for path,anchor in e['directional'].items():
  n=next(n for n in source['elements'] if n['type']=='node' and n['id']==anchor['nodeId'])
  if not any(old['id']==n['id'] for old in audit['junctions']):audit['junctions'].append({**n,'paths':[path]})
audit['wayIds']=sorted(set(audit['wayIds'])|{r['wayId'] for r in data['roads']})
audit['southernExtension']='Exact OSM node chains through Idstein, Wiesbaden/Niedernhausen and Wiesbadener Kreuz; 2026-11-01'
(ROOT/'data/junction-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
