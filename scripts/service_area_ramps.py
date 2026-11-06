"""Exclude motorway_link branches serving only motorway rest/service areas.

A ramp must connect to an actual motorway junction, other motorway or the
public local-road network to be a selectable AS/AD/AK connection. A private
service-area slip road is NOT an Autobahnanschlussstelle.
"""
import re

SERVICE_AREA = re.compile(
    r"rast(st[aä]tte|anlage|platz|hof)?|autohof|p\s*\+?\s*wc|pwc|"
    r"tankstelle|service\s*area|rest\s*area|parking\s*area",
    re.IGNORECASE,
)
PUBLIC_ROADS = {
    "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link",
    "residential", "unclassified", "living_street",
}


def rest_area_only_ramp(feature, ways, motorway_points):
    if feature.get("kind") != "ramp":
        return False
    # Exactly one directed motorway-to-motorway transfer is legitimate even
    # when a service road happens to cross the ramp nearby.
    endpoints = (tuple(feature["points"][0]), tuple(feature["points"][-1]))
    if all(point in motorway_points for point in endpoints):
        return False

    by_id = {way["id"]: way for way in ways}
    for way_id in feature.get("wayIds", ()):
        t = by_id.get(way_id, {}).get("tags", {})
        fields = ("name", "destination", "destination:street", "service",
                  "motorway:service", "amenity")
        if any(SERVICE_AREA.search(str(t.get(k, ""))) for k in fields):
            return True

    service_points = set()
    public_points = set()
    for way in ways:
        tags = way.get("tags", {})
        highway = tags.get("highway")
        if highway not in PUBLIC_ROADS and highway != "service":
            continue
        points = {(round(p["lat"], 7), round(p["lon"], 7))
                  for p in way.get("geometry", [])}
        if highway == "service":
            service_points.update(points)
        else:
            public_points.update(points)
    touches_service = any(p in service_points for p in endpoints)
    touches_public = any(p in public_points for p in endpoints)
    return touches_service and not touches_public
