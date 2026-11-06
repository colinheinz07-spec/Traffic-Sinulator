/** 02_Verkehr: Zugeordnetes Fachmodul junction-traffic. */
import { regionalFlowAt, regionalJunctionDemands } from '../regional-traffic.js?build=075ee7368d0e21ea';
import { localJunctionShares } from './anschlussstellen-nachfrage.js?build=075ee7368d0e21ea';
import { networkRoad } from '../network-road.js?build=075ee7368d0e21ea';
import { junctionAccess } from '../road-controls.js?build=075ee7368d0e21ea';
import { localRoadAvailability } from '../calendar-traffic.js?build=075ee7368d0e21ea';
import { applyJunctionRampLimits } from '../junction-ramp-bindings.js?build=075ee7368d0e21ea';
import { diversionJunctions } from '../diversions.js?build=075ee7368d0e21ea';
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
        // Defined in one readable AS catalog: distinct local offers (entries)
        // and destination shares (exits), not extra vehicles silently injected.
        const local = localJunctionShares(road, j.ref, !!(regional && moment));
        const entryShare = local.entryPercent, exitShare = local.exitPercent;
        const profile = junctionCapacityProfile(road, j.ref);
        const access = junctionAccess(route, events, j.metre, j.ref);
        return { id: route.key + ':local:' + j.ref, ref: j.ref, metre: j.metre,
            entryVph: access.entry ? (regional && moment ? regionalFlowAt(route, exits, demandVph, j.metre + .1, moment) : demandVph) * entryShare / 100 : 0,
            exitPercent: access.exit ? exitShare : 0,
            entryCapacityVph: profile.entry, exitCapacityVph: profile.exit,
            exitTerminalVph: Math.min(profile.exit, profile.terminal * localRoadAvailability(moment)), exitStorageVehicles: profile.storage };
    });
    const demands = regional && moment ? regionalJunctionDemands(route, exits, demandVph, moment, ordinary, events) : ordinary;
    return applyJunctionRampLimits(route, exits, events, demands);
}
