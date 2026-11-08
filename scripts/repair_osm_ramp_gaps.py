#!/usr/bin/env python3
"""Fill *actual* missing motorway_link edges at ramp ends from pinned OSM data.

Only the original coordinates of a stored OSM way are added. A missing edge
must start at an otherwise dangling imported ramp endpoint and finish at a
second, different existing motorway/ramp path, using exact OSM coordinates.
Never bridge by proximity, never turn public streets into motorway ramps.
"""
import hashlib
import heapq
import json
import math
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = (
    "a3-heumar-camberg-osm.json", "a3-wiesbaden-osm.json",
    "a4-koeln-sued-osm.json", "a4-koeln-west-osm.json",
    "a555-a565-bonn-osm.json", "bonn-a59-a562-osm.json",
    "a59-a560-osm.json", "cologne-triangle-osm.json",
)
DEST = ROOT / "src/01_Strassennetz/osm-rampenluecken.ts"
FORBIDDEN = {"no", "private"}
REST_AREA = re.compile(
    r"rast(st[aä]tte|anlage|platz|hof)?|autohof|p\s*\+?\s*wc|pwc|"
    r"tankstelle|service\s*area|rest\s*area|parking\s*area", re.I
)
MAX_GAP_METRES = 280
MAX_SEGMENTS = 36


def point(p):
    return (round(float(p["lat"]), 7), round(float(p["lon"]), 7))


def coord(p):
    return (round(float(p[0]), 7), round(float(p[1]), 7))


def metres(a, b):
    return 111195 * math.hypot(
        a[0] - b[0], (a[1] - b[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    )


def read_array(path, prefix):
    source = path.read_text()
    if prefix not in source:
        raise ValueError("Missing OSM catalogue in " + str(path))
    return json.loads(source.split(prefix, 1)[1].split(";\n", 1)[0])


def existing_routes():
    core = read_array(ROOT / "src/geodata.ts", "export const networkData:MapData=")
    ext = read_array(ROOT / "src/network-extensions.ts",
                     "export const extensionRoutes:ExtensionRoute[]=")
    verified = read_array(ROOT / "src/01_Strassennetz/osm-zusatzrampen.ts",
                          "export const verifiedOsmAdditionalRoutes:VerifiedOsmLink[]=")
    street = set(map(coord, read_array(
        ROOT / "src/network-extensions.ts", "export const extensionRampBoundaryPoints:Point[]="
    )))
    street.update(map(coord, read_array(
        ROOT / "src/01_Strassennetz/osm-zusatzrampen.ts",
        "export const verifiedOsmStreetBoundaries:[number,number][]="
    )))
    roads = [{"id": r["id"], "kind": "motorway", "points": r["points"]}
             for r in core["roads"]]
    ramps = [{"id": r["id"], "kind": "ramp", "points": r["points"]}
             for r in core["ramps"]]
    return roads + ramps + ext + verified, street, core["exits"]


def load_ways():
    ways = {}
    for name in SOURCES:
        path = ROOT / "data" / name
        if not path.exists():
            raise FileNotFoundError(path)
        for w in json.loads(path.read_text())["elements"]:
            if w.get("type") != "way" or not w.get("nodes") or not w.get("geometry"):
                continue
            if len(w["nodes"]) != len(w["geometry"]):
                continue
            old = ways.get(w["id"])
            if old is None or len(w["nodes"]) > len(old["nodes"]):
                ways[w["id"]] = w
    return ways.values()


def gap_routes():
    features, street, exits = existing_routes()
    owners = defaultdict(set)
    drawn_edges = set()
    for feature in features:
        ps = [coord(p) for p in feature["points"]]
        for p in ps:
            owners[p].add(feature["id"])
        for a, b in zip(ps, ps[1:]):
            drawn_edges.add(frozenset((a, b)))

    # Start only at genuine open ends of imported ramp shapes. Public-road
    # terminals are legitimate ends and must not become green motorway pieces.
    starts = {}
    for feature in features:
        if feature["kind"] != "ramp":
            continue
        for p in (coord(feature["points"][0]), coord(feature["points"][-1])):
            if p not in street and owners[p] == {feature["id"]}:
                starts[p] = feature["id"]

    graph = defaultdict(list)
    for way in load_ways():
        tags = way.get("tags", {})
        if tags.get("highway") != "motorway_link":
            continue
        if any(tags.get(k) in FORBIDDEN for k in ("access", "vehicle", "motor_vehicle", "motorcar")):
            continue
        title = " ".join(str(tags.get(k, "")) for k in
                         ("name", "destination", "service", "motorway:service", "amenity"))
        if REST_AREA.search(title):
            continue
        ps = list(map(point, way["geometry"]))
        reverse = tags.get("oneway") == "-1"
        two_way = tags.get("oneway") == "no"
        if reverse:
            ps.reverse()
        for a, b in zip(ps, ps[1:]):
            dist = metres(a, b)
            if dist <= 0.05 or dist > MAX_GAP_METRES:
                continue
            if frozenset((a, b)) in drawn_edges:
                continue
            graph[a].append((b, dist, way["id"], tags))
            if two_way:
                graph[b].append((a, dist, way["id"], tags))

    used = set()
    patches = []
    for start, origin in sorted(starts.items()):
        if not graph.get(start):
            continue
        queue = [(0.0, 0, start, [])]
        best = {(start, 0): 0.0}
        found = None
        while queue:
            distance, n, current, path = heapq.heappop(queue)
            if distance > MAX_GAP_METRES:
                break
            if path and any(other != origin for other in owners.get(current, ())):
                found = (distance, path)
                break
            if n >= MAX_SEGMENTS:
                continue
            for target, length, way_id, tags in graph.get(current, []):
                key = frozenset((current, target))
                total = distance + length
                if total > MAX_GAP_METRES or key in used or any(key == edge[4] for edge in path):
                    continue
                state = (target, n + 1)
                if total >= best.get(state, float("inf")):
                    continue
                best[state] = total
                heapq.heappush(queue, (total, n + 1, target,
                                       path + [(current, target, way_id, tags, key)]))
        if not found:
            continue
        distance, path = found
        if distance < 1 or any(edge[4] in used for edge in path):
            continue
        for edge in path:
            used.add(edge[4])
        points = [list(path[0][0])] + [list(edge[1]) for edge in path]
        way_ids = list(dict.fromkeys(edge[2] for edge in path))
        try:
            lanes = int(path[0][3].get("lanes", "1"))
        except (TypeError, ValueError):
            lanes = 1
        lanes = max(1, min(4, lanes))
        middle = points[len(points)//2]
        near = min(exits, key=lambda j: metres(coord(middle), coord(j["position"])))
        zone = f'{near["road"]} {near["ref"]} {near["name"]}'
        signature = "|".join(f"{edge[2]}:{edge[0]}>{edge[1]}" for edge in path)
        suffix = hashlib.sha1(signature.encode()).hexdigest()[:12]
        patches.append({
            "id": "extra-osm-ramp-gap-" + suffix,
            "name": "OSM-Rampenteilstück · " + zone,
            "zone": zone, "kind": "ramp", "lanes": lanes,
            "laneSegments": [{"fromM": 0, "toM": distance, "lanes": lanes}],
            "points": points, "wayIds": way_ids, "demandVph": 0, "freeKmh": 80,
        })
    return patches, len(starts), len(graph)


def main():
    patches, open_ends, source_nodes = gap_routes()
    header = (
        "/** OSM-originale, tatsächlich fehlende motorway_link-Kanten an Rampen.\n"
        " * Keine Landstraßen, kein Snapping, keine künstlichen Geraden.\n"
        " * Erzeugt mit scripts/repair_osm_ramp_gaps.py. © OSM-Mitwirkende, ODbL.\n"
        " */\n"
        "export interface VerifiedRampGap {id:string;name:string;zone:string;"
        "kind:'ramp';lanes:number;laneSegments:{fromM:number;toM:number;lanes:number}[];"
        "points:[number,number][];wayIds:number[];demandVph:number;freeKmh:number}\n"
        "export const verifiedRampGapRoutes:VerifiedRampGap[]="
    )
    content = header + json.dumps(patches, ensure_ascii=False, separators=(",", ":")) + ";\n"
    DEST.write_text(content)
    places = ["Idstein", "Montabaur", "Limburg"]
    report = {
        "unattachedRampEnds": open_ends,
        "sourceGraphNodes": source_nodes,
        "verifiedPatches": len(patches),
        "sumLengthM": round(sum(r["laneSegments"][0]["toM"] for r in patches), 1),
        "locations": {place: sum(place.lower() in r["zone"].lower() for r in patches)
                      for place in places},
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    (ROOT / "data/ramp-gap-repair-audit.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    )


if __name__ == "__main__":
    main()
