"""Regeneriert die verifizierten, bisher fehlenden Autobahn-Rampen.
Nur original OSM motorway_link + gemeinsame OSM-node-IDs (KEIN Abstandssnap).
© OpenStreetMap contributors, ODbL. Ausgangs-Snapshots siehe SOURCES.
"""
import json, math, re
from collections import defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SOURCES=(
 "a3-heumar-camberg-osm.json","a3-wiesbaden-osm.json",
 "a4-koeln-sued-osm.json",
 "a4-koeln-west-osm.json","a555-a565-bonn-osm.json",
 "bonn-a59-a562-osm.json","a59-a560-osm.json","cologne-triangle-osm.json",
)
PUBLIC={"trunk","trunk_link","primary","primary_link","secondary","secondary_link",
        "tertiary","tertiary_link","residential","unclassified","living_street"}
SERVICE=re.compile(r"rast(st[aä]tte|anlage|platz|hof)?|autohof|p\s*\+?\s*wc|pwc|"
                   r"tankstelle|service\s*area|rest\s*area|parking\s*area",re.I)
BAN={"no","private"}
def point(p):return [p["lat"],p["lon"]]
def distance(a,b):
 return 111195*math.hypot(a[0]-b[0],(a[1]-b[1])*math.cos(math.radians((a[0]+b[0])/2)))
def length(points):return sum(distance(a,b) for a,b in zip(points,points[1:]))
def array_from_ts(text,prefix):
 assert prefix in text,"Geometriedaten fehlen: "+prefix
 return json.loads(text.split(prefix,1)[1].split(";",1)[0])
def regenerate():
 ext=(ROOT/"src/network-extensions.ts").read_text()
 core=(ROOT/"src/geodata.ts").read_text()
 features=array_from_ts(ext,"export const extensionRoutes:ExtensionRoute[]=")
 origins=array_from_ts(core,"export const networkData:MapData=")
 exits=origins["exits"]+array_from_ts(ext,"export const extensionJunctions:Exit[]=")
 owned={way for f in features for way in f["wayIds"]}
 owned.update(f["wayId"] for f in origins["roads"])
 owned.update(way for r in origins["ramps"] for way in r["wayIds"])
 ways={}
 for name in SOURCES:
  for w in json.loads((ROOT/"data"/name).read_text())["elements"]:
   if w.get("type")=="way" and w.get("geometry") and w.get("nodes") and w.get("tags",{}).get("highway"):
    ways[w["id"]]=w
 known={n for w in ways.values() if w["id"] in owned for n in w["nodes"]}
 candidates={w["id"]:w for w in ways.values()
  if w["tags"]["highway"]=="motorway_link" and w["id"] not in owned
  and not any(w["tags"].get(k) in BAN for k in ("access","motor_vehicle","motorcar"))}
 indexed=defaultdict(list)
 for w in candidates.values():
  for node in w["nodes"]:indexed[node].append(w["id"])
 active={w["id"] for w in candidates.values() if any(n in known for n in w["nodes"])}
 queue=list(active)
 for id in queue:
  for node in candidates[id]["nodes"]:
   for neighbor in indexed[node]:
    if neighbor not in active:
     active.add(neighbor);queue.append(neighbor)
 public={n for w in ways.values()
  if w["tags"]["highway"] in PUBLIC and w["tags"].get("access") not in BAN
  for n in w["nodes"]}
 service={n for w in ways.values() if w["tags"]["highway"]=="service" for n in w["nodes"]}
 selected=[]
 for id in sorted(active):
  w=candidates[id]
  title=" ".join(str(w["tags"].get(k,"")) for k in
      ("name","destination","destination:street","service","motorway:service","amenity"))
  ends=[w["nodes"][0],w["nodes"][-1]]
  if SERVICE.search(title) or any(n in service for n in ends) and not any(n in public for n in ends):
   continue
  selected.append(w)
 links=[]
 for w in selected:
  points=list(map(point,w["geometry"]))
  mid=points[len(points)//2]
  closest=min(exits,key=lambda j:distance(mid,j["position"]))
  d=distance(mid,closest["position"])
  where=(f"nahe {closest['road']} {closest['ref']} {closest['name']}"
          if d<=2000 else "im importierten Autobahnnetz")
  try:raw_lanes=int(w["tags"].get("lanes",1))
  except(ValueError,TypeError):raw_lanes=1
  twoway=w["tags"].get("oneway")=="no"
  lanes=max(1,min(4,raw_lanes)//2) if twoway else max(1,min(4,raw_lanes))
  for reverse in ([False,True] if twoway else [False]):
   curve=points[::-1] if reverse or w["tags"].get("oneway")=="-1" else points
   metres=length(curve)
   assert metres>1,(w["id"],metres)
   links.append(dict(id="extra-osm-link-"+str(w["id"])+("-back" if reverse else ""),
       name=f"OSM-Rampe {w['id']}"+(" (Gegenrichtung)" if reverse else "")+" · "+where,
       zone="OSM-geprüfte Rampe · "+where,kind="ramp",lanes=lanes,
       laneSegments=[dict(fromM=0,toM=metres,lanes=lanes)],points=curve,
       wayIds=[w["id"]],demandVph=0,freeKmh=80))
 bounds={}
 for w in selected:
  for n,p in zip(w["nodes"],w["geometry"]):
   if n in public:
    v=point(p);bounds[tuple(v)]=v
 notice="""/** Automatisch aus gespeicherten OSM-Knoten erzeugt – ODbL/© OSM-Mitwirkende.
 * Keine Geometrieschätzung, keine Rampen an Rastplätzen, kein Phantomverkehr.
 * Befehl: python3 scripts/build_osm_additional_ramps.py
 */
"""
 dest=notice+"export interface VerifiedOsmLink {id:string;name:string;zone:string;kind:'ramp';lanes:number;laneSegments:{fromM:number;toM:number;lanes:number}[];points:[number,number][];wayIds:number[];demandVph:number;freeKmh:number}\n"
 dest+="export const verifiedOsmAdditionalRoutes:VerifiedOsmLink[]="+json.dumps(links,ensure_ascii=False,separators=(",",":"))+";\n"
 dest+="export const verifiedOsmStreetBoundaries:[number,number][]="+json.dumps([bounds[k] for k in sorted(bounds)],separators=(",",":"))+";\n"
 (ROOT/"src/01_Strassennetz/osm-zusatzrampen.ts").write_text(dest)
 print("OSM verified additions:",len(selected),"ways,",len(links),"directional paths,",len(bounds),"public boundaries")

if __name__=="__main__":regenerate()
