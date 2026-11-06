/** 02_Verkehr: Zugeordnetes Fachmodul junction-traffic. */
import { regionalFlowAt, regionalJunctionDemands } from '../regional-traffic.js?build=1cc68e0b949f5571';
import { networkRoad } from '../network-road.js?build=1cc68e0b949f5571';
import { junctionAccess } from '../road-controls.js?build=1cc68e0b949f5571';
import { localRoadAvailability } from '../calendar-traffic.js?build=1cc68e0b949f5571';
import { applyJunctionRampLimits } from '../junction-ramp-bindings.js?build=1cc68e0b949f5571';
import { diversionJunctions } from '../diversions.js?build=1cc68e0b949f5571';
// No surveyed AS signal plans or local off-ramp lengths are bundled. These
// are explicit defaults: roughly one 300 m queue lane, and ~39% effective
// green at 1800 veh/h/lane. They are not measured AS-specific capacities.
export const DEFAULT_EXIT_TERMINAL_VPH = 700, DEFAULT_EXIT_STORAGE_VEHICLES = 40;
/** Directional interchange aggregates, explicit scenario assumptions rather
 * than surveyed counts. Larger urban distributors have more than one
 * usable movement and more ramp storage than the generic short exit. */
export function junctionCapacityProfile(road, ref) {
    const profiles = {
        'A3:40': { terminal: 1500, storage: 120, exit: 3000, entry: 1800 },
        'A3:42': { terminal: 1500, storage: 120, exit: 2800, entry: 1800 },
        'A48:10': { terminal: 1600, storage: 140, exit: 3000, entry: 1800 },
        'A48:11': { terminal: 1500, storage: 120, exit: 2800, entry: 1800 }
    };
    return profiles[road + ':' + ref] ?? { terminal: DEFAULT_EXIT_TERMINAL_VPH, storage: DEFAULT_EXIT_STORAGE_VEHICLES, exit: 1800, entry: 900 };
}
export function exitRampVehicles(state) {
    return (state.exitQueue?.normal ?? 0) + Object.values(state.exitQueue?.detours ?? {}).reduce((n, v) => n + v, 0);
}
export function normalJunctionTraffic(route, exits, demandVph, moment, regional = false, events = []) {
    if (!networkRoad(route.key))
        return [];
    const ordinary = diversionJunctions(route.key, exits, route).filter(j => !j.isInterchange).map(j => {
        // Junction-specific local turnover. Balanced ordinary entry/exit at the
        // reference free flow avoids artificially growing demand at every node.
        const road = networkRoad(route.key);
        // Explicit local catchment assumptions, independent of AS numbering.
        // Montabaur is a stronger distributor than rural Dierdorf.
        const localShares = { 'A3:40': 12, 'A3:43': 7, 'A3:37': 5, 'A3:36': 7, 'A3:38': 8, 'A48:12': 10, 'A48:11': 11, 'A48:10': 12 };
        const share = localShares[road + ':' + j.ref] ?? (road === 'A559' || road === 'A59' ? 9 : 6), profile = junctionCapacityProfile(road, j.ref);
        const access = junctionAccess(route, events, j.metre, j.ref);
        return { id: route.key + ':local:' + j.ref, ref: j.ref, metre: j.metre,
            entryVph: access.entry ? (regional && moment ? regionalFlowAt(route, exits, demandVph, j.metre + .1, moment) : demandVph) * share / 100 : 0, exitPercent: access.exit ? share : 0,
            entryCapacityVph: profile.entry, exitCapacityVph: profile.exit,
            exitTerminalVph: Math.min(profile.exit, profile.terminal * localRoadAvailability(moment)), exitStorageVehicles: profile.storage };
    });
    const demands = regional && moment ? regionalJunctionDemands(route, exits, demandVph, moment, ordinary, events) : ordinary;
    return applyJunctionRampLimits(route, exits, events, demands);
}
