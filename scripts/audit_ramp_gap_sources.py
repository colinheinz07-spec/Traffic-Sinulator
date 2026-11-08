#!/usr/bin/env python3
"""Diagnose 8-80-m visual breaks at genuine motorway ramp ends.

List the actual OSM way class and original nodes nearest the exported endpoint.
Output is a small public audit, not a geometry modification.
"""
import json
from pathlib import Path
from repair_osm_ramp_gaps import ROOT, existing_routes, load_ways, coord, point, metres

CITIES = (
    ("Idstein", (50.2110, 8.2500)),
    ("Montabaur", (50.4450, 7.8310)),
    ("Limburg-Nord", (50.3998, 8.0710)),
)
RADIUS = 1500.0


def report():
    features, street, exits = existing_routes()
    ways = []
    for w in load_ways():
        tags = w.get("tags", {})
        if tags.get("highway") not in {
            "motorway_link", "motorway", "trunk_link", "primary_link",
            "secondary_link", "trunk", "primary", "secondary", "tertiary",
            "tertiary_link", "unclassified", "residential", "service",
        }:
            continue
        pts = list(map(point, w["geometry"]))
        ways.append((w, pts))

    owners = {}
    edges = set()
    for f in features:
        pts = [coord(p) for p in f["points"]]
        for p in pts:
            owners.setdefault(p, set()).add(f["id"])
        edges.update(frozenset((a, b)) for a, b in zip(pts, pts[1:]))

    output = {}
    for name, centre in CITIES:
        loose = []
        cityways = [(w, ps) for w, ps in ways if any(metres(p, centre) <= RADIUS + 150 for p in ps)]
        for f in features:
            if f.get("kind") != "ramp":
                continue
            for position in (f["points"][0], f["points"][-1]):
                at = coord(position)
                if metres(at, centre) > RADIUS:
                    continue
                if len(owners.get(at, ())) > 1 or at in street:
                    continue
                near = []
                for w, ps in cityways:
                    for index, (a, b) in enumerate(zip(ps, ps[1:])):
                        d = min(metres(at, a), metres(at, b))
                        if d > 95:
                            continue
                        near.append({
                            "wayId": w["id"], "highway": w["tags"]["highway"],
                            "name": w["tags"].get("name"),
                            "oneway": w["tags"].get("oneway"),
                            "access": w["tags"].get("access"),
                            "a": a, "b": b,
                            "nodeA": w["nodes"][index],
                            "nodeB": w["nodes"][index+1],
                            "distanceToEndpointsM": round(d, 1),
                            "edgeLengthM": round(metres(a, b), 1),
                            "alreadyDisplayed": frozenset((a, b)) in edges,
                            "exactSharedNode": at in (a, b),
                        })
                near.sort(key=lambda e: (e["distanceToEndpointsM"],
                                         0 if e["exactSharedNode"] else 1,
                                         e["wayId"]))
                loose.append({"ramp": f["id"], "wayIds": f.get("wayIds"),
                              "point": at, "nearestOsmEdges": near[:8]})
        output[name] = {
            "openRampEnds": len(loose),
            "examples": loose[:35]
        }
    return output


if __name__ == "__main__":
    data = report()
    dest = ROOT / "data/ramp-gap-diagnostics.json"
    dest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({name: result["openRampEnds"]
                      for name, result in data.items()}, ensure_ascii=False))
