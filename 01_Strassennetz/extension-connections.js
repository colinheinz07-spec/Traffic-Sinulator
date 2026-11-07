/** 01_Strassennetz: Zugeordnetes Fachmodul extension-connections. */
import { extensionRoutes } from '../network-extensions.js?build=3b44a696873cb354';
import { MOTORWAY_ROUTE_KEYS } from '../network-catalog.js?build=3b44a696873cb354';
import { motorwayEndpointIndex } from '../network-topology.js?build=3b44a696873cb354';
const heading = (a, b) => {
    const x = (b[1] - a[1]) * Math.cos((a[0] + b[0]) * Math.PI / 360), y = b[0] - a[0], length = Math.hypot(x, y);
    return length > .00000001 ? [x / length, y / length] : [0, 0];
};
function motorwayHeading(route, metre) {
    const at = route.metres.findIndex(m => m >= metre - .05);
    const i = at < 0 ? route.points.length - 1 : at;
    return heading(route.points[Math.max(0, i - 1)], route.points[Math.min(route.points.length - 1, i + 1)]);
}
function attachment(hits, ramp, routes, atEnd) {
    // Auch ein einzelner Knoten-Treffer muss zur gerichteten Rampe passen.
    // Sonst verbindet ein gemeinsamer OSM-Punkt eine Auffahrt entgegen der Fahrtrichtung.
    if (!hits.length)
        return undefined;
    const points = ramp.points, axis = atEnd ? heading(points.at(-2), points.at(-1)) :
        heading(points[0], points[1]);
    const ranked = hits.map((hit, index) => {
        const route = routes[hit.key], along = motorwayHeading(route, hit.metre);
        const dot = axis[0] * along[0] + axis[1] * along[1];
        // A source needs an upstream approach; a target needs road past the merge.
        const continues = atEnd ? route.lengthM - hit.metre > 10 : hit.metre > 10;
        return { hit, index, dot, continues, compatible: dot >= .15 };
    }).sort((a, b) => Number(b.compatible) - Number(a.compatible) ||
        Number(b.continues) - Number(a.continues) || b.dot - a.dot || a.index - b.index);
    // Never select a carriageway running against the ramp at an ambiguous node.
    return ranked[0]?.compatible ? ranked[0].hit : undefined;
}
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
        const source = attachment(index.at(first), path, routes, false), target = attachment(index.at(last), path, routes, true);
        // Boundaries outside the simulated motorway network intentionally remain open.
        if (!source && !target)
            continue;
        output.push({ rampId: ramp.id, from: source?.key ?? ramp.id, to: target?.key ?? ramp.id,
            rampEntryM: source?.metre ?? 0, downstreamMergeM: target?.metre ?? path.lengthM, sourceGapM: 0, mergeGapM: 0 });
    }
    return output;
}
