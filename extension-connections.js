import { extensionRoutes } from './network-extensions.js?build=7a4dfbeb34f189f9';
import { MOTORWAY_ROUTE_KEYS } from './network-catalog.js?build=7a4dfbeb34f189f9';
import { motorwayEndpointIndex } from './network-topology.js?build=7a4dfbeb34f189f9';
/** Connect only exact retained OSM endpoints. A self reference denotes an
 * external network boundary, not a fabricated road to an unmapped motorway. */
export function buildExtensionConnections(routes) {
    const index = motorwayEndpointIndex(routes, MOTORWAY_ROUTE_KEYS);
    const output = [];
    for (const ramp of extensionRoutes.filter(r => r.kind === 'ramp')) {
        const path = routes[ramp.id];
        if (!path)
            continue;
        const first = path.points[0], last = path.points.at(-1);
        const source = index.at(first)[0], target = index.at(last)[0];
        // Boundaries outside the simulated motorway network intentionally remain open.
        if (!source && !target)
            continue;
        output.push({ rampId: ramp.id, from: source?.key ?? ramp.id, to: target?.key ?? ramp.id,
            rampEntryM: source?.metre ?? 0, downstreamMergeM: target?.metre ?? path.lengthM, sourceGapM: 0, mergeGapM: 0 });
    }
    return output;
}
