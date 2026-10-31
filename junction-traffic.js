import { junctionAccess } from './road-controls.js?build=8a0e0515db091459';
import { localRoadAvailability } from './calendar-traffic.js?build=8a0e0515db091459';
import { diversionJunctions } from './diversions.js?build=8a0e0515db091459';
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
export function normalJunctionTraffic(route, exits, demandVph, moment) {
    if (route.key.startsWith('ramp-'))
        return [];
    return diversionJunctions(route.key, exits, route).filter(j => !j.isInterchange).map(j => {
        // 4–8% local turnover per AS. Balanced ordinary entry/exit at the
        // reference free flow avoids artificially growing demand at every node.
        const share = 4 + Number.parseInt(j.ref, 10) % 5, profile = junctionCapacityProfile(route.key.startsWith('A3') ? 'A3' : 'A48', j.ref);
        const access = junctionAccess(route, [], j.metre, j.ref);
        return { id: route.key + ':local:' + j.ref, ref: j.ref, metre: j.metre,
            entryVph: access.entry ? Math.min(700, demandVph * share / 100) : 0, exitPercent: access.exit ? share : 0,
            entryCapacityVph: profile.entry, exitCapacityVph: profile.exit,
            exitTerminalVph: Math.min(profile.exit, profile.terminal * localRoadAvailability(moment)), exitStorageVehicles: profile.storage };
    });
}
