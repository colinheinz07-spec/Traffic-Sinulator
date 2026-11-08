import { MOTORWAY_ROUTE_KEYS, MOTORWAY_REFS } from '../network-catalog.js?build=f706910bd9663983';
import { networkRoad } from '../network-road.js?build=f706910bd9663983';
import { NETWORK_PATHS, PATHS } from '../traffic.js?build=f706910bd9663983';
export const MOTORWAY_PATHS = MOTORWAY_ROUTE_KEYS;
export const MOTORWAY_GROUPS = MOTORWAY_REFS.map(road => ({ road, paths: MOTORWAY_PATHS.filter(key => networkRoad(key) === road) }));
export function junctionDirectory(exits) {
    return MOTORWAY_GROUPS.map(group => ({ ...group, junctions: exits.filter(e => e.road === group.road)
            .sort((a, b) => a.ref.localeCompare(b.ref, 'de', { numeric: true })) }));
}
/** Keep a selected direction where that AS exists, otherwise use a valid
 * direction of the clicked motorway. Entry-only anchors remain valid. */
export function junctionRoute(exit, current) {
    const choices = MOTORWAY_PATHS.filter(key => networkRoad(key) === (exit.sharedRoad ?? exit.road) && (!exit.directional || !!exit.directional[key]));
    return choices.find(key => key === current) ?? choices[0] ?? null;
}
/** All motorway directions remain visible in free flow. Additional ramp
 * rows appear when selected, used by an event or carrying a queue. */
export function trafficOverviewPaths(selected, eventPaths, queued) {
    const permanent = new Set([...PATHS, ...MOTORWAY_PATHS]);
    return NETWORK_PATHS.filter(key => permanent.has(key) || key === selected || eventPaths.has(key) || queued.has(key));
}
