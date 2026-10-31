import { normalThroughLanes } from './lane-info.js?build=9296d788994cefba';
/** Georeferenced, per-event queue model on the exact OSM motorway carriageway curves.
 * A first-pass conservation model (not a calibrated traffic forecast).
 * No vehicle sprites, hidden road connectors, A3/A48 transfers, or invented detours.
 */
import { buildContinuousRoads } from './cartography.js?build=9296d788994cefba';
import { exitPosition } from './core.js?build=9296d788994cefba';
import { PATHS, baselineCapacity, eventCapacity, defaultDemand } from './traffic.js?build=9296d788994cefba';
import { baseLaneCapacity, colorAtSpeed, queueFundamentalDiagram, freeSpeedKmh } from './traffic-physics.js?build=9296d788994cefba';
import { physicalEvents, accessibleExits } from './road-controls.js?build=9296d788994cefba';
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
        const route = corridor(key, points);
        if (!key.startsWith('ramp-')) {
            const positions = new Map(route.points.map((p, i) => [p.join(','), route.metres[i]]));
            route.normalLanes = roads.filter(r => r.road === key).map(r => {
                const a = positions.get(r.points[0].join(',')), b = positions.get(r.points.at(-1).join(','));
                return { fromM: Math.min(a, b), toM: Math.max(a, b), lanes: normalThroughLanes(r) };
            }).sort((a, b) => a.fromM - b.fromM);
        }
        result.set(key, route);
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
/** A formal closure is a ban on NEW entry at the final regular exit,
 * not an obstacle at the user's marker. Traffic already past this gate
 * remains on the road and flows out; physical all-lane accidents still
 * block their actual position. Exit snap uses the audited OSM geometry.
 * If there is no upstream local exit in the map, deny new traffic at
 * the network boundary rather than allowing it through the closure.
 */
export function closureGate(route, event, exits, events = []) {
    if (event.kind !== 'closure' || event.pathKey !== route.key || route.key.startsWith('ramp-'))
        return null;
    const at = positionM(route, event.point);
    if (at === null)
        return null;
    const road = route.key.startsWith('A3') ? 'A3' : 'A48';
    const junctions = exits.filter(x => x.road === road && (!x.directional || !!x.directional[route.key]))
        .map(exit => {
        const position = exitPosition(exit, route.key);
        return { exit: { ...exit, position }, metre: positionM(route, position, 900) };
    })
        .filter((x) => x.metre !== null).sort((a, b) => a.metre - b.metre);
    // A marker on or immediately after an off-ramp belongs to that AS.
    // The former 50m exclusion incorrectly moved the gate to the previous AS.
    const allowed = new Set(accessibleExits(route, events, exits, 'exit').map(e => e.road + ':' + e.ref));
    const closest = junctions.filter(j => !/^(AD |AK )/.test(j.exit.name) && allowed.has(j.exit.road + ':' + j.exit.ref) && j.metre <= at + 1).at(-1);
    const physicalEnd = Math.min(route.lengthM, at + event.settings.lengthM);
    const end = junctions.find(j => j.metre > at + 1 && j.metre >= physicalEnd - 1);
    return { metre: closest?.metre ?? 0, exit: closest?.exit ?? null, eventM: at,
        endM: end?.metre ?? route.lengthM, endExit: end?.exit ?? null };
}
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
 * Retain baseline demand entitlement when arrivals drop. Already waiting
 * vehicles may also use spare ramp service instead of having their outflow
 * capped forever at the new-arrival rate. Actual passing still cannot
 * exceed stored vehicles plus arrivals or the physical ramp capacity.
 */
export function mergeSupplyVph(ramp, targetCapacityVph, targetDemandVph, rampDemandVph, queuedVehicles = 0) {
    if (!Number.isFinite(queuedVehicles) || queuedVehicles < 0)
        throw Error('Ungültiger Rampenrückstau');
    if (targetCapacityVph <= 0)
        return 0;
    const supplyRatio = Math.min(1, targetCapacityVph / Math.max(targetCapacityVph, targetDemandVph));
    const requested = Math.min(baselineCapacity(ramp), Math.max(defaultDemand(ramp), rampDemandVph + queuedVehicles * 60));
    return Math.min(baselineCapacity(ramp), Math.round(requested * supplyRatio));
}
export function advanceSpatial(prev, events, demands, minutes, corridors, links = [], transfers = [], exits = [], physicalMainline) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60)
        throw Error('Ungültiger Simulations-Zeitschritt');
    const current = {};
    for (const [id, q] of Object.entries(prev.queues))
        if (q.vehicles > 1e-6)
            current[id] = { ...q };
    // Each minute calculates junction supply from the ACTUAL queued vehicles.
    for (let tick = 0; tick < minutes; tick++) {
        const raw = links.length ? jamsAt({ minute: prev.minute + tick, queues: current }, events, corridors) : [];
        const existing = physicalMainline === undefined ? raw : [...raw.filter(j => j.pathKey.startsWith('ramp-')), ...physicalMainline];
        for (const key of PATHS) {
            const volume = demands[key];
            if (!Number.isFinite(volume) || volume < 0 || volume > 8000)
                throw Error('Ungültiger Zufluss');
            const route = corridors[key];
            const nodes = [];
            for (const e of physicalEvents(route, events))
                if (e.pathKey === key) {
                    const place = positionM(route, e.point);
                    if (place === null)
                        continue;
                    const gate = exits.length ? closureGate(route, e, exits, events) : null;
                    const nodeM = gate ? gate.metre : place;
                    const nodePoint = gate ? (routeSlice(route, Math.max(0, nodeM - 1), Math.min(route.lengthM, nodeM + 1))[0] ?? route.points[0]) : e.point;
                    nodes.push({ id: e.id, event: e, place: nodeM, point: nodePoint });
                }
            // If a downstream jam reaches a REAL motorway merge, incoming ramp traffic
            // becomes a queue at that ramp. It is no longer an uncounted red overlay.
            for (const link of links)
                if (link.rampId === key) {
                    const closedMerge = events.some(event => {
                        const gate = closureGate(corridors[link.to], event, exits, events);
                        return gate && link.downstreamMergeM >= gate.metre - 1 && link.downstreamMergeM < gate.endM - 1;
                    });
                    if (closedMerge) {
                        nodes.push({ id: 'closed-merge:' + key, event: null, place: Math.max(0, route.lengthM - .5),
                            point: route.points.at(-1), limitVph: 0 });
                    }
                    const blocked = existing.filter(j => j.pathKey === link.to && j.anchorM > link.downstreamMergeM + .1
                        && j.anchorM - j.queueM < link.downstreamMergeM - .1);
                    if (blocked.length) {
                        // A dark-red queue is not a closed merge: calculate actual downstream supply.
                        const targetCapacity = Math.min(...blocked.map(j => j.capacityVph));
                        const cap = mergeSupplyVph(key, targetCapacity, demands[link.to], volume, current['merge:' + key]?.vehicles ?? 0);
                        nodes.push({ id: 'merge:' + key, event: null, place: Math.max(0, route.lengthM - .5),
                            point: route.points.at(-1), limitVph: cap });
                    }
                }
            // Connected, validated OSM detours are inserted at the physical junction
            // positions. Leaving vehicles are removed ONCE, rejoined vehicles added
            // ONCE downstream of the event; no shared motorway inflow subtraction.
            for (const transfer of transfers)
                if (transfer.path === key) {
                    // A different motorway may join this route exactly at metre zero
                    // (the A48 Koblenz merge). That is a pure entry, not a reversed detour.
                    const boundaryEntry = transfer.fromM === 0 && transfer.toM === 0 && transfer.leaveVpm === 0;
                    if (!(transfer.fromM >= 0 && transfer.toM <= route.lengthM && (transfer.toM > transfer.fromM || boundaryEntry)
                        && transfer.leaveVpm >= 0 && transfer.joinVpm >= 0))
                        throw Error('Umleitungs-Anschlussposition oder Fahrzeugstrom ungültig');
                    const from = routeSlice(route, Math.max(0, transfer.fromM - 2), transfer.fromM)[0] ?? route.points[0];
                    const to = routeSlice(route, transfer.toM, Math.min(route.lengthM, transfer.toM + 2))[0] ?? route.points.at(-1);
                    nodes.push({ id: 'divert-out:' + transfer.id, event: null, place: transfer.fromM,
                        point: from, leavingVpm: transfer.leaveVpm });
                    nodes.push({ id: 'divert-in:' + transfer.id, event: null, place: transfer.toM,
                        point: to, joiningVpm: transfer.joinVpm, limitVph: baselineCapacity(key) });
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
            // Exactly at the mandatory exit, accepted vehicles must leave before
            // the administrative no-entry gate rejects all remaining vehicles.
            const rank = (n) => n.leavingVpm !== undefined ? 0 : n.event?.kind === 'closure' ? 1 : 2;
            nodes.sort((a, b) => a.place - b.place || rank(a) - rank(b) || a.id.localeCompare(b.id));
            // FIFO mass conservation at each serial bottleneck. Downstream gets only upstream discharge.
            let entering = Math.min(volume / 60, baselineCapacity(key) / 60);
            for (const node of nodes) {
                // At a real mapped off-ramp cars exit the motorway only if they are
                // accepted by the detour. Never generate a fictitious local-road queue
                // by subtracting an intended percentage instead of actual admissions.
                if (node.leavingVpm !== undefined) {
                    entering = Math.max(0, entering - node.leavingVpm);
                    continue;
                }
                if (node.joiningVpm !== undefined)
                    entering += node.joiningVpm;
                const stored = current[node.id]?.vehicles ?? 0;
                const previous = current[node.id];
                const fullCapacityVph = node.limitVph ?? (node.event ? eventCapacity(node.event, volume) : baselineCapacity(key));
                // Reopening from a total blockage does not instantly achieve the stable
                // throughput of two reopened lanes. Vehicles restart/reorganise, so
                // release capacity ramps from 70% to 100% over six model minutes.
                // Applied only when the SAME real event transitions from 0 to >0 flow,
                // not repeatedly during steady-flow operations or for unrelated ramps.
                const startsRecovery = node.event !== null && fullCapacityVph > 0 &&
                    previous !== undefined && (previous.capacityVph ?? baselineCapacity(key)) <= 0;
                const recoveryTick = startsRecovery ? 0 : previous?.recoveryTick !== undefined && previous.recoveryTick < 6
                    ? previous.recoveryTick + 1 : undefined;
                const recoveryFactor = recoveryTick === undefined ? 1 : .70 + .30 * Math.min(1, recoveryTick / 6);
                const cap = fullCapacityVph * recoveryFactor / 60;
                const available = stored + entering, passing = Math.min(available, cap), waiting = Math.max(0, available - passing);
                if (waiting > 1e-6) {
                    const lanes = node.event?.laneCount ?? previous?.lanes ?? Math.round(baselineCapacity(key) / baseLaneCapacity(key));
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
                    // The history is a bounded *speed signal*, never a second vehicle ledger.
                    // New restrictions propagate to upstream positions with finite wave speed.
                    const speedHistory = [...(previous?.speedHistory ?? [])];
                    speedHistory.push({ minute: prev.minute + tick + 1, speedKmh });
                    if (speedHistory.length > 480)
                        speedHistory.splice(0, speedHistory.length - 480);
                    current[node.id] = { pathKey: key, point: node.point, vehicles: waiting, lanes, capacityVph: cap * 60,
                        active: node.event !== null || node.limitVph !== undefined, densityVehPerKm, color, pendingColor, pendingTicks, speedHistory, recoveryTick };
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
        // Use the discharge of the last simulated minute, not the newly edited
        // settings before any simulation tick has passed. This avoids repainting
        // an entire existing queue the instant a limit is edited in the UI.
        const capacity = q.capacityVph ?? (e ? eventCapacity(e) : baselineCapacity(q.pathKey));
        const lanes = Math.max(1, q.lanes);
        const condition = queueCondition(q.vehicles, capacity, lanes, q.pathKey);
        const densityVehPerKm = q.densityVehPerKm ?? condition.densityVehPerKm;
        // Densities are persistent state; queue length and speed evolve together.
        const queueM = q.vehicles / densityVehPerKm * 1000, visibleQueueM = Math.min(queueM, anchor);
        // FIFO queue / actual throughput. Zero throughput gives no finite
        // future travel time and MUST NOT turn into "time since road closure".
        // Mainline UI computes its travel-time loss from local CTM cell speeds.
        const wait = capacity > 0 ? q.vehicles / capacity * 60 : null;
        const speedKmh = capacity === 0 ? 0 : Math.min(freeSpeedKmh(q.pathKey), capacity / densityVehPerKm);
        const color = q.color ?? colorAtSpeed(speedKmh);
        result.push({ id, pathKey: q.pathKey, eventKind: e?.kind ?? null, point: q.point, anchorM: anchor,
            queueVehicles: q.vehicles, queueM, visibleQueueM, delayMin: wait, capacityVph: capacity, speedKmh, color, released: !e && !q.active, outOfBoundsM: Math.max(0, queueM - anchor), speedHistory: q.speedHistory });
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
