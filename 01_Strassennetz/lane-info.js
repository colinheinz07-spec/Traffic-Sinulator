/** 01_Strassennetz: Zugeordnetes Fachmodul lane-info. */
import { normalLaneOverrides, motorwayLaneCalibration } from '../normal-lanes.js?build=af5a9319e52db706';
import { nearestPolyline } from '../core.js?build=af5a9319e52db706';
import { rampLaneWays, unverifiedRoadWays } from '../lane-profiles.js?build=af5a9319e52db706';
/** OSM lanes includes acceleration/diverging lanes and sometimes temporary
 * construction layouts. A3's verified normal corridor has three through
 * lanes. A48 auxiliary turn/merge-only lanes are excluded explicitly. */
export function normalThroughLanes(road) {
    if (road.normalLaneCount !== undefined)
        return road.normalLaneCount;
    const motorway = road.road.match(/^A\d{1,3}(?!\d)/i)?.[0]?.toUpperCase();
    const calibration = motorway ? motorwayLaneCalibration[motorway] : undefined;
    if (calibration?.fixed !== undefined)
        return calibration.fixed;
    if (normalLaneOverrides[road.wayId] !== undefined)
        return normalLaneOverrides[road.wayId];
    const turns = road.tags?.['turn:lanes']?.split('|');
    const through = turns?.filter(t => !t.includes('merge_to_') && !/^(slight_right|slight_left|right|left)$/.test(t)).length;
    return Math.max(1, Math.min(road.lanes, calibration?.maximum ?? 7, through && through >= 2 ? through : road.lanes));
}
export function motorwayLaneSplit(road) {
    const refs = road.tags?.['destination:ref:lanes']?.split('|');
    if (!refs || refs.length < 2)
        return null;
    const byLane = refs.map(slot => [...new Set((slot.match(/A\s*\d{1,3}/gi) ?? [])
            .map(n => n.replaceAll(' ', '').toUpperCase()))].sort());
    const distinct = [...new Set(byLane.flat())];
    if (distinct.length < 2)
        return null; // AS -> B484 is NOT an AD/AK split.
    const groups = new Map();
    for (const motorways of byLane) {
        if (!motorways.length)
            continue;
        const key = motorways.join('|'), item = groups.get(key) ?? { motorways, count: 0 };
        item.count++;
        groups.set(key, item);
    }
    const dedicated = {};
    for (const group of groups.values())
        if (group.motorways.length === 1)
            dedicated[group.motorways[0]] = (dedicated[group.motorways[0]] ?? 0) + group.count;
    return { total: refs.length, destinations: [...groups.values()], dedicated,
        shared: [...groups.values()].filter(g => g.motorways.length > 1).reduce((n, g) => n + g.count, 0) };
}
export function roadLaneInfo(road) {
    const count = normalThroughLanes(road);
    const split = motorwayLaneSplit(road);
    if (split) {
        const parts = split.destinations.map(g => g.count + ' × ' + g.motorways.join('/')).join(' · ');
        return { count, label: `${count} reguläre Durchgangsfahrstreifen · AD/AK-Verzweigung: ${split.total} markierte Spuren (${parts}) · Abbiegespuren getrennt als Rampen`,
            source: unverifiedRoadWays.includes(road.wayId) ? 'stale' : 'osm', wayId: road.wayId };
    }
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
