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


def service_access_index(ways):
    by_id = {way["id"]: way for way in ways}
    service_points, public_points = set(), set()
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
    return by_id, service_points, public_points


def rest_area_only_ramp(feature, by_id, motorway_points, service_points, public_points):
    if feature.get("kind") != "ramp":
        return False
    endpoints = (tuple(feature["points"][0]), tuple(feature["points"][-1]))
    # A legally mapped motorway-to-motorway interchange arm stays intact.
    if all(point in motorway_points for point in endpoints):
        return False

    for way_id in feature.get("wayIds", ()):
        t = by_id.get(way_id, {}).get("tags", {})
        fields = ("name", "destination", "destination:street", "service",
                  "motorway:service", "amenity")
        if any(SERVICE_AREA.search(str(t.get(k, ""))) for k in fields):
            return True

    # Only *service*-road access with no public street connection is excluded.
    # An ordinary AS which also touches a petrol station remains an AS.
    return (any(p in service_points for p in endpoints)
            and not any(p in public_points for p in endpoints))
