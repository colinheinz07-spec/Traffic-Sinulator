import { nearestPolyline } from './core.js?build=5b113574c0934a2f';
import { rampLaneWays, unverifiedRoadWays } from './lane-profiles.js?build=5b113574c0934a2f';
export function roadLaneInfo(road) {
    if (unverifiedRoadWays.includes(road.wayId))
        return { count: road.lanes, label: `${road.lanes} (gespeicherte Altangabe – aktueller OSM-Weg nicht bestätigt)`, source: 'stale', wayId: road.wayId };
    return { count: road.lanes, label: `${road.lanes} (aktuelle OSM-Fahrstreifenangabe)`, source: 'osm', wayId: road.wayId };
}
export function rampLaneInfo(ramp, position) {
    const ways = rampLaneWays[ramp.id] || [];
    if (!ways.length)
        return { count: ramp.lanes, label: 'Nicht ausreichend geprüft', source: 'unknown', wayId: null };
    const cosine = Math.cos(position[0] * Math.PI / 180);
    const project = (point) => [point[1] * 111195 * cosine, point[0] * 111195];
    const target = project(position);
    let nearest = null;
    for (const way of ways) {
        const hit = nearestPolyline(way.points, target, project);
        if (!nearest || hit.distance < nearest.metres)
            nearest = { metres: hit.distance, wayId: way.wayId, lanes: way.lanes };
    }
    if (!nearest || nearest.metres > 45)
        return { count: ramp.lanes, label: 'Position nicht eindeutig einem geprüften Rampenteilstück zugeordnet', source: 'unknown', wayId: null };
    const laneSet = [...new Set(ways.map(w => w.lanes))].sort((a, b) => a - b);
    const range = laneSet.length > 1 ? ` · Rampe abschnittsweise ${laneSet.join('–')} Fahrstreifen` : '';
    return { count: nearest.lanes, label: `${nearest.lanes} (OSM-Rampenteilstück ${nearest.wayId}${range})`, source: 'osm', wayId: nearest.wayId };
}
