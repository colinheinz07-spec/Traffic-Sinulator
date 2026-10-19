/** Georeferenced, per-event queue model on the exact OSM motorway carriageway curves.
 * A first-pass conservation model (not a calibrated traffic forecast).
 * No vehicle sprites, hidden road connectors, A3/A48 transfers, or invented detours.
 */
import { buildContinuousRoads } from './cartography.js';
import { PATHS, baselineCapacity, eventCapacity } from './traffic.js';
const rad = Math.PI / 180;
export function metres(a, b) {
    const dx = (b[1] - a[1]) * 111195 * Math.cos((a[0] + b[0]) / 2 * rad);
    const dy = (b[0] - a[0]) * 111195;
    return Math.hypot(dx, dy);
}
function corridor(key, points) {
    if (points.length < 2)
        throw Error('Unvollständige OSM-Kurve: ' + key);
    const cumulative = [0];
    for (let i = 1; i < points.length; i++)
        cumulative.push(cumulative[i - 1] + metres(points[i - 1], points[i]));
    return { key, points: [...points], metres: cumulative, lengthM: cumulative.at(-1) };
}
export function makeCorridors(roads, ramps) {
    const chains = buildContinuousRoads(roads), result = new Map();
    for (const key of PATHS) {
        const source = key.startsWith('ramp-') ? ramps.filter(x => x.id === key).map(x => x.points) : chains.filter(x => x.road === key).map(x => x.points);
        if (source.length !== 1)
            throw Error(`Keine eindeutige durchgehende OSM-Fahrbahn für ${key}: ${source.length}`);
        const points = [...source[0]];
        if (!key.startsWith('ramp-')) {
            const headingEast = key === 'A3-frankfurt' || key === 'A48-dernbach';
            if ((points.at(-1)[1] > points[0][1]) !== headingEast)
                points.reverse();
        }
        result.set(key, corridor(key, points));
    }
    return Object.fromEntries(result);
}
/** Snap a selected point to a specific *directional* motorway centreline. */
export function positionM(route, p, maxOffsetM = 80) {
    let best = Infinity, where = 0;
    const xScale = 111195 * Math.cos(p[0] * rad), yScale = 111195;
    for (let i = 1; i < route.points.length; i++) {
        const a = route.points[i - 1], b = route.points[i];
        const x = (b[1] - a[1]) * xScale, y = (b[0] - a[0]) * yScale;
        const ux = (p[1] - a[1]) * xScale, uy = (p[0] - a[0]) * yScale;
        const d = x * x + y * y, t = d ? Math.max(0, Math.min(1, (ux * x + uy * y) / d)) : 0;
        const error = Math.hypot(ux - t * x, uy - t * y);
        if (error < best) {
            best = error;
            where = route.metres[i - 1] + (route.metres[i] - route.metres[i - 1]) * t;
        }
    }
    return best <= maxOffsetM ? where : null;
}
/** Piece of actual OSM centreline, limited to [fromM,toM] along traffic direction. */
export function routeSlice(route, fromM, toM) {
    const a = Math.max(0, Math.min(route.lengthM, fromM));
    const b = Math.max(a, Math.min(route.lengthM, toM));
    if (b - a < .25)
        return [];
    const interpolate = (m) => {
        let lo = 0, hi = route.metres.length - 1;
        while (lo + 1 < hi) {
            const mid = (lo + hi) >> 1;
            if (route.metres[mid] < m)
                lo = mid;
            else
                hi = mid;
        }
        const d = route.metres[hi] - route.metres[lo], t = d ? Math.max(0, Math.min(1, (m - route.metres[lo]) / d)) : 0;
        const x = route.points[lo], y = route.points[hi];
        return [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t];
    };
    const points = [interpolate(a)];
    for (let i = 1; i < route.metres.length - 1; i++)
        if (route.metres[i] > a && route.metres[i] < b)
            points.push(route.points[i]);
    points.push(interpolate(b));
    return points;
}
export function emptySpatial() { return { minute: 0, queues: {} }; }
export function advanceSpatial(prev, events, demands, minutes, corridors) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60)
        throw Error('Ungültiger Simulations-Zeitschritt');
    const current = {};
    for (const [id, q] of Object.entries(prev.queues))
        if (q.vehicles > 1e-6)
            current[id] = { ...q };
    for (let tick = 0; tick < minutes; tick++)
        for (const key of PATHS) {
            const volume = demands[key];
            if (!Number.isFinite(volume) || volume < 0 || volume > 8000)
                throw Error('Ungültiger Zufluss');
            const route = corridors[key];
            const nodes = [];
            for (const e of events)
                if (e.pathKey === key) {
                    const place = positionM(route, e.point);
                    if (place === null)
                        continue;
                    nodes.push({ id: e.id, event: e, place, point: e.point });
                }
            const active = new Set(nodes.map(n => n.id));
            for (const [id, q] of Object.entries(current))
                if (q.pathKey === key && !active.has(id)) {
                    const place = positionM(route, q.point);
                    if (place !== null)
                        nodes.push({ id, event: null, place, point: q.point });
                }
            nodes.sort((a, b) => a.place - b.place || a.id.localeCompare(b.id));
            // FIFO mass conservation at each serial bottleneck. Downstream gets only upstream discharge.
            let entering = Math.min(volume / 60, baselineCapacity(key) / 60);
            for (const node of nodes) {
                const stored = current[node.id]?.vehicles ?? 0;
                const cap = (node.event ? eventCapacity(node.event) : baselineCapacity(key)) / 60;
                const available = stored + entering, passing = Math.min(available, cap), waiting = Math.max(0, available - passing);
                if (waiting > 1e-6)
                    current[node.id] = { pathKey: key, point: node.point, vehicles: waiting, lanes: node.event?.laneCount ?? current[node.id]?.lanes ?? (key.startsWith('ramp-') ? 1 : Math.round(baselineCapacity(key) / 1800)) };
                else
                    delete current[node.id];
                entering = passing;
            }
        }
    return { minute: prev.minute + minutes, queues: current };
}
/** One individually measurable bottleneck queue per event (or residual queue after clearing). */
export function jamsAt(state, events, corridors) {
    const current = new Map(events.map(x => [x.id, x]));
    const result = [];
    for (const [id, q] of Object.entries(state.queues)) {
        const e = current.get(id) ?? null;
        const route = corridors[q.pathKey], anchor = positionM(route, q.point);
        if (anchor === null || q.vehicles < .01)
            continue;
        const capacity = e ? eventCapacity(e) : baselineCapacity(q.pathKey);
        const lanes = Math.max(1, q.lanes);
        // Illustrative storage: 95 queued vehicles per kilometre of approach lane.
        const queueM = q.vehicles / (95 * lanes) * 1000, visibleQueueM = Math.min(queueM, anchor);
        const wait = capacity === 0 ? null : q.vehicles / capacity * 60;
        const color = capacity === 0 ? 'standstill' : queueM >= 750 || (wait !== null && wait >= 5) ? 'jam' : 'slow';
        result.push({ id, pathKey: q.pathKey, eventKind: e?.kind ?? null, point: q.point, anchorM: anchor,
            queueVehicles: q.vehicles, queueM, visibleQueueM, delayMin: wait, capacityVph: capacity, color, released: !e, outOfBoundsM: Math.max(0, queueM - anchor) });
    }
    return result.sort((a, b) => a.pathKey.localeCompare(b.pathKey) || a.anchorM - b.anchorM);
}
/** Green is the uninterrupted base, orange is tail, red is stop/go, dark red is stopped at closure. */
export function jamBands(jam) {
    const start = Math.max(0, jam.anchorM - jam.queueM), end = jam.anchorM, length = end - start;
    if (length < .5)
        return [];
    const tail = Math.min(length, Math.max(50, length * .24));
    const stop = jam.color === 'standstill' ? Math.min(length - tail, Math.max(30, length * .18)) : 0;
    const a = Math.min(end, start + tail), b = Math.max(a, end - stop);
    const bands = [];
    if (a > start)
        bands.push({ fromM: start, toM: a, color: 'slow' });
    if (b > a)
        bands.push({ fromM: a, toM: b, color: 'jam' });
    if (end > b)
        bands.push({ fromM: b, toM: end, color: 'standstill' });
    return bands;
}
