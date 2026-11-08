#!/usr/bin/env python3
"""Find original OSM motorway_link source edges absent from the coloured network.

This is an edge-by-edge audit, not merely a list of dangling endpoints.
No linear interpolation and no conversion of a connecting public road.
"""
import json
import math
from collections import defaultdict
from repair_osm_ramp_gaps import ROOT, existing_routes, load_ways, point, coord, metres, REST_AREA, FORBIDDEN
from audit_ramp_gap_sources import CITIES

def audit():
    routes, _, _ = existing_routes()
    shown = set()
    existing_ids = set()
    for route in routes:
        existing_ids.update(route.get("wayIds", []))
        if route.get("wayId"):
            existing_ids.add(route["wayId"])
        pp = [coord(p) for p in route["points"]]
        for a, b in zip(pp, pp[1:]):
            shown.add(frozenset((a, b)))
    output = {}
    for name, centre in CITIES:
        near = []
        for way in load_ways():
            tags=way.get("tags",{})
            if tags.get("highway") != "motorway_link":
                continue
            if any(tags.get(k) in FORBIDDEN for k in ("access", "vehicle", "motor_vehicle", "motorcar")):
                continue
            title = " ".join(str(tags.get(k, "")) for k in
                ("name","destination","service","motorway:service","amenity"))
            if REST_AREA.search(title):
                continue
            ps=[point(p) for p in way["geometry"]]
            if not any(metres(p,centre)<1800 for p in ps):
                continue
            unshown = [(a,b) for a,b in zip(ps,ps[1:]) if frozenset((a,b)) not in shown]
            if not unshown:
                continue
            length=sum(metres(a,b) for a,b in unshown)
            near.append({
                "wayId":way["id"],"highway":tags.get("highway"),
                "alreadyInRouteWayIds":way["id"] in existing_ids,
                "totalPoints":len(ps),"missingEdges":len(unshown),
                "missingLengthM":round(length,1),
                "segments":[{"a":a,"b":b,"lengthM":round(metres(a,b),1)} for a,b in unshown[:4]],
            })
        output[name]={"numberOfWays":len(near),"wayRecords":sorted(near,key=lambda w:-w["missingLengthM"])}
    return output

if __name__=="__main__":
    result=audit()
    (ROOT/"data/missing-osm-ramp-edges.json").write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps({k:{"ways":v["numberOfWays"],"missingLengthM":round(sum(w["missingLengthM"] for w in v["wayRecords"]))} for k,v in result.items()}))
