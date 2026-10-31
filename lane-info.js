import { normalLaneOverrides } from './normal-lanes.js?build=19433adb960dd212';
import { nearestPolyline } from './core.js?build=19433adb960dd212';
import { rampLaneWays, unverifiedRoadWays } from './lane-profiles.js?build=19433adb960dd212';
/** OSM lanes includes acceleration/diverging lanes and sometimes temporary
 * construction layouts. A3's verified normal corridor has three through
 * lanes. A48 auxiliary turn/merge-only lanes are excluded explicitly. */
export function normalThroughLanes(road) {
    if (road.road.startsWith('A3'))
        return 3;
    if (normalLaneOverrides[road.wayId] !== undefined)
        return normalLaneOverrides[road.wayId];
    const turns = road.tags?.['turn:lanes']?.split('|');
    const through = turns?.filter(t => !t.includes('merge_to_') && !/^(slight_right|slight_left|right|left)$/.test(t)).length;
    return Math.max(1, Math.min(road.lanes, 3, through && through >= 2 ? through : road.lanes));
}
export function roadLaneInfo(road) {
    const count = normalThroughLanes(road);
    if (unverifiedRoadWays.includes(road.wayId))
        return { count, label: `${count} reguläre durchgehende Fahrstreifen · Geometrie aus Altbestand`, source: 'stale', wayId: road.wayId };
    return { count, label: `${count} reguläre durchgehende Fahrstreifen · ohne Ein-/Ausfädelstreifen und Baustellen`, source: 'normal', wayId: road.wayId };
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
