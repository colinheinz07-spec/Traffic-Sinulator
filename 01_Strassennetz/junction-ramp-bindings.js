/** 01_Strassennetz: Zugeordnetes Fachmodul junction-ramp-bindings. */
/** Local ramps render the SAME vehicles held by the junction solver.
 * A downstream incident alone never creates a second ramp inventory. */
import { networkData } from '../geodata.js?build=f706910bd9663983';
import { extensionRoutes, extensionRampBoundaryPoints } from '../network-extensions.js?build=f706910bd9663983';
import { exitPosition, nearestPolyline } from '../core.js?build=f706910bd9663983';
import { networkRoad } from '../network-road.js?build=f706910bd9663983';
import { eventCapacity } from '../traffic.js?build=f706910bd9663983';
import { queueFundamentalDiagram, colorAtSpeed } from '../traffic-physics.js?build=f706910bd9663983';
const pointKey = (p) => p.join(',');
const distance = (a, b) => Math.hypot((b[0] - a[0]) * 111195, (b[1] - a[1]) * 111195 * Math.cos((a[0] + b[0]) * Math.PI / 360));
const rampLength = (r) => r.points.slice(1).reduce((n, p, i) => n + distance(r.points[i], p), 0);
let topology;
function rampTopology() {
    if (topology)
        return topology;
    const trunks = new Set([...networkData.roads.flatMap(r => r.points),
        ...extensionRoutes.filter(r => r.kind === 'motorway').flatMap(r => r.points)].map(pointKey));
    const ramps = extensionRoutes.filter(r => r.kind === 'ramp'), forward = new Map(), backward = new Map();
    for (const r of ramps) {
        const first = pointKey(r.points[0]), last = pointKey(r.points.at(-1));
        forward.set(first, [...(forward.get(first) ?? []), r]);
        backward.set(last, [...(backward.get(last) ?? []), r]);
    }
    topology = { trunks, boundaries: new Set(extensionRampBoundaryPoints.map(pointKey)), ramps, forward, backward };
    return topology;
}
const bindingCache = new WeakMap();
export function junctionRampBindings(route, exits) {
    const cached = bindingCache.get(route);
    if (cached)
        return cached;
    const road = networkRoad(route.key), result = [];
    if (!road) {
        bindingCache.set(route, result);
        return result;
    }
    const { trunks, boundaries, ramps, forward, backward } = rampTopology(), vertices = new Set(route.points.map(pointKey));
    const anchors = exits.filter(j => j.road === road && !/^(AD |AK )/.test(j.name) && (!j.directional || j.directional[route.key]))
        .map(j => ({ j, point: exitPosition(j, route.key) }));
    for (const kind of ['entry', 'exit']) {
        const reverse = kind === 'entry', graph = reverse ? backward : forward;
        const at = (r, end) => r.points[(end !== reverse) ? r.points.length - 1 : 0];
        const seeds = ramps.filter(r => vertices.has(pointKey(at(r, false))));
        for (const seed of seeds) {
            // Der Generator benennt manche reale lokale Zufahrt am Rand eines AK/AD
            // nach dem benachbarten Autobahnknoten (z. B. A565 Bonn-Beuel-Nord).
            // Ein Knoten-LABEL allein beweist deshalb nicht, dass es sich um eine
            // reine Autobahn-Überleitung handelt. Nur wenn der Rampenanfang exakt
            // mit dem gerichteten, tatsächlich importierten OSM-AS-Anker
            // übereinstimmt, darf dieser Seed als lokale Rampe geprüft werden.
            // Das Ende muss wie bisher eine verifizierte lokale Straßenanbindung
            // erreichen – sonst erzeugt visit() keine lokale Rampenbindung.
            if (/^(AD |AK )/.test(seed.zone) && !anchors.some(a => a.j.directional?.[route.key]?.nodeId && pointKey(a.point) === pointKey(at(seed, false))
                && a.j.access?.[route.key]?.[kind] !== false))
                continue;
            const connection = at(seed, false), labelled = anchors.filter(a => seed.zone.startsWith(road + ' AS ' + a.j.ref + ' '));
            const junction = (labelled.length ? labelled : anchors).filter(a => a.j.access?.[route.key]?.[kind] !== false)
                .map(a => ({ ...a, d: distance(a.point, connection) })).sort((a, b) => a.d - b.d)[0];
            if (!junction || junction.d > (labelled.length ? 3500 : 1800))
                continue;
            const visit = (sequence) => {
                const last = sequence.at(-1), indices = last.points.map((_, i) => i);
                if (reverse)
                    indices.reverse();
                const boundaryIndex = indices.slice(1).find(i => boundaries.has(pointKey(last.points[i])) && !trunks.has(pointKey(last.points[i])));
                const end = pointKey(at(last, true));
                // Eine echte OSM-Rampe kann aus deutlich mehr als acht Wegen bestehen
                // (z. B. A4 Köln-Eifeltor mit 15–16 Teilstücken). Nicht nach der
                // Anzahl der OSM-Ways abbrechen, sondern nur bei unplausibler Länge.
                // Der Zyklenschutz steckt bereits in !sequence.includes(r).
                const tracedM = sequence.reduce((n, r) => n + rampLength(r), 0);
                if (tracedM > 6000 || boundaryIndex === undefined && trunks.has(end))
                    return;
                const following = (graph.get(end) ?? []).filter(r => !sequence.includes(r));
                if (boundaryIndex === undefined && following.length) {
                    for (const r of following)
                        visit([...sequence, r]);
                    return;
                }
                // Existing explicitly mapped AS approaches (e.g. Montabaur) may end at
                // the edge of an older OSM street snapshot. Keep those established
                // junction-traffic bindings instead of silently deleting real flows.
                // New, unlabeled motorway_link additions must reach a verified public
                // street; merely being near an AS is not proof of a local access.
                // As before, misleadingly labelled AK/AD turns need that proof too.
                if (boundaryIndex === undefined &&
                    (/^(AD |AK )/.test(seed.zone) || seed.id.startsWith('extra-osm-link-')))
                    return;
                const ordered = reverse ? [...sequence].reverse() : sequence;
                let lengthM = 0;
                const segments = ordered.map(ramp => {
                    let rampFromM = 0, length = rampLength(ramp);
                    if (ramp === last && boundaryIndex !== undefined) {
                        const before = ramp.points.slice(1, boundaryIndex + 1).reduce((n, p, i) => n + distance(ramp.points[i], p), 0);
                        if (reverse) {
                            rampFromM = before;
                            length -= before;
                        }
                        else
                            length = before;
                    }
                    const fromM = lengthM;
                    lengthM += length;
                    return { ramp, fromM, toM: lengthM, rampFromM };
                });
                if (lengthM < 1 || lengthM > 4000)
                    return;
                result.push({ path: route.key, ref: junction.j.ref, kind, segments, lengthM,
                    lanes: Math.max(1, Math.min(...ordered.map(r => r.lanes))), share: 0 });
            };
            visit([seed]);
        }
    }
    const unique = [...new Map(result.map(b => [b.kind + ':' + b.ref + ':' + b.segments.map(s => s.ramp.id).join('|'), b])).values()];
    for (const b of unique)
        b.share = b.lanes / unique.filter(x => x.kind === b.kind && x.ref === b.ref).reduce((n, x) => n + x.lanes, 0);
    bindingCache.set(route, unique);
    return unique;
}
function pointMetre(segment, point) {
    const scale = Math.cos(point[0] * Math.PI / 180), project = (p) => [p[1] * 111195 * scale, p[0] * 111195];
    return segment.fromM + nearestPolyline(segment.ramp.points, project(point), project).fraction * rampLength(segment.ramp) - segment.rampFromM;
}
function restriction(binding, events) {
    let capacity = binding.lanes * 1500, headM = binding.lengthM, closed = false;
    for (const segment of binding.segments)
        for (const event of events)
            if (event.pathKey === segment.ramp.id) {
                const at = pointMetre(segment, event.point);
                if (at < segment.fromM - .5 || at > segment.toM + .5)
                    continue;
                if (event.kind === 'closure') {
                    closed = true;
                    continue;
                }
                const limit = eventCapacity(event);
                if (limit < capacity) {
                    capacity = limit;
                    headM = at;
                }
            }
    return { capacity, headM, closed };
}
export function junctionRampAccess(route, exits, ref, events) {
    const bindings = junctionRampBindings(route, exits).filter(b => b.ref === ref);
    const open = (kind) => { const rows = bindings.filter(b => b.kind === kind); return !rows.length || rows.some(b => !restriction(b, events).closed); };
    return { entry: open('entry'), exit: open('exit') };
}
/** Geometry supplies short ramp storage. Signal service stays in the
 * existing junction profile; motorway incidents do not alter it remotely. */
export function applyJunctionRampLimits(route, exits, events, demands) {
    const bindings = junctionRampBindings(route, exits);
    return demands.map(d => {
        const entries = bindings.filter(b => b.ref === d.ref && b.kind === 'entry'), off = bindings.filter(b => b.ref === d.ref && b.kind === 'exit');
        const row = { ...d };
        if (entries.length) {
            // Montabaur's two access arms can spill into their shared local throat.
            // The first full entry arm determines when the feeder is obstructed.
            if (route.key.startsWith('A3-') && d.ref === '40')
                row.sharedFeederStorageVehicles = Math.max(1, Math.min(...entries.map(b => b.lengthM * b.lanes * 95 / 1000)));
            const limits = entries.map(b => restriction(b, events));
            row.entryCapacityVph = Math.min(row.entryCapacityVph, limits.reduce((n, c) => n + c.capacity, 0));
            if (limits.every(c => c.closed))
                row.entryVph = 0;
        }
        if (off.length) {
            const limits = off.map(b => restriction(b, events));
            const storage = new Map();
            off.forEach((b, i) => b.segments.forEach(s => {
                const length = Math.max(0, Math.min(s.toM, limits[i].headM) - s.fromM);
                storage.set(s.ramp.id, Math.max(storage.get(s.ramp.id) ?? 0, length * s.ramp.lanes * 95 / 1000));
            }));
            // Retain the established AS storage profiles. Geometry limits storage
            // only when an obstruction moves the queue head into the ramp itself.
            if (limits.some((c, i) => c.capacity < off[i].lanes * 1500))
                row.exitStorageVehicles = Math.min(row.exitStorageVehicles ?? 40, Math.max(1, [...storage.values()].reduce((n, v) => n + v, 0)));
            row.exitTerminalVph = Math.min(row.exitTerminalVph ?? 700, limits.reduce((n, c) => n + c.capacity, 0));
            if (limits.every(c => c.closed))
                row.exitPercent = 0;
        }
        return row;
    });
}
/** Pure view of conserved junction/return inventories: no mutation, no
 * demand inferred from an accident, and no queue when waiting is zero. */
export function junctionRampJams(cells, routes, exits, events, detours = []) {
    const output = [];
    for (const [path, state] of Object.entries(cells)) {
        for (const b of junctionRampBindings(routes[path], exits)) {
            const j = state.junctions?.find(j => j.ref === b.ref);
            if (!j)
                continue;
            const returns = b.kind === 'entry' ? detours.filter(e => !e.config.exitsNetwork && (e.config.targetPath ?? e.config.path) === path && Math.abs(e.config.toM - j.metre) < 250) : [];
            const stock = (b.kind === 'entry' ? j.waiting + returns.reduce((n, e) => n + e.state.waitingMerge, 0) :
                (j.exitQueue?.normal ?? 0) + Object.values(j.exitQueue?.detours ?? {}).reduce((n, v) => n + v, 0)) * b.share;
            // Fractional inventories remain in the solver; suppress sub-two-car map flicker.
            if (stock < 2)
                continue;
            const limit = restriction(b, events);
            const passed = (b.kind === 'entry' ? j.lastEntered + returns.reduce((n, e) => n + e.state.lastRejoined, 0) : j.lastExited) * 60 * b.share;
            const capacity = Math.min(passed, limit.capacity), condition = queueFundamentalDiagram(capacity, b.lanes, b.segments.at(-1).ramp.id);
            const queueM = stock / condition.densityVehPerKm * 1000, tail = limit.headM - queueM;
            for (const segment of b.segments) {
                const from = Math.max(segment.fromM, tail), to = Math.min(segment.toM, limit.headM);
                if (to - from < .1)
                    continue;
                const route = routes[segment.ramp.id], anchorM = to - segment.fromM + segment.rampFromM;
                const point = route.points.reduce((best, p, i) => Math.abs(route.metres[i] - anchorM) < best.d ? { p, d: Math.abs(route.metres[i] - anchorM) } : best, { p: route.points[0], d: Infinity }).p;
                const vehicles = stock * (to - from) / queueM;
                output.push({ id: `local-ramp:${path}:${b.ref}:${b.kind}:${output.length}`, pathKey: segment.ramp.id, eventKind: null,
                    point, anchorM, queueVehicles: vehicles, queueM: to - from, visibleQueueM: to - from, delayMin: capacity > 0 ? stock / capacity * 60 : null,
                    capacityVph: capacity, speedKmh: condition.speedKmh, color: colorAtSpeed(condition.speedKmh), released: false, outOfBoundsM: 0 });
            }
        }
    }
    return output;
}
export function junctionRampFlows(cells, routes, exits) {
    const flows = new Map();
    for (const [path, state] of Object.entries(cells))
        for (const b of junctionRampBindings(routes[path], exits)) {
            const j = state.junctions?.find(j => j.ref === b.ref);
            if (!j)
                continue;
            for (const s of b.segments) {
                const old = flows.get(s.ramp.id) ?? { offeredVph: 0, dischargedVph: 0 };
                old.offeredVph += (b.kind === 'entry' ? j.entryVph : (j.lastExitAdmitted ?? 0) * 60) * b.share;
                old.dischargedVph += (b.kind === 'entry' ? j.lastEntered : j.lastExited) * 60 * b.share;
                flows.set(s.ramp.id, old);
            }
        }
    return flows;
}
