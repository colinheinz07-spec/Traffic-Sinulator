/** Endpoint-connected mainlines exchange a receiving signal. This limits
 * actual discharge in the feeder CTM, rather than painting a second queue.
 * Aggregate motorway demands remain calibrated independently (not OD trips). */
import { extensionRoutes } from './network-extensions.js?build=bf089c90fbdf3c9d';
import { positionM, metres } from './spatial.js?build=bf089c90fbdf3c9d';
import { CONGESTION_WAVE_KMH, QUEUE_JAM_DENSITY_PER_LANE } from './traffic-physics.js?build=bf089c90fbdf3c9d';
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
    const mains = ['A3-koeln', 'A3-frankfurt', 'A48-dernbach', 'A48-koblenz', ...extensionRoutes.filter(r => r.kind === 'motorway').map(r => r.id)];
    return mains.flatMap(from => {
        const end = routes[from].points.at(-1);
        return mains.filter(to => to !== from).flatMap(to => {
            const route = routes[to], at = route.points.findIndex(p => metres(p, end) < .05);
            if (at < 0)
                return [];
            const mergeM = positionM(route, end, 1);
            return mergeM < route.lengthM - 1 ? [{ from, to, mergeM }] : [];
        });
    });
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
        if (!formal && (cell.speedKmh > 65 || cell.densityVehKm <= (cell.criticalDensityVehKm ?? 20 * lanes) * 1.1))
            continue;
        const supply = formal || lanes === 0 ? 0 : Math.max(0, CONGESTION_WAVE_KMH * (jam - cell.densityVehKm));
        output[link.from] = Math.min(output[link.from] ?? Infinity, supply);
    }
    return output;
}
