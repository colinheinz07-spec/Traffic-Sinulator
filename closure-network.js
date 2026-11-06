import { closureGate, positionM } from './spatial.js?build=6f9588346cdc71ff';
import { junctionRampBindings } from './junction-ramp-bindings.js?build=6f9588346cdc71ff';
import { routeDescriptor } from './network-catalog.js?build=6f9588346cdc71ff';
const EPS = 2;
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
        for (const link of connections) {
            if (link.to !== route.key || link.rampId === route.key)
                continue;
            if (!inClosed(link.downstreamMergeM, gate.metre, gate.endM, true))
                continue;
            const ramp = routes[link.rampId];
            if (!ramp)
                continue;
            add(event.id, link.rampId, 0, ramp.lengthM, 'interchange-entry');
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
    }
    // The same segment must not draw multiple overlapping red/white stripes
    // when two closure rules name the identical directed ramp.
    const uniq = new Map();
    for (const s of result)
        uniq.set([s.eventId, s.pathKey, s.fromM.toFixed(2), s.toM.toFixed(2)].join(':'), s);
    return [...uniq.values()];
}
