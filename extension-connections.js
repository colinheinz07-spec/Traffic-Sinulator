import { extensionRoutes } from './network-extensions.js?build=d1b388adff4c16bc';
import { positionM, metres } from './spatial.js?build=d1b388adff4c16bc';
/** Connect only exact retained OSM endpoints. A self reference denotes an
 * external network boundary, not a fabricated road to an unmapped motorway. */
export function buildExtensionConnections(routes) {
    const trunks = ['A3-koeln', 'A3-frankfurt', ...extensionRoutes.filter(r => r.kind === 'motorway').map(r => r.id)];
    const output = [];
    for (const ramp of extensionRoutes.filter(r => r.kind === 'ramp')) {
        const path = routes[ramp.id], first = path.points[0], last = path.points.at(-1);
        const locate = (point) => trunks.flatMap(key => {
            const route = routes[key], index = route.points.findIndex(p => metres(p, point) < .05);
            return index < 0 ? [] : [{ key, metre: positionM(route, point, 1) }];
        });
        const source = locate(first)[0], target = locate(last)[0];
        if (!source && !target)
            continue;
        output.push({ rampId: ramp.id, from: source?.key ?? ramp.id, to: target?.key ?? ramp.id,
            rampEntryM: source?.metre ?? 0, downstreamMergeM: target?.metre ?? path.lengthM, sourceGapM: 0, mergeGapM: 0 });
    }
    return output;
}
