/** Motorway cells and multiple local simulator routes share ONE vehicle budget.
 * Side-road admission is limited by cars reaching the real exit cell; cars
 * return only after their local journey and when the merge accepts them.
 */
import { advanceCells, cellInventory } from './traffic-cells.js?build=b0a387e5cb5e18cc';
import { advanceDetour, detourVehicles } from './detour-flow.js?build=b0a387e5cb5e18cc';
import { routedDiversionChoice } from './diversion-policy.js?build=b0a387e5cb5e18cc';
export function detourReadyToReturn(state, minute) {
    return state.waitingMerge + state.transit.filter(x => x.minute <= minute).reduce((n, x) => n + x.vehicles, 0);
}
export function advanceRoutedPath(previous, route, events, demandVph, exits, detours) {
    const ports = detours.map(entry => {
        const { config, state } = entry;
        const wanted = routedDiversionChoice(entry, detours, { [route.key]: previous }, { [route.key]: route }, events, exits, { [route.key]: demandVph }).percent;
        const storage = Math.max(80, config.geometry.lengthKm * 90);
        return { id: config.id, fromM: config.fromM, toM: config.exitsNetwork ? null : config.toM, interestPercent: wanted,
            exitCapacityVph: Math.min(1200, Math.max(0, storage - detourVehicles(state)) * 60),
            returnVehicles: config.exitsNetwork ? 0 : detourReadyToReturn(state, previous.minute) };
    });
    const cells = advanceCells(previous, route, events, demandVph, exits, ports);
    const updated = detours.map(entry => {
        const actual = cells.lastTransfers.find(x => x.id === entry.config.id);
        const flow = advanceDetour(entry.state, entry.config, previous.minute, actual.leaveVpm * 60, 100, actual.joinVpm * 60);
        if (Math.abs(flow.entered - actual.leaveVpm) > 1e-6 || Math.abs(flow.rejoined - actual.joinVpm) > 1e-6)
            throw Error('Hauptfahrbahn und Umleitung widersprechen sich beim Fahrzeugtransfer');
        return { ...entry, state: flow.state, desiredPercent: ports.find(p => p.id === entry.config.id).interestPercent };
    });
    const before = cellInventory(previous) + detours.reduce((n, e) => n + detourVehicles(e.state), 0);
    const after = cellInventory(cells) + updated.reduce((n, e) => n + detourVehicles(e.state), 0);
    const networkExits = updated.reduce((n, e, i) => n + (e.state.exitedNetworkTotal ?? 0) - (detours[i].state.exitedNetworkTotal ?? 0), 0);
    const expected = before + (cells.offeredTotal - previous.offeredTotal) - (cells.exitedTotal - previous.exitedTotal) - networkExits;
    if (Math.abs(after - expected) > 1e-5 * Math.max(1, expected))
        throw Error('Gemeinsame Hauptfahrbahn-/Umleitungsbilanz verletzt');
    return { cells, detours: updated, transfers: cells.lastTransfers.map((x, i) => ({
            ...x, path: route.key, fromM: detours[i].config.fromM, toM: detours[i].config.toM
        })) };
}
/** Network variant also supports leaving A48 and returning on A3 (or the
 * reverse) via a side-road route that bypasses AD Dernbach.
 */
export function advanceRoutedNetwork(previous, routes, events, demands, exits, detours) {
    const ports = new Map();
    const add = (path, port) => ports.set(path, [...(ports.get(path) ?? []), port]);
    for (const entry of detours) {
        const { config, state } = entry, target = config.targetPath ?? config.path;
        const sourceGrid = previous[config.path], targetGrid = previous[target];
        if (!sourceGrid || !targetGrid)
            throw Error('Umleitung hat keinen verbundenen Fahrbahnzustand');
        const cross = target !== config.path;
        const interest = routedDiversionChoice(entry, detours, previous, routes, events, exits, demands).percent;
        const capacity = Math.min(1200, Math.max(0, Math.max(80, config.geometry.lengthKm * 90) - detourVehicles(state)) * 60);
        add(config.path, { id: config.id, fromM: config.fromM, toM: cross || config.exitsNetwork ? null : config.toM,
            interestPercent: interest, exitCapacityVph: capacity, returnVehicles: cross || config.exitsNetwork ? 0 : detourReadyToReturn(state, sourceGrid.minute) });
        if (cross && !config.exitsNetwork)
            add(target, { id: config.id, fromM: null, toM: config.toM, interestPercent: 0,
                exitCapacityVph: 0, returnVehicles: detourReadyToReturn(state, targetGrid.minute) });
    }
    const cells = {};
    for (const key of Object.keys(previous))
        cells[key] = advanceCells(previous[key], routes[key], events, demands[key], exits, ports.get(key) ?? []);
    const transfers = [];
    const updated = detours.map(entry => {
        const { config } = entry, target = config.targetPath ?? config.path, cross = target !== config.path;
        const left = cells[config.path].lastTransfers.find(x => x.id === config.id)?.leaveVpm ?? 0;
        const joined = config.exitsNetwork ? 0 : cells[target].lastTransfers.find(x => x.id === config.id)?.joinVpm ?? 0;
        const result = advanceDetour(entry.state, config, previous[config.path].minute, left * 60, 100, joined * 60);
        if (Math.abs(result.entered - left) > 1e-6 || Math.abs(result.rejoined - joined) > 1e-6)
            throw Error('Vernetzte Umleitung hat Fahrzeuge dupliziert oder verloren');
        transfers.push({ id: config.id, path: config.path, fromM: config.fromM,
            toM: cross ? routes[config.path].lengthM : config.toM, leaveVpm: left, joinVpm: cross ? 0 : joined });
        if (cross && !config.exitsNetwork)
            transfers.push({ id: config.id + ':return', path: target, fromM: 0, toM: config.toM, leaveVpm: 0, joinVpm: joined });
        return { ...entry, state: result.state, desiredPercent: ports.get(config.path).find(p => p.id === config.id).interestPercent };
    });
    let before = detours.reduce((n, e) => n + detourVehicles(e.state), 0), after = updated.reduce((n, e) => n + detourVehicles(e.state), 0), arrived = 0, left = 0;
    for (const key of Object.keys(cells)) {
        before += cellInventory(previous[key]);
        after += cellInventory(cells[key]);
        arrived += cells[key].offeredTotal - previous[key].offeredTotal;
        left += cells[key].exitedTotal - previous[key].exitedTotal;
    }
    const networkExits = updated.reduce((n, e, i) => n + (e.state.exitedNetworkTotal ?? 0) - (detours[i].state.exitedNetworkTotal ?? 0), 0);
    if (Math.abs(after - before - arrived + left + networkExits) > 1e-5 * Math.max(1, after))
        throw Error('Gemeinsame A3/A48-/Umleitungsbilanz verletzt');
    return { cells, detours: updated, transfers };
}
