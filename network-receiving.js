/** Endpoint-connected mainlines exchange a receiving signal. This limits
 * actual discharge in the feeder CTM, rather than painting a second queue.
 * Aggregate motorway demands remain calibrated independently (not OD trips). */
import { MOTORWAY_ROUTE_KEYS } from './network-catalog.js?build=db2794dddb550a86';
import { defaultDemand } from './traffic.js?build=db2794dddb550a86';
import { motorwayEndpointIndex } from './network-topology.js?build=db2794dddb550a86';
import { CONGESTION_WAVE_KMH, QUEUE_JAM_DENSITY_PER_LANE } from './traffic-physics.js?build=db2794dddb550a86';
/** One *physical* congested CTM cell owns one receiving budget.
 * Previous solvers independently gave the full budget to upstream motorways
 * AND every incoming ramp; a heavily overloaded interchange could therefore
 * discharge several times the number of vehicles that would fit.
 *
 * The returned limits only govern REAL arrivals. Empty ramps remain free.
 * Existing vehicles are not deleted; an unserved approach retains its queue.
 * This is a deterministic scenario allocator, not a calibrated turn-count.
 */
export function sharedInterchangeReceiving(cells, connections, merges, activeVph = {}, queuedVehicles = {}) {
    const buckets = new Map();
    const add = (to, metre, kind, path) => {
        const state = cells[to];
        if (!state || !state.cells.length || !Number.isFinite(metre))
            return;
        const index = Math.min(state.cells.length - 1, Math.max(0, Math.floor(metre / state.cellM)));
        const cell = state.cells[index];
        const lanes = cell.openLanes?.length ?? Math.max(1, Math.round((cell.jamDensityVehKm ?? 390) / QUEUE_JAM_DENSITY_PER_LANE));
        const jam = cell.jamDensityVehKm ?? QUEUE_JAM_DENSITY_PER_LANE * lanes;
        const blocked = state.closures?.some(g => metre >= g.fromM - 1 && metre < g.toM - 1) ?? false;
        if (!blocked && cell.speedKmh > 65 && cell.densityVehKm <= (cell.criticalDensityVehKm ?? 20 * lanes) * 1.10)
            return;
        const supply = blocked || lanes === 0 ? 0 : Math.max(0, CONGESTION_WAVE_KMH * (jam - cell.densityVehKm));
        const bucketKey = to + ':' + index;
        const bucket = buckets.get(bucketKey) ?? { supply, arms: new Map() };
        bucket.supply = Math.min(bucket.supply, supply);
        const demand = activeVph[path] ?? defaultDemand(path);
        // After the upstream inflow stops, vehicles already in the last
        // motorway cell still need receiving service. Looking only at the
        // external boundary backlog would freeze those vehicles at a merge.
        const feeder = cells[path];
        const stock = kind === 'ramp' ? (queuedVehicles[path] ?? 0) :
            (feeder?.backlog ?? 0) + (feeder?.cells.at(-1)?.vehicles ?? 0);
        // Stock is measured in vehicles; multiplying by 60 translates it to one
        // model-minute of potential discharge for the receiving-share calculation.
        const weight = Math.max(0, Number.isFinite(demand) ? demand : 0) +
            60 * Math.max(0, Number.isFinite(stock) ? stock : 0);
        bucket.arms.set(kind + ':' + path, { kind, path, weight }); // idempotent OSM links
        buckets.set(bucketKey, bucket);
    };
    for (const link of connections)
        if (link.to !== link.rampId)
            add(link.to, link.downstreamMergeM, 'ramp', link.rampId);
    for (const link of merges)
        if (link.to !== link.from)
            add(link.to, link.mergeM, 'mainline', link.from);
    const limits = { mainline: {}, ramps: {} };
    for (const bucket of buckets.values()) {
        const arms = [...bucket.arms.values()], total = arms.reduce((n, a) => n + a.weight, 0);
        for (const arm of arms) {
            const share = total > 0 ? bucket.supply * arm.weight / total : 0;
            const output = arm.kind === 'ramp' ? limits.ramps : limits.mainline;
            // A feeder can touch multiple target cells. Its tightest actual
            // downstream bottleneck determines its discharge.
            output[arm.path] = Math.min(output[arm.path] ?? Infinity, share);
        }
    }
    return limits;
}
/** Backward-compatible ramp-only query for isolated junction scenarios. */
export function rampReceiving(cells, connections, activeVph = {}, queuedVehicles = {}) {
    return sharedInterchangeReceiving(cells, connections, [], activeVph, queuedVehicles).ramps;
}
export function mainlineMerges(routes) {
    const index = motorwayEndpointIndex(routes, MOTORWAY_ROUTE_KEYS), result = [];
    for (const from of MOTORWAY_ROUTE_KEYS) {
        const source = routes[from];
        if (!source)
            continue;
        const end = source.points.at(-1);
        const seen = new Set();
        for (const target of index.at(end)) {
            if (target.key === from || seen.has(target.key))
                continue;
            seen.add(target.key);
            if (target.metre >= routes[target.key].lengthM - 1)
                continue;
            result.push({ from, to: target.key, mergeM: target.metre });
        }
    }
    return result;
}
/** Backward-compatible motorway-only backpressure query. */
export function downstreamReceiving(cells, merges) {
    return sharedInterchangeReceiving(cells, [], merges).mainline;
}
