import { closureGate, positionM } from '../spatial.js?build=611f14eae9771edc';
import { junctionRampBindings } from '../junction-ramp-bindings.js?build=611f14eae9771edc';
import { routeDescriptor } from '../network-catalog.js?build=611f14eae9771edc';
import { mainlineMerges } from '../network-receiving.js?build=611f14eae9771edc';
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
        if (routeDescriptor(route.key)?.kind === 'ramp') {
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
        // Some motorways merge directly into another motorway at a common OSM
        // vertex, without a separate highway=motorway_link (e.g. A59 -> A3).
        // Stripe only the terminal entrance to the blocked arm. The rest of the
        // approach remains open for earlier motorway and AS diversions.
        for (const merge of cachedMotorwayMerges(routes)) {
            if (merge.to !== route.key || !inClosed(merge.mergeM, gate.metre, gate.endM, true))
                continue;
            const feeder = routes[merge.from];
            if (!feeder)
                continue;
            add(event.id, feeder.key, Math.max(0, feeder.lengthM - 250), feeder.lengthM, 'motorway');
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
            const permitted = binding.kind === 'entry'
                ? inClosed(metre, gate.metre, gate.endM, true)
                : inClosed(metre, gate.metre, gate.endM, false);
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
            const continuations = (topo.starts.get(at) ?? []).filter(next => next.key !== ramp.key);
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
    // The same segment must not draw multiple overlapping red/white stripes
    // when two closure rules name the identical directed ramp.
    const uniq = new Map();
    for (const s of result)
        uniq.set([s.eventId, s.pathKey, s.fromM.toFixed(2), s.toM.toFixed(2)].join(':'), s);
    return [...uniq.values()];
}
