/** Endpoint-connected mainlines exchange a receiving signal. This limits
 * actual discharge in the feeder CTM, rather than painting a second queue.
 * Aggregate motorway demands remain calibrated independently (not OD trips). */
import { MOTORWAY_ROUTE_KEYS } from './network-catalog.js?build=ce3e105ecde00d7b';
import { motorwayEndpointIndex } from './network-topology.js?build=ce3e105ecde00d7b';
import { CONGESTION_WAVE_KMH, QUEUE_JAM_DENSITY_PER_LANE } from './traffic-physics.js?build=ce3e105ecde00d7b';
/** Share downstream CTM receiving capacity with a physically connected
 * on-ramp. No incident or over-saturation -> no artificial restriction.
 * A ramp's own conserved queue is then handled by advanceSpatial. */
export function rampReceiving(cells, connections) {
    const result = {};
    for (const link of connections) {
        if (link.to === link.rampId)
            continue;
        const dest = cells[link.to];
        if (!dest)
            continue;
        const i = Math.min(dest.cells.length - 1, Math.max(0, Math.floor(link.downstreamMergeM / dest.cellM)));
        const cell = dest.cells[i];
        const lanes = cell.openLanes?.length ?? Math.max(1, Math.round((cell.jamDensityVehKm ?? 390) / QUEUE_JAM_DENSITY_PER_LANE));
        const jam = cell.jamDensityVehKm ?? QUEUE_JAM_DENSITY_PER_LANE * lanes;
        const blocked = dest.closures?.some(g => link.downstreamMergeM >= g.fromM - 1 && link.downstreamMergeM < g.toM - 1) ?? false;
        if (!blocked && cell.speedKmh > 65 && cell.densityVehKm <= (cell.criticalDensityVehKm ?? 20 * lanes) * 1.10)
            continue;
        const supply = blocked || lanes === 0 ? 0 : Math.max(0, CONGESTION_WAVE_KMH * (jam - cell.densityVehKm));
        result[link.rampId] = Math.min(result[link.rampId] ?? Infinity, supply);
    }
    return result;
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
export function downstreamReceiving(cells, merges) {
    const output = {};
    for (const link of merges) {
        const target = cells[link.to];
        if (!target)
            continue;
        const i = Math.min(target.cells.length - 1, Math.floor(link.mergeM / target.cellM)), cell = target.cells[i];
        const lanes = cell.openLanes?.length ?? Math.max(1, Math.round((cell.jamDensityVehKm ?? 390) / QUEUE_JAM_DENSITY_PER_LANE));
        const jam = cell.jamDensityVehKm ?? QUEUE_JAM_DENSITY_PER_LANE * lanes;
        const formal = target.closures?.some(g => link.mergeM >= g.fromM - 1 && link.mergeM < g.toM - 1);
        if (!formal && (cell.speedKmh > 65 && cell.densityVehKm <= (cell.criticalDensityVehKm ?? 20 * lanes) * 1.1))
            continue;
        const supply = formal || lanes === 0 ? 0 : Math.max(0, CONGESTION_WAVE_KMH * (jam - cell.densityVehKm));
        output[link.from] = Math.min(output[link.from] ?? Infinity, supply);
    }
    return output;
}
