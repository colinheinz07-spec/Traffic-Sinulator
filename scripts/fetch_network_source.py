"""Retain raw OSM sources for the user-requested Heumar–Bad Camberg extension."""
import json,pathlib,urllib.request,urllib.parse,time
query='''[out:json][timeout:150];(
way["highway"~"^(motorway|motorway_link|construction)$"]["ref"~"^A ?(3|560)$"](50.24,7.03,50.96,8.34);
way["highway"="motorway_link"](50.24,7.03,50.96,8.34);
way["highway"="construction"](50.76,7.19,50.82,7.28);
way["construction"="motorway_link"](50.76,7.19,50.82,7.28);
way["highway"~"^(trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](50.64,7.03,50.96,7.39);
way["highway"~"^(trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential)$"](50.285,8.075,50.405,8.30);
node["highway"="motorway_junction"](50.24,7.03,50.96,8.34);
);out body geom;'''
errors=[]
for host in ['https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter','https://overpass.kumi.systems/api/interpreter']:
 try:
  req=urllib.request.Request(host,data=urllib.parse.urlencode({'data':query}).encode(),headers={'User-Agent':'Traffic-Sinulator OSM importer (attribution retained)','Accept':'application/json'})
  with urllib.request.urlopen(req,timeout=170) as r:data=json.load(r)
  if len(data.get('elements',[]))<300:raise ValueError('Incomplete source')
  pathlib.Path('data/a3-heumar-camberg-osm.json').write_text(json.dumps(data,separators=(',',':'))+'\n')
  print('Retained',len(data['elements']),'OSM elements');break
 except Exception as e:errors.append(str(e));print(host,str(e),flush=True)
else:raise RuntimeError('OSM import failed: '+repr(errors))
