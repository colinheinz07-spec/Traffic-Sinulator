import { pathBottleneck } from './traffic.js';
const rank = { free: 0, slow: 1, jam: 2, standstill: 3 };
export function routeReport(key, jams, spillbacks, events) {
    const own = jams.filter(j => j.pathKey === key);
    const shared = spillbacks.filter(s => s.source === key);
    const ownVehicles = own.reduce((sum, j) => sum + j.queueVehicles, 0);
    const sharedRampVehicles = shared.reduce((sum, s) => sum + s.queuedVehiclesOnMotorway, 0);
    // This count is a physical LOCATION count, not extra vehicles created in the simulator.
    const queueVehicles = ownVehicles + sharedRampVehicles;
    const maxLength = Math.max(0, ...own.map(j => j.visibleQueueM), ...shared.map(s => s.lengthM));
    const bottleneck = pathBottleneck(key, events);
    const cap = Math.min(bottleneck.capacityVph, ...own.filter(j => !j.released).map(j => j.capacityVph));
    // A blocked off-ramp must not lend its (possibly unbounded) wait to cars
    // travelling straight ahead. Only queues owned by this roadway delay them.
    // Queued ramp vehicles are still reported at their physical location.
    const throughDelays = own.map(j => j.delayMin);
    const exitDelays = shared.map(s => s.delayMin);
    const delayMin = throughDelays.some(d => d === null) ? null : Math.max(0, ...throughDelays.filter((d) => d !== null));
    const exitDelayMin = exitDelays.some(d => d === null) ? null : Math.max(0, ...exitDelays.filter((d) => d !== null));
    const color = [...own.map(j => j.color), ...shared.map(s => s.color)]
        .reduce((c, next) => rank[next] > rank[c] ? next : c, 'free');
    return { key, ownVehicles, sharedRampVehicles, queueVehicles, queueKm: maxLength / 1000,
        delayMin, exitDelayMin, capacityVph: cap, color, countedQueueIds: own.map(j => j.id) };
}
