/** 03_Stauphysik: Zugeordnetes Fachmodul network-receiving. */
/** Endpoint-connected mainlines exchange a receiving signal. This limits
 * actual discharge in the feeder CTM, rather than painting a second queue.
 * Aggregate motorway demands remain calibrated independently (not OD trips). */
import { MOTORWAY_ROUTE_KEYS } from '../network-catalog.js?build=468d7db6d22b8662';
import { defaultDemand } from '../traffic.js?build=468d7db6d22b8662';
import { motorwayEndpointIndex } from '../network-topology.js?build=468d7db6d22b8662';
import { CONGESTION_WAVE_KMH, QUEUE_JAM_DENSITY_PER_LANE } from '../traffic-physics.js?build=468d7db6d22b8662';
function receiverAt(cells, to, metre) {
    const target = cells[to];
    if (!target?.cells.length || !Number.isFinite(metre))
        return null;
    const face = Math.max(0, Math.min(target.cells.length - 1, Math.floor(metre / target.cellM)));
    const cell = target.cells[face];
    const lanes = cell.openLanes?.length ?? Math.max(1, Math.round((cell.jamDensityVehKm ?? 390) / QUEUE_JAM_DENSITY_PER_LANE));
    const jam = cell.jamDensityVehKm ?? QUEUE_JAM_DENSITY_PER_LANE * lanes;
    const blocked = target.closures?.some(g => metre >= g.fromM - 1 && metre < g.toM - 1) ?? false;
    if (!blocked && cell.speedKmh > 65 && cell.densityVehKm <= (cell.criticalDensityVehKm ?? 20 * lanes) * 1.10)
        return null; // no false queues on freely receiving motorway sections
    return { face, supply: blocked || lanes === 0 ? 0 :
            Math.max(0, CONGESTION_WAVE_KMH * (jam - cell.densityVehKm)) };
}
/** Joint allocator: every incoming source competes against all other
 * simultaneous sources at its exact destination cell. Each source is
 * deduplicated, and independently congested target faces remain separate.
 * Existing inventories still receive service after new demand drops to zero.
 */
export function sharedNetworkReceiving(cells, ramps, merges, activeVph = {}, queuedVehicles = {}) {
    const groups = new Map();
    function add(claim) {
        if (claim.source === claim.to)
            return;
        const receiver = receiverAt(cells, claim.to, claim.atM);
        if (!receiver)
            return;
        const key = claim.to + ':' + receiver.face;
        const group = groups.get(key) ?? { supply: receiver.supply, claims: new Map() };
        group.supply = Math.min(group.supply, receiver.supply);
        group.claims.set(claim.kind + ':' + claim.source, claim);
        groups.set(key, group);
    }
    for (const r of ramps)
        add({ source: r.rampId, kind: 'ramp', to: r.to, atM: r.downstreamMergeM });
    for (const m of merges)
        add({ source: m.from, kind: 'motorway', to: m.to, atM: m.mergeM });
    const limits = { ramps: {}, motorways: {} };
    for (const { supply, claims } of groups.values()) {
        const participants = [...claims.values()].map(claim => {
            const offered = activeVph[claim.source] ?? defaultDemand(claim.source);
            // Queued vehicles are real inventory, even if the approach has stopped
            // receiving new trips. Motorway CTM keeps its boundary backlog separately.
            const stock = queuedVehicles[claim.source] ?? (claim.kind === 'motorway'
                ? cells[claim.source]?.backlog ?? 0 : 0);
            const weight = Math.max(0, Number.isFinite(offered) ? offered : 0) +
                60 * Math.max(0, Number.isFinite(stock) ? stock : 0);
            return { claim, weight };
        });
        const total = participants.reduce((n, p) => n + p.weight, 0);
        for (const { claim, weight } of participants) {
            const output = claim.kind === 'ramp' ? limits.ramps : limits.motorways;
            const share = total > 0 ? supply * weight / total : 0;
            // A feeder reaching two restricted faces takes the tighter restriction.
            output[claim.source] = Math.min(output[claim.source] ?? Infinity, share);
        }
    }
    return limits;
}
/** Backward-compatible ramp-only adapter for isolated simulations. */
export function rampReceiving(cells, connections, activeVph = {}, queuedVehicles = {}) {
    return sharedNetworkReceiving(cells, connections, [], activeVph, queuedVehicles).ramps;
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
/** Backward-compatible motorway-only adapter for isolated CTM tests. */
export function downstreamReceiving(cells, merges, activeVph = {}) {
    return sharedNetworkReceiving(cells, [], merges, activeVph).motorways;
}
