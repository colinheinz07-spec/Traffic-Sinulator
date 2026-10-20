/** Georeferenced, per-event queue model on the exact OSM motorway carriageway curves.
 * A first-pass conservation model (not a calibrated traffic forecast).
 * No vehicle sprites, hidden road connectors, A3/A48 transfers, or invented detours.
 */
import { buildContinuousRoads } from './cartography.js';
import { PATHS, baselineCapacity, eventCapacity, defaultDemand } from './traffic.js';
import { colorAtSpeed, queueFundamentalDiagram, freeSpeedKmh } from './traffic-physics.js';
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
/** Color is based ONLY on calculated km/h; density comes from the same
 * triangular-flow approximation used for the physical queue footprint.
 * It does not invent a color based on queue length or elapsed time.
 */
export function queueCondition(vehicles, capacityVph, lanes, path) {
    const { speedKmh, densityVehPerKm } = queueFundamentalDiagram(capacityVph, lanes, path);
    return { color: vehicles > 0 ? colorAtSpeed(speedKmh) : 'free', speedKmh, densityVehPerKm };
}
/** Positive downstream capacity always leaves a positive merge service share.
 * Demand ratios are scenario assumptions, not a calibrated junction solver.
 * Retain baseline demand entitlement when arrivals drop, so old queues drain.
 */
export function mergeSupplyVph(ramp, targetCapacityVph, targetDemandVph, rampDemandVph) {
    if (targetCapacityVph <= 0)
        return 0;
    const supplyRatio = Math.min(1, targetCapacityVph / Math.max(targetCapacityVph, targetDemandVph));
    return Math.min(baselineCapacity(ramp), Math.round(Math.max(defaultDemand(ramp), rampDemandVph) * supplyRatio));
}
export function advanceSpatial(prev, events, demands, minutes, corridors, links = []) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60)
        throw Error('Ungültiger Simulations-Zeitschritt');
    const current = {};
    for (const [id, q] of Object.entries(prev.queues))
        if (q.vehicles > 1e-6)
            current[id] = { ...q };
    // Each minute calculates junction supply from the ACTUAL queued vehicles.
    for (let tick = 0; tick < minutes; tick++) {
        const existing = links.length ? jamsAt({ minute: prev.minute + tick, queues: current }, events, corridors) : [];
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
            // If a downstream jam reaches a REAL motorway merge, incoming ramp traffic
            // becomes a queue at that ramp. It is no longer an uncounted red overlay.
            for (const link of links)
                if (link.rampId === key) {
                    const blocked = existing.filter(j => j.pathKey === link.to && j.anchorM > link.downstreamMergeM + .1
                        && j.anchorM - j.queueM < link.downstreamMergeM - .1);
                    if (blocked.length) {
                        // A dark-red queue is not a closed merge: calculate actual downstream supply.
                        const targetCapacity = Math.min(...blocked.map(j => j.capacityVph));
                        const cap = mergeSupplyVph(key, targetCapacity, demands[link.to], volume);
                        nodes.push({ id: 'merge:' + key, event: null, place: Math.max(0, route.lengthM - .5),
                            point: route.points.at(-1), limitVph: cap });
                    }
                }
            // An overflow from a ramp occupies the exit lane ONLY. Its vehicles are
            // ALREADY owned by the ramp queue and rampSpillbacks() plots their location.
            // Applying another bottleneck to the ENTIRE mainline would invent a second
            // queue of through-traffic and cause self-amplifying delays. Mainline lane
            // obstructions need an actual event until a turn-by-turn solver is available.
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
                const cap = (node.limitVph ?? (node.event ? eventCapacity(node.event) : baselineCapacity(key))) / 60;
                const available = stored + entering, passing = Math.min(available, cap), waiting = Math.max(0, available - passing);
                if (waiting > 1e-6) {
                    const previous = current[node.id];
                    const lanes = node.event?.laneCount ?? previous?.lanes ?? (key.startsWith('ramp-') ? 1 : Math.round(baselineCapacity(key) / 1800));
                    const target = queueCondition(waiting, cap * 60, lanes, key);
                    // A queue does not instantaneously decompress along kilometres of road
                    // when a worksite reopens. Relax its density only as stored vehicles drain.
                    // This prevents the classic false visual increase in queue length even
                    // though the total number of waiting cars is already falling.
                    const oldDensity = previous?.densityVehPerKm ?? queueCondition(previous?.vehicles ?? 0, previous?.capacityVph ?? cap * 60, lanes, key).densityVehPerKm;
                    const fractionRemaining = previous && previous.vehicles > 0 ?
                        Math.max(0, Math.min(1, waiting / previous.vehicles)) : 1;
                    const densityVehPerKm = previous && target.densityVehPerKm < oldDensity
                        ? Math.max(target.densityVehPerKm, oldDensity * (.5 + .5 * fractionRemaining))
                        : target.densityVehPerKm;
                    const speedKmh = cap === 0 ? 0 : Math.min(freeSpeedKmh(key), cap * 60 / densityVehPerKm);
                    const desired = colorAtSpeed(speedKmh);
                    let color = desired, pendingColor, pendingTicks;
                    // Two consecutive minutes for a color transition; real blockage is immediate.
                    if (cap > 0 && previous?.color && previous.color !== desired) {
                        const ticks = (previous.pendingColor === desired ? (previous.pendingTicks ?? 0) : 0) + 1;
                        if (ticks < 2) {
                            color = previous.color;
                            pendingColor = desired;
                            pendingTicks = ticks;
                        }
                    }
                    current[node.id] = { pathKey: key, point: node.point, vehicles: waiting, lanes, capacityVph: cap * 60,
                        active: node.event !== null || node.limitVph !== undefined, densityVehPerKm, color, pendingColor, pendingTicks };
                }
                else
                    delete current[node.id];
                entering = passing;
            }
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
        const capacity = e ? eventCapacity(e) : (q.capacityVph ?? baselineCapacity(q.pathKey));
        const lanes = Math.max(1, q.lanes);
        const condition = queueCondition(q.vehicles, capacity, lanes, q.pathKey);
        const densityVehPerKm = q.densityVehPerKm ?? condition.densityVehPerKm;
        // Densities are persistent state; queue length and speed evolve together.
        const queueM = q.vehicles / densityVehPerKm * 1000, visibleQueueM = Math.min(queueM, anchor);
        // Little's law: queue vehicles / bottleneck throughput, independent of
        // elapsed simulation time. A true zero-throughput closure is indeterminate.
        const wait = capacity === 0 ? null : q.vehicles / capacity * 60;
        const speedKmh = capacity === 0 ? 0 : Math.min(freeSpeedKmh(q.pathKey), capacity / densityVehPerKm);
        const color = q.color ?? colorAtSpeed(speedKmh);
        result.push({ id, pathKey: q.pathKey, eventKind: e?.kind ?? null, point: q.point, anchorM: anchor,
            queueVehicles: q.vehicles, queueM, visibleQueueM, delayMin: wait, capacityVph: capacity, speedKmh, color, released: !e && !q.active, outOfBoundsM: Math.max(0, queueM - anchor) });
    }
    return result.sort((a, b) => a.pathKey.localeCompare(b.pathKey) || a.anchorM - b.anchorM);
}
/** Dark red marks either a full stop or very slow discharge (<=10 km/h). */
/** Uniform actual queue state: no automatic fictional orange/red fractions.
 * Future segment-based densities and speeds can provide multiple true bands.
 */
export function jamBands(jam) {
    const fromM = Math.max(0, jam.anchorM - jam.queueM), toM = jam.anchorM;
    return toM - fromM < .5 ? [] : [{ fromM, toM, color: jam.color === 'free' ? 'slow' : jam.color }];
}
