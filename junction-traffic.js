import { diversionJunctions } from './diversions.js?build=d322a47ab35b6164';
// No surveyed AS signal plans or local off-ramp lengths are bundled. These
// are explicit defaults: roughly one 300 m queue lane, and ~39% effective
// green at 1800 veh/h/lane. They are not measured AS-specific capacities.
export const DEFAULT_EXIT_TERMINAL_VPH = 700, DEFAULT_EXIT_STORAGE_VEHICLES = 40;
export function exitRampVehicles(state) {
    return (state.exitQueue?.normal ?? 0) + Object.values(state.exitQueue?.detours ?? {}).reduce((n, v) => n + v, 0);
}
export function normalJunctionTraffic(route, exits, demandVph) {
    if (route.key.startsWith('ramp-'))
        return [];
    return diversionJunctions(route.key, exits, route).filter(j => !j.isInterchange).map(j => {
        // 4–8% local turnover per AS. Balanced ordinary entry/exit at the
        // reference free flow avoids artificially growing demand at every node.
        const share = 4 + Number(j.ref) % 5;
        return { id: route.key + ':local:' + j.ref, ref: j.ref, metre: j.metre,
            entryVph: Math.min(700, demandVph * share / 100), exitPercent: share,
            entryCapacityVph: 900, exitCapacityVph: 1800,
            exitTerminalVph: DEFAULT_EXIT_TERMINAL_VPH, exitStorageVehicles: DEFAULT_EXIT_STORAGE_VEHICLES };
    });
}
