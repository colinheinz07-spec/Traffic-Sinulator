import { cellSpeedBands, cellCriticalDensity } from './traffic-cells.js?build=b0a387e5cb5e18cc';
import { closureGate, positionM } from './spatial.js?build=b0a387e5cb5e18cc';
import { diversionJunctions, potentialDiversionPercent } from './diversions.js?build=b0a387e5cb5e18cc';
import { speedDelayInCells } from './speed-delay.js?build=b0a387e5cb5e18cc';
import { freeSpeedKmh } from './traffic-physics.js?build=b0a387e5cb5e18cc';
/** A formal closure requires a working route at its exit even when that
 * route was paused for an earlier incident. A return inside the closed
 * section cannot serve as the mandatory route. */
export function requiredDiversionGate(config, route, events, exits) {
    if ((config.targetPath ?? config.path) !== config.path)
        return null;
    for (const event of events) {
        const gate = closureGate(route, event, exits);
        if (gate?.exit && Math.abs(config.fromM - gate.metre) <= 25 &&
            (config.exitsNetwork || config.toM >= gate.endM - 1))
            return gate;
    }
    return null;
}
/** Small uptake at 45 minutes, rising with delay. A costly/full bypass
 * reduces willingness. Neither incident age nor a blocked-speed flag is
 * interpreted as infinite delay or as a mandatory off-ramp movement.
 */
export function voluntaryDiversionPercent(delayMin, extraMinutes = 0) {
    if (delayMin < 45 || !Number.isFinite(delayMin))
        return 0;
    const saving = Math.max(0, delayMin - Math.max(0, extraMinutes)) / delayMin;
    return Math.round((potentialDiversionPercent(delayMin, false) ?? 0) * saving * 10) / 10;
}
function excessQueue(state, fromM, toM, demandVph) {
    const freeDensity = demandVph / freeSpeedKmh(state.pathKey);
    let vehicles = 0;
    for (const cell of state.cells) {
        const length = Math.max(0, Math.min(toM, cell.toM) - Math.max(fromM, cell.fromM));
        if (length <= 0 || cell.speedKmh > 65)
            continue;
        vehicles += Math.max(0, cell.vehicles - freeDensity * (cell.toM - cell.fromM) / 1000) * length / (cell.toM - cell.fromM);
    }
    return vehicles;
}
/** First AS before the actual queue; all downstream AS remain usable too,
 * including those now inside it. A backed-up target motorway recruits only
 * the last source AS before its AD until the source queue spreads further.
 */
export function firstDiversionExit(state, route, exits, approachEndM, backedUpConnection = false) {
    if (route.key.startsWith('ramp-'))
        return null;
    const junctions = diversionJunctions(route.key, exits, route)
        .filter(j => !j.isInterchange && j.metre <= approachEndM + 25);
    if (!junctions.length)
        return null;
    const bands = cellSpeedBands(state).filter(b => b.fromM < approachEndM + state.cellM);
    // Only follow the queue connected to this bottleneck. Taking the minimum
    // over ALL upstream bands also picks isolated off-ramp queues: their
    // diverted cars would then recruit the next remote AS recursively.
    // Moving packets may bridge color gaps only while their density still
    // belongs to the queue. Even one genuinely free cell separates queues.
    let root = -1;
    for (let i = bands.length - 1; i >= 0; i--)
        if (bands[i].toM >= approachEndM - state.cellM &&
            bands[i].fromM <= approachEndM + state.cellM) {
            root = i;
            break;
        }
    if (root < 0)
        return backedUpConnection ? junctions.at(-1).metre : null;
    let tail = bands[root].fromM;
    for (let i = root - 1; i >= 0; i--) {
        const band = bands[i];
        if (tail - band.toM > state.cellM + 1)
            break;
        if (tail - band.toM > .1 && state.cells.some(c => c.toM > band.toM + .1 && c.fromM < tail - .1 &&
            c.densityVehKm < cellCriticalDensity(state.pathKey) * 1.10))
            break;
        tail = band.fromM;
    }
    // At approximately 500 m resolution, the previous AS joins only when
    // the visible congested cells actually cover the current AS.
    return (junctions.filter(j => j.metre < tail - .1).at(-1) ?? junctions[0]).metre;
}
export function routedDiversionChoice(entry, entries, cells, routes, events, exits, demands) {
    const { config, state } = entry, path = config.path, target = config.targetPath ?? path;
    const source = cells[path], destination = cells[target], route = routes[path];
    if (!source || !destination || !route)
        throw Error('Umleitungsentscheidung ohne verbundenen Fahrbahnzustand');
    const event = events.find(e => e.id === config.eventId), cross = target !== path;
    const gate = event?.kind === 'closure' && !cross ? closureGate(route, event, exits) : null;
    const mandatory = requiredDiversionGate(config, route, events, exits) !== null;
    if (mandatory) {
        // Retain old route inventories, but admit new traffic to exactly one
        // usable route. If all were paused, the formal closure still exits cars.
        const preferred = entries.filter(e => e.config.path === path &&
            Math.abs(e.config.fromM - config.fromM) <= 25 && requiredDiversionGate(e.config, route, events, exits))
            .sort((a, b) => Number(a.enabled === false) - Number(b.enabled === false) ||
            b.config.toM - a.config.toM || a.config.id.localeCompare(b.config.id))[0];
        return { percent: preferred?.config.id === config.id ? 100 : 0, mandatory: true, delayMin: 0, upstreamRank: 0 };
    }
    if (entry.enabled === false)
        return { percent: 0, mandatory: false, delayMin: 0, upstreamRank: 0 };
    const eventM = event && event.pathKey === path ? positionM(route, event.point) : null;
    const approachEnd = gate?.metre ?? (cross ? config.sourceEndM ?? route.lengthM : eventM ?? config.toM);
    const backedUpConnection = cross && cellSpeedBands(destination).some(b => b.fromM <= (config.targetEntryM ?? 0) && b.toM >= (config.targetEntryM ?? 0));
    const firstExit = firstDiversionExit(source, route, exits, approachEnd, backedUpConnection);
    const upstreamRank = route.key.startsWith('ramp-') ? 0 : diversionJunctions(path, exits, route)
        .filter(j => !j.isInterchange && j.metre > config.fromM + 25 && j.metre <= approachEnd + 25).length + 1;
    const eligible = firstExit !== null && config.fromM >= firstExit - 25 && config.fromM <= approachEnd + 25;
    // Cars still reaching an AS inside the queue have already suffered part
    // of its delay. Use the same full queue disadvantage for all recruited
    // exits, so extending the tail does not turn the previously used AS off.
    const decisionFrom = Math.min(config.fromM, firstExit ?? config.fromM);
    if (gate && config.fromM < gate.metre) {
        const normal = entries.find(e => e.enabled !== false && e.config.path === path && e.config.eventId === config.eventId &&
            (e.config.targetPath ?? path) === path && Math.abs(e.config.fromM - gate.metre) <= 25);
        const service = Math.max(1, Math.min(1200, normal?.config.geometry.roadCapacityVph ?? config.geometry.roadCapacityVph));
        const measured = speedDelayInCells(source, decisionFrom, Math.min(route.lengthM, gate.metre + source.cellM));
        const approachWait = measured.diversionExitRef && !measured.blocked ? measured.delayMin :
            excessQueue(source, decisionFrom, gate.metre, demands[path] ?? 0) / service * 60;
        const offRampWait = normal ? (normal.state.waitingRoad + normal.state.waitingMerge) / service * 60 : 0;
        const normalFree = (gate.metre - config.fromM) / 1000 / freeSpeedKmh(path) * 60 +
            (normal?.config.geometry.freeMinutes ?? 0);
        const ownWait = (state.waitingRoad + state.waitingMerge) / Math.max(1, config.geometry.roadCapacityVph) * 60;
        const extra = Math.max(0, config.geometry.freeMinutes - normalFree) + ownWait;
        // The working mandatory exit is the reference, not the prohibited road.
        const delayMin = approachWait + offRampWait;
        return { percent: eligible ? voluntaryDiversionPercent(delayMin, extra) : 0, mandatory: false, delayMin, upstreamRank };
    }
    const sourceEnd = cross ? config.sourceEndM ?? route.lengthM : config.toM;
    const first = speedDelayInCells(source, decisionFrom, sourceEnd);
    const last = cross ? speedDelayInCells(destination, config.targetEntryM ?? 0, config.toM) : null;
    const service = Math.max(1, Math.min(1200, config.geometry.roadCapacityVph));
    const queueWait = (excessQueue(source, decisionFrom, sourceEnd, demands[path] ?? 0) +
        (cross ? excessQueue(destination, config.targetEntryM ?? 0, config.toM, demands[target] ?? 0) : 0)) / service * 60;
    const delayMin = Math.max(first.delayMin + (last?.delayMin ?? 0), queueWait);
    const motorwayFree = cross ? (sourceEnd - config.fromM) / 1000 / freeSpeedKmh(path) * 60 +
        (config.toM - (config.targetEntryM ?? 0)) / 1000 / freeSpeedKmh(target) * 60 :
        (config.toM - config.fromM) / 1000 / freeSpeedKmh(path) * 60;
    const extra = Math.max(0, config.geometry.freeMinutes - motorwayFree) +
        (state.waitingRoad + state.waitingMerge) / service * 60;
    return { percent: eligible ? voluntaryDiversionPercent(delayMin, extra) : 0, mandatory: false, delayMin, upstreamRank };
}
