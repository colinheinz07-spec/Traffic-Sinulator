import { closureGate, positionM, routeSlice } from '../spatial.js?build=6c50172f4f7501e9';
import { junctionRampBindings } from '../junction-ramp-bindings.js?build=6c50172f4f7501e9';
import { routeDescriptor } from '../network-catalog.js?build=6c50172f4f7501e9';
import { mainlineMerges } from '../network-receiving.js?build=6c50172f4f7501e9';
const EPS = 2;
const endpointCache = new WeakMap();
const motorwayMergeCache = new WeakMap();
function cachedMotorwayMerges(routes) {
    const existing = motorwayMergeCache.get(routes);
    if (existing)
        return existing;
    const found = mainlineMerges(routes);
    motorwayMergeCache.set(routes, found);
    return found;
}
const pointId = (p) => p.join(',');
function endpointTopology(routes) {
    const cached = endpointCache.get(routes);
    if (cached)
        return cached;
    const ramps = [], starts = new Map(), mainlines = new Map();
    for (const route of Object.values(routes)) {
        if (routeDescriptor(route.key)?.kind === 'ramp' || route.key.startsWith('ramp-')) {
            ramps.push(route);
            const at = pointId(route.points[0]);
            starts.set(at, [...(starts.get(at) ?? []), route]);
        }
        else {
            route.points.forEach((point, i) => {
                const at = pointId(point);
                mainlines.set(at, [...(mainlines.get(at) ?? []), { key: route.key, metre: route.metres[i] }]);
            });
        }
    }
    const result = { ramps, starts, mainlines };
    endpointCache.set(routes, result);
    return result;
}
/** Exakt derselbe gerichtete Tangentenabgleich wie bei Autobahn-Rampen.
 * Geometrische Knotengleichheit allein erlaubt keine Fahrt gegen die Richtung. */
function heading(a, b) {
    const x = (b[1] - a[1]) * Math.cos((a[0] + b[0]) * Math.PI / 360), y = b[0] - a[0];
    const n = Math.hypot(x, y);
    return n > 1e-8 ? [x / n, y / n] : [0, 0];
}
function directedReceiving(ramp, hit, routes) {
    const road = routes[hit.key];
    if (!road || road.points.length < 2)
        return false;
    const at = road.metres.findIndex(m => m >= hit.metre - .05);
    const i = at < 0 ? road.points.length - 1 : at;
    const along = heading(road.points[Math.max(0, i - 1)], road.points[Math.min(road.points.length - 1, i + 1)]);
    const arriving = heading(ramp.points.at(-2), ramp.points.at(-1));
    return along[0] * arriving[0] + along[1] * arriving[1] >= .15;
}
const inClosed = (at, from, to, atGate = false) => at >= from - (atGate ? EPS : -EPS) && at < to - EPS;
/** A full closure affects only the selected direction and legal movements
 * actually merging into that section, not every arm of the same interchange.
 * Local off-ramps at the last usable exit remain OPEN for the diversion.
 */
export function closedNetworkSpans(events, routes, exits, connections) {
    const resolved = events.filter(e => e.kind === 'closure');
    if (resolved.length && resolved.every(e => e.networkClosure))
        return resolved.map(e => ({ eventId: e.id, pathKey: e.pathKey, fromM: e.networkClosure.fromM, toM: e.networkClosure.toM, source: e.networkClosure.source }));
    const result = [];
    const add = (eventId, pathKey, fromM, toM, source) => {
        const route = routes[pathKey];
        if (route && Number.isFinite(fromM) && Number.isFinite(toM) && toM > fromM + 0.5)
            result.push({ eventId, pathKey, fromM: Math.max(0, fromM), toM: Math.min(route.lengthM, toM), source });
    };
    for (const event of events) {
        if (event.kind !== 'closure')
            continue;
        const route = routes[event.pathKey];
        if (!route)
            continue;
        if (routeDescriptor(route.key)?.kind === 'ramp' || route.key.startsWith('ramp-')) {
            // Dedicated ramp closure: its whole directed branch is administratively shut.
            add(event.id, route.key, 0, route.lengthM, 'direct-ramp');
            continue;
        }
        const gate = closureGate(route, event, exits, events);
        if (!gate)
            continue;
        add(event.id, route.key, gate.metre, gate.endM, 'motorway');
        // Physically connected ramps leading INTO the prohibited direction.
        // A diverge OUT of the closure to an open motorway is not blocked;
        // those exits may serve existing traffic/mandatory diversion.
        // A ramp can be shared up to a real fork. Never block the entire feeder
        // merely because ONE of its possible receiving motorways is closed.
        const hasOpenReceiver = (rampId) => connections.some(link => link.rampId === rampId && (link.to !== route.key ||
            !inClosed(link.downstreamMergeM, gate.metre, gate.endM, true)));
        for (const link of connections) {
            if (link.to !== route.key || link.rampId === route.key)
                continue;
            if (!inClosed(link.downstreamMergeM, gate.metre, gate.endM, true))
                continue;
            if (hasOpenReceiver(link.rampId))
                continue;
            const ramp = routes[link.rampId];
            if (!ramp)
                continue;
            add(event.id, link.rampId, 0, ramp.lengthM, 'interchange-entry');
        }
        // Exit to the LOCAL road network: one endpoint belongs to the closed
        // motorway and the other lies outside our Autobahn simulation. A fork
        // leading to another *mapped motorway* is an open escape route instead.
        for (const link of connections) {
            if (link.from !== route.key || link.to !== link.rampId)
                continue;
            if (!inClosed(link.rampEntryM, gate.metre, gate.endM, false))
                continue;
            const ramp = routes[link.rampId];
            if (!ramp)
                continue;
            add(event.id, link.rampId, 0, ramp.lengthM, 'local-exit');
        }
        // Ordinary directional AS ramps. Last upstream off-ramp remains open;
        // its paired on-ramp is barred from entering the closed section.
        for (const binding of junctionRampBindings(route, exits)) {
            const j = exits.find(e => e.ref === binding.ref && e.road === routeDescriptor(route.key)?.motorway);
            if (!j)
                continue;
            const position = (j.directional?.[route.key]?.position ?? j.position);
            // The matching ramp's tie-in can be up to 900m away from its label.
            const metre = positionM(route, position, 900);
            if (metre === null)
                continue;
            const permitted = gate.exit?.ref === binding.ref ? binding.kind === 'entry' :
                gate.endExit?.ref === binding.ref ? binding.kind === 'exit' :
                    binding.kind === 'entry' ? inClosed(metre, gate.metre, gate.endM, true) : inClosed(metre, gate.metre, gate.endM, false);
            if (!permitted)
                continue;
            for (const segment of binding.segments) {
                add(event.id, segment.ramp.id, segment.rampFromM, segment.rampFromM + segment.toM - segment.fromM, binding.kind === 'entry' ? 'local-entry' : 'local-exit');
            }
        }
        // Traverse directed ramp chains back from the prohibited receiving road.
        // A shared feeder at a fork remains OPEN when it can reach an open arm.
        // Direct connections above remain useful for ramps whose OSM endpoints
        // differ from the old motorway geometry; this is an additive audit.
        const topo = endpointTopology(routes), memo = new Map();
        const leadsOnlyIntoClosure = (ramp, visiting) => {
            const known = memo.get(ramp.key);
            if (known !== undefined)
                return known;
            if (visiting.has(ramp.key))
                return false; // cycle/unknown: fail open
            const nextSeen = new Set(visiting);
            nextSeen.add(ramp.key);
            const at = pointId(ramp.points.at(-1));
            const mainlineHits = (topo.mainlines.get(at) ?? []).filter(hit => directedReceiving(ramp, hit, routes));
            const continuations = (topo.starts.get(at) ?? []).filter(next => next.key !== ramp.key && pointId(next.points.at(-1)) !== pointId(ramp.points[0]));
            // Gemeinsame Zufahrt nur sperren, wenn ALLE tatsächlich befahrbaren
            // Nachfolger gesperrt sind. Ein offener Ast gewinnt auch bei vorhandenem
            // Hauptfahrbahn-Treffer – keine pauschale Sperrung vor einer Gabelung.
            const reachable = [
                ...mainlineHits.map(hit => hit.key === route.key && inClosed(hit.metre, gate.metre, gate.endM, true)),
                ...continuations.map(next => leadsOnlyIntoClosure(next, nextSeen))
            ];
            const closed = reachable.length > 0 && reachable.every(Boolean);
            memo.set(ramp.key, closed);
            return closed;
        };
        for (const ramp of topo.ramps)
            if (!hasOpenReceiver(ramp.key) && leadsOnlyIntoClosure(ramp, new Set()))
                add(event.id, ramp.key, 0, ramp.lengthM, 'interchange-entry');
    }
    if (result.length)
        extendTrappedApproaches(result, routes, connections, exits);
    // The same segment must not draw multiple overlapping red/white stripes
    // when two closure rules name the identical directed ramp.
    const uniq = new Map();
    for (const s of result)
        uniq.set([s.eventId, s.pathKey, s.fromM.toFixed(2), s.toM.toFixed(2)].join(':'), s);
    return [...uniq.values()];
}
// Compute the closure of the UNION of active events on exact directed OSM nodes.
// A terminal approach is closed only when every legal continuation is closed.
function extendTrappedApproaches(result, routes, connections, exits) {
    const topo = endpointTopology(routes);
    const bands = new Map();
    const record = (s) => {
        const list = bands.get(s.pathKey) ?? [];
        if (list.some((p) => p.fromM <= s.fromM + .05 && p.toM >= s.toM - .05))
            return false;
        list.push(s);
        bands.set(s.pathKey, list);
        return true;
    };
    for (const s of result)
        record(s);
    const blocked = (key, at) => (bands.get(key) ?? []).find((s) => at >= s.fromM - .05 && (at < s.toM - .05 || at >= routes[key].lengthM - .05 && s.toM >= routes[key].lengthM - .05));
    const isRamp = (route) => route.key.startsWith('ramp-') || routeDescriptor(route.key)?.kind === 'ramp';
    const routeLinks = new Map();
    const departures = new Map();
    function depart(key, metre, target, at) {
        if (!routes[key] || !routes[target] || key === target)
            return;
        const list = departures.get(key) ?? [];
        if (!list.some((x) => x.key === target && Math.abs(x.metre - metre) < .05 && Math.abs(x.at - at) < .05))
            list.push({ key: target, metre, at });
        departures.set(key, list);
    }
    for (const link of connections) {
        const list = routeLinks.get(link.rampId) ?? [];
        list.push(link);
        routeLinks.set(link.rampId, list);
        if (link.from !== link.rampId)
            depart(link.from, link.rampEntryM, link.rampId, 0);
    }
    for (const merge of cachedMotorwayMerges(routes))
        depart(merge.from, routes[merge.from].lengthM, merge.to, merge.mergeM);
    // At a real OSM node a ramp may begin inside a long motorway Way.
    // Use the same directed tangent test instead of a radius/geographic guess.
    for (const road of Object.values(routes)) {
        if (isRamp(road))
            continue;
        road.points.forEach((point, i) => {
            for (const ramp of topo.starts.get(pointId(point)) ?? []) {
                const end = pointId(ramp.points.at(-1));
                if (end === pointId(point))
                    continue;
                const idx = Math.max(0, i - 1), along = heading(road.points[idx], road.points[Math.min(i + 1, road.points.length - 1)]);
                const axis = heading(ramp.points[0], ramp.points[1]);
                if (along[0] * axis[0] + along[1] * axis[1] >= .15)
                    depart(road.key, road.metres[i], ramp.key, 0);
            }
        });
    }
    const receivers = new Map();
    const localEnds = new Set();
    for (const road of Object.values(routes))
        if (!isRamp(road)) {
            for (const b of junctionRampBindings(road, exits).filter(b => b.kind === 'exit')) {
                const terminal = b.segments.at(-1);
                if (terminal)
                    localEnds.add(terminal.ramp.id);
            }
        }
    for (const ramp of topo.ramps) {
        const at = pointId(ramp.points.at(-1));
        const next = [];
        for (const hit of topo.mainlines.get(at) ?? [])
            if (directedReceiving(ramp, hit, routes))
                next.push({ key: hit.key, at: hit.metre });
        for (const link of routeLinks.get(ramp.key) ?? [])
            if (link.to !== ramp.key && routes[link.to])
                next.push({ key: link.to, at: link.downstreamMergeM });
        for (const r of topo.starts.get(at) ?? []) {
            if (r.key === ramp.key || pointId(r.points.at(-1)) === pointId(ramp.points[0]))
                continue; // no U-turn
            next.push({ key: r.key, at: 0 });
        }
        receivers.set(ramp.key, next);
    }
    // A ramp that terminates at an ordinary, mapped local AS is an escape.
    // An orphaned transfer at a motorway cross is not a local exit.
    function canEscape(key, at, seen = new Set()) {
        if (blocked(key, at) || seen.has(key))
            return false;
        const route = routes[key];
        if (!route)
            return false;
        if (!isRamp(route))
            return true;
        const next = receivers.get(key) ?? [];
        if (localEnds.has(key))
            return true;
        if (!next.length) {
            const label = routeDescriptor(key)?.label ?? '';
            return !/\b(?:AK|AD|Autobahnkreuz|Autobahndreieck)\b/i.test(label);
        }
        const visited = new Set(seen);
        visited.add(key);
        return next.some((r) => canEscape(r.key, r.at, visited));
    }
    let changed = true;
    while (changed) {
        changed = false;
        for (const road of Object.values(routes)) {
            if (isRamp(road)) {
                if (blocked(road.key, 0) || localEnds.has(road.key))
                    continue;
                const next = receivers.get(road.key) ?? [];
                const cause = next.map((r) => blocked(r.key, r.at)).find(Boolean);
                if (cause && next.every((r) => !canEscape(r.key, r.at))) {
                    const span = { eventId: cause.eventId, pathKey: road.key, fromM: 0, toM: road.lengthM, source: 'interchange-entry' };
                    if (record(span)) {
                        result.push(span);
                        changed = true;
                    }
                }
                continue;
            }
            const all = departures.get(road.key) ?? [];
            const current = (bands.get(road.key) ?? []).filter((s) => s.toM >= road.lengthM - .05)
                .sort((a, b) => a.fromM - b.fromM)[0];
            const terminal = all.filter((r) => r.metre >= road.lengthM - .05);
            const cause = current ?? terminal.map((r) => blocked(r.key, r.at)).find(Boolean);
            if (!cause || !current && (!terminal.length || terminal.some((r) => canEscape(r.key, r.at))))
                continue;
            const gate = current?.fromM ?? road.lengthM;
            if (gate <= .05)
                continue;
            // An explicitly selected primary gate remains an anchor unless an actual
            // departure at that gate lost its last open movement.
            if (current && gate !== road.lengthM && !all.some((r) => Math.abs(r.metre - gate) < .1))
                continue;
            const last = Math.max(0, ...all.filter((r) => r.metre <= gate + .05 && canEscape(r.key, r.at)).map((r) => r.metre));
            if (last >= gate - .05)
                continue;
            const span = { eventId: cause.eventId, pathKey: road.key, fromM: last, toM: gate, source: 'motorway' };
            if (record(span)) {
                result.push(span);
                changed = true;
            }
        }
    }
}
/** One resolved closure plan for rendering, CTM and diversion routing.
 * Synthetic events are ephemeral; only the user's original events are stored. */
export function effectiveNetworkEvents(events, routes, exits, connections) {
    if (!events.some(e => e.kind === 'closure'))
        return [...events];
    const spans = closedNetworkSpans(events, routes, exits, connections);
    const grouped = new Map();
    for (const span of spans) {
        const list = grouped.get(span.pathKey) ?? [];
        list.push({ ...span });
        grouped.set(span.pathKey, list);
    }
    const out = events.filter(e => e.kind !== 'closure');
    for (const [key, list] of grouped) {
        const route = routes[key];
        if (!route)
            continue;
        const merged = [];
        for (const span of list.sort((a, b) => a.fromM - b.fromM || b.toM - a.toM)) {
            const last = merged.at(-1);
            if (last && span.fromM <= last.toM + .5) {
                last.toM = Math.max(last.toM, span.toM);
                if (span.source === 'motorway')
                    last.source = 'motorway';
            }
            else
                merged.push({ ...span });
        }
        for (const span of merged) {
            const primary = events.find(e => e.kind === 'closure' && e.pathKey === key && e.id === span.eventId) ?? events.find(e => e.kind === 'closure' && e.pathKey === key && list.some(s => s.eventId === e.id && s.fromM >= span.fromM - .5 && s.toM <= span.toM + .5));
            const base = primary ?? events.find(e => e.id === span.eventId);
            if (!base)
                continue;
            const gate = primary ? closureGate(route, primary, exits, events) : null;
            const directional = exits.filter(e => e.road === routeDescriptor(key)?.motorway && (!e.directional || e.directional[key]));
            const near = (metre) => directional.map(e => ({ e, m: positionM(route, e.directional?.[key]?.position ?? e.position, 900) })).filter(x => x.m !== null && (Math.abs(x.m - metre) < 900)).sort((a, b) => Math.abs(a.m - metre) - Math.abs(b.m - metre))[0]?.e.ref;
            const startRef = gate && Math.abs(gate.metre - span.fromM) < .5 ? gate.exit?.ref : span.fromM > 0 ? near(span.fromM) : undefined;
            const endRef = gate && Math.abs(gate.endM - span.toM) < .5 ? gate.endExit?.ref : span.toM < route.lengthM ? near(span.toM) : undefined;
            const mid = (span.fromM + span.toM) / 2;
            const point = primary?.point ?? routeSlice(route, mid, Math.min(route.lengthM, mid + 1))[0] ?? route.points[0];
            const lanes = routeDescriptor(key)?.lanes ?? base.laneCount;
            out.push({ ...base, id: primary?.id ?? 'network:' + base.id + ':' + key + ':' + Math.round(span.fromM),
                pathKey: key, point, laneCount: lanes, closedLanes: Array.from({ length: lanes }, (_, i) => i),
                settings: { ...base.settings, lengthM: Math.max(1, Math.round(span.toM - span.fromM)), speedKmh: 0, shoulder: 'blocked' },
                networkClosure: { fromM: span.fromM, toM: span.toM, source: span.source, derived: !primary, startRef, endRef } });
        }
    }
    return [...out, ...events.filter(e => e.kind === 'closure' && !out.some(x => x.id === e.id) && !spans.some(s => s.eventId === e.id))];
}
