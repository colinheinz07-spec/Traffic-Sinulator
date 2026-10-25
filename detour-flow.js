export function emptyDetour(config) {
    if (!(config.targetPath && config.targetPath !== config.path ? config.toM >= 0 : config.toM > config.fromM) || config.id !== config.geometry.id || config.path !== config.geometry.path)
        throw Error('Umleitungsanschlüsse ungültig oder falsche Richtung');
    return { id: config.id, minute: 0, waitingRoad: 0, waitingMerge: 0, transit: [], admittedTotal: 0, returnedTotal: 0,
        lastDeparture: 0, lastRejoined: 0, choicePercent: 0 };
}
export function detourVehicles(state) {
    return state.waitingRoad + state.waitingMerge + state.transit.reduce((n, a) => n + a.vehicles, 0);
}
export function detourStorage(config) {
    return config.geometry.storageVehicles ?? Math.max(80, config.geometry.lengthKm * 90);
}
export function advanceDetour(state, config, minute, motorwayDemandVph, interestPercent, remainingMergeCapacityVph, availableRoadServiceVph = config.geometry.roadCapacityVph) {
    if (state.id !== config.id || !Number.isFinite(motorwayDemandVph) || motorwayDemandVph < 0 ||
        !Number.isFinite(interestPercent) || interestPercent < 0 || interestPercent > 100 ||
        !Number.isFinite(remainingMergeCapacityVph) || remainingMergeCapacityVph < 0 ||
        !Number.isFinite(availableRoadServiceVph) || availableRoadServiceVph < 0)
        throw Error('Umleitungszustand oder Zufluss ungültig');
    if (minute < state.minute || !Number.isInteger(minute))
        throw Error('Umleitungszeit rückwärts');
    const d = config.geometry;
    // Capacity of an exit ramp and the side road are separate constraints.
    const maxLocalStorage = detourStorage(config);
    const wanted = motorwayDemandVph / 60 * interestPercent / 100;
    const admitted = Math.min(wanted, 1200 / 60, Math.max(0, maxLocalStorage - detourVehicles(state)));
    // Junctions and actual tagged signals already reduce the routed capacity.
    // Avoid a fictional sine-wave traffic light shared by every vehicle.
    const capacity = Math.min(d.roadCapacityVph, Math.max(0, availableRoadServiceVph));
    const service = Math.min(state.waitingRoad + admitted, capacity / 60);
    const roadQueue = Math.max(0, state.waitingRoad + admitted - service);
    const travelMinutes = Math.max(d.source === 'osm-motorway-ramp' ? 1 : 2, Math.ceil(d.freeMinutes));
    const due = minute + travelMinutes;
    const transit = state.transit.map(x => ({ ...x }));
    if (service > 0)
        transit.push({ minute: due, vehicles: service });
    let ready = state.waitingMerge;
    const pending = transit.filter(x => {
        if (x.minute <= minute) {
            ready += x.vehicles;
            return false;
        }
        return true;
    });
    // The return ramp has its own queue. A busy mainline can delay merging
    // without causing vehicles to teleport back upstream on the local route.
    const exitedNetwork = config.exitsNetwork ? ready : 0;
    const mergeService = config.exitsNetwork ? 0 : Math.min(ready, remainingMergeCapacityVph / 60);
    const waitingMerge = Math.max(0, ready - mergeService - exitedNetwork);
    const next = { id: state.id, minute: minute + 1, waitingRoad: roadQueue, waitingMerge, transit: pending,
        admittedTotal: state.admittedTotal + admitted, returnedTotal: state.returnedTotal + mergeService,
        lastDeparture: admitted, lastRejoined: mergeService,
        choicePercent: state.choicePercent ?? 0,
        travelFlowVph: (state.travelFlowVph ?? Math.min(capacity, remainingMergeCapacityVph)) * Math.exp(-1 / 6) +
            mergeService * 60 * (1 - Math.exp(-1 / 6)),
        exitedNetworkTotal: (state.exitedNetworkTotal ?? 0) + exitedNetwork, lastExitedNetwork: exitedNetwork };
    if (Math.abs(next.admittedTotal - next.returnedTotal - (next.exitedNetworkTotal ?? 0) - detourVehicles(next)) > 1e-5)
        throw Error('Umleitungs-Fahrzeugbilanz verletzt');
    return {
        state: next, entered: admitted, rejoined: mergeService, capacityVph: capacity,
        roadDelayMin: capacity <= 0 && roadQueue > 0 || remainingMergeCapacityVph <= 0 && waitingMerge > 0 ? null :
            roadQueue / (capacity / 60) + d.freeMinutes +
                (waitingMerge > 0 ? waitingMerge / Math.max(.01, remainingMergeCapacityVph / 60) : 0),
        remainingOnMotorway: Math.max(0, motorwayDemandVph / 60 - admitted),
        transfer: { id: config.id, path: config.path, fromM: config.fromM, toM: config.toM,
            leaveVpm: admitted, joinVpm: mergeService }
    };
}
