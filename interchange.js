import { positionM, metres } from './spatial.js?build=9296d788994cefba';
import { defaultDemand, eventCapacity } from './traffic.js?build=9296d788994cefba';
import { DEFAULT_CLEARANCE_MIN } from './events.js?build=9296d788994cefba';
export const INTERCHANGE_DIVERSION_START_MIN = 45;
const movements = {
    'ramp-a48-to-koeln': { from: 'A48-dernbach', to: 'A3-koeln' },
    'ramp-a48-to-frankfurt': { from: 'A48-dernbach', to: 'A3-frankfurt' },
    'ramp-a3-to-a48-from-koeln': { from: 'A3-frankfurt', to: 'A48-koblenz' },
    'ramp-a3-to-a48-from-frankfurt': { from: 'A3-koeln', to: 'A48-koblenz' }
};
/** Explicit destination-mix assumption, not individually observed trips.
 * A48 ends at the two A3 branches. A3 includes straight-ahead traffic, so
 * only its configured A48 turn share is eligible for the Koblenz bypass. */
export function interchangeTrafficShare(id, from, to, demands) {
    const movement = movements[id];
    if (!movement || movement.from !== from || movement.to !== to)
        return 0;
    const rate = (key) => Math.max(0, demands[key] ?? defaultDemand(key));
    const total = from === 'A48-dernbach' ? rate('ramp-a48-to-koeln') + rate('ramp-a48-to-frankfurt') : rate(from);
    return total > 0 ? Math.min(1, rate(id) / total) : 0;
}
/** Only the matching turn's observations count. A blocked accident uses
 * the same declared one-lane reopening scenario as a blocked mainline;
 * its age is never substituted for travel-time loss. */
export function interchangeDelays(jams, events) {
    const result = {};
    for (const jam of jams) {
        if (!movements[jam.pathKey])
            continue;
        let loss = jam.delayMin;
        if (loss === null) {
            const event = events.find(e => e.id === jam.id && e.kind !== 'closure');
            if (!event)
                continue;
            const release = { ...event, closedLanes: Array.from({ length: Math.max(0, event.laneCount - 1) }, (_, i) => i),
                settings: { ...event.settings, speedKmh: 40, shoulder: 'normal' } };
            const service = eventCapacity(release);
            if (service <= 0)
                continue;
            loss = (event.settings.clearanceMin ?? DEFAULT_CLEARANCE_MIN) + jam.queueVehicles / service * 60;
        }
        result[jam.pathKey] = Math.max(result[jam.pathKey] ?? 0, loss);
    }
    return result;
}
/** Source/destination must agree with actual motorway_link geometry.
 * All four ramps must connect to independently verified directional routes.
 * Distance threshold does not invent a linking polyline; it is a validation gate.
 */
export function buildRampConnections(ramps, routes) {
    const connections = [];
    for (const ramp of ramps) {
        const path = routes[ramp.id];
        const source = routes[ramp.from], target = routes[ramp.to];
        if (!path || !source || !target)
            throw Error('Unvollständige Verbindungs-Geometrie: ' + ramp.id);
        const entrance = path.points[0], merge = path.points.at(-1);
        const start = positionM(source, entrance, 35), end = positionM(target, merge, 35);
        if (start === null || end === null)
            throw Error(`AD-Rampe nicht eindeutig mit der richtigen Richtung verbunden: ${ramp.id}`);
        // Do not connect ramps that are within tolerance but visibly discontinuous.
        const sourcePoint = pointAt(source, start), mergePoint = pointAt(target, end);
        const sourceGapM = metres(entrance, sourcePoint), mergeGapM = metres(merge, mergePoint);
        if (sourceGapM > 25 || mergeGapM > 25)
            throw Error('OSM-Verbindung zu weit entfernt: ' + ramp.id);
        // A motorway's OPPOSITE carriageway can share a junction node. Geographic
        // coincidence is insufficient: both approaches must have compatible travel
        // headings, or a ramp would silently attach to the wrong direction.
        const beginning = unitVector(path.points[0], path.points[1]);
        const feeder = routeTangent(source, start);
        const ending = unitVector(path.points.at(-2), path.points.at(-1));
        const receiver = routeTangent(target, end);
        if (dot(beginning, feeder) < 0.15 || dot(ending, receiver) < 0.15)
            throw Error('AD-Rampe widerspricht der angegebenen Fahrtrichtung: ' + ramp.id);
        connections.push({ rampId: ramp.id, from: ramp.from, to: ramp.to, rampEntryM: start, downstreamMergeM: end, sourceGapM, mergeGapM });
    }
    if (connections.length !== 4 || new Set(connections.map(c => c.rampId)).size !== 4)
        throw Error('Vier unterschiedliche AD-Rampen erforderlich');
    return connections;
}
function unitVector(a, b) {
    const dx = (b[1] - a[1]) * Math.cos((a[0] + b[0]) / 2 * Math.PI / 180), dy = b[0] - a[0], n = Math.hypot(dx, dy);
    return n > 0 ? [dx / n, dy / n] : [0, 0];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
function routeTangent(route, m) {
    const before = Math.max(0, m - 8), after = Math.min(route.lengthM, m + 8);
    if (after - before < .1)
        return [0, 0];
    return unitVector(pointAt(route, before), pointAt(route, after));
}
function pointAt(route, m) {
    const d = Math.max(0, Math.min(route.lengthM, m));
    let lo = 0, hi = route.metres.length - 1;
    while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (route.metres[mid] < d)
            lo = mid;
        else
            hi = mid;
    }
    const a = route.points[lo], b = route.points[hi], length = route.metres[hi] - route.metres[lo];
    const t = length ? (d - route.metres[lo]) / length : 0;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
/** Queue vehicles are counted ONLY in the ramp jam. The source motorway
 * overlay is a *location* of overflowing ramp vehicles, not another queue.
 * One exit lane at 95 veh/km is the declared simplifying storage assumption.
 */
export function rampSpillbacks(jams, connections, routes) {
    const output = [];
    for (const connection of connections) {
        const route = routes[connection.from];
        // Serial incidents on the same ramp cannot each claim the same upstream
        // motorway queue. Use the largest overflow and one owner per ramp.
        const candidate = jams.filter(j => j.pathKey === connection.rampId && j.outOfBoundsM > 1 && j.queueVehicles > 0)
            .sort((a, b) => b.outOfBoundsM - a.outOfBoundsM || a.id.localeCompare(b.id))[0];
        if (!candidate)
            continue;
        // The portion of the ramp queue exceeding its physical pre-event storage.
        // This is a relocation of already counted vehicles, never new arrivals.
        const overflowVeh = candidate.queueM > 0 ? candidate.queueVehicles * candidate.outOfBoundsM / candidate.queueM : 0;
        const backLengthM = overflowVeh / 95 * 1000; // 1 upstream exit lane (assumption)
        if (backLengthM <= 1)
            continue;
        const fromM = Math.max(0, connection.rampEntryM - backLengthM);
        output.push({ id: candidate.id, rampId: connection.rampId, source: connection.from, target: connection.to,
            sourceAnchorM: connection.rampEntryM, fromM, toM: connection.rampEntryM, lengthM: connection.rampEntryM - fromM,
            queuedVehiclesOnMotorway: overflowVeh, excessBeyondMapM: Math.max(0, backLengthM - connection.rampEntryM),
            color: candidate.color, delayMin: candidate.delayMin });
    }
    return output.sort((a, b) => a.source.localeCompare(b.source) || a.rampId.localeCompare(b.rampId));
}
export function mergeBackflows(jams, connections, routes, demands) {
    const output = [];
    for (const link of connections) {
        const incoming = demands[link.rampId];
        if (!Number.isFinite(incoming) || incoming <= 0)
            continue;
        const inbound = connections.filter(c => c.to === link.to);
        const targetDemand = demands[link.to];
        const total = targetDemand + inbound.reduce((n, c) => n + (demands[c.rampId] || 0), 0);
        if (!Number.isFinite(total) || total <= 0)
            continue;
        const share = Math.min(.8, incoming / total);
        const targetRoute = routes[link.to], rampRoute = routes[link.rampId];
        if (!targetRoute || !rampRoute)
            throw Error('Fehlende OSM-Verbindung bei Zielstau');
        // Only queues from bottlenecks *downstream* of this merge can block it.
        // The jam must reach the merge (queue head advances against travel direction).
        const affected = jams.filter(j => j.pathKey === link.to && j.anchorM > link.downstreamMergeM + .1
            && j.anchorM - j.queueM < link.downstreamMergeM - .1);
        if (!affected.length)
            continue;
        // Serial incidents cannot each claim the same ramp storage. One strongest
        // crossing tail acts as the parent of this visible backed-up ramp.
        const candidate = [...affected].sort((a, b) => (b.queueM - (b.anchorM - link.downstreamMergeM)) - (a.queueM - (a.anchorM - link.downstreamMergeM))
            || a.id.localeCompare(b.id))[0];
        const penetration = Math.max(0, candidate.queueM - (candidate.anchorM - link.downstreamMergeM));
        // Reference 95 veh/km/lane. Junction allocation is a declared approximation.
        const lanes = Math.max(1, Math.round(targetRoute.key.startsWith('A3') ? 3 : 2));
        const rampQueueM = penetration * lanes * share;
        const rampLengthM = Math.min(rampQueueM, rampRoute.lengthM);
        const sourceExcess = Math.max(0, rampQueueM - rampRoute.lengthM);
        const upstream = routes[link.from];
        const sourceFromM = Math.max(0, link.rampEntryM - sourceExcess);
        if (rampLengthM < 1 && link.rampEntryM - sourceFromM < 1)
            continue;
        output.push({ id: candidate.id, rampId: link.rampId, source: link.from, target: link.to,
            rampFromM: rampRoute.lengthM - rampLengthM, rampToM: rampRoute.lengthM, rampLengthM,
            sourceFromM, sourceToM: link.rampEntryM, sourceLengthM: link.rampEntryM - sourceFromM,
            fraction: share, delayMin: candidate.delayMin, color: candidate.color });
    }
    return output.sort((a, b) => a.rampId.localeCompare(b.rampId));
}
