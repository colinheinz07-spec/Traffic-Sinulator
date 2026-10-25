import { cellQueueSpans } from './traffic-cells.js?build=e5dc2a5d589428ef';
import { closureGate } from './spatial.js?build=e5dc2a5d589428ef';
import { diversionJunctions, nearestExitBeforeQueue, potentialDiversionPercent } from './diversions.js?build=e5dc2a5d589428ef';
import { speedDelayInCells } from './speed-delay.js?build=e5dc2a5d589428ef';
import { freeSpeedKmh } from './traffic-physics.js?build=e5dc2a5d589428ef';
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
    if (delayMin < 45 - 1e-9 || !Number.isFinite(delayMin))
        return 0;
    delayMin = Math.max(45, delayMin);
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
    const sourceEnd = cross ? config.sourceEndM ?? route.lengthM : config.toM;
    const approachEnd = gate?.metre ?? sourceEnd;
    const upstreamRank = route.key.startsWith('ramp-') ? 0 : diversionJunctions(path, exits, route)
        .filter(j => !j.isInterchange && j.metre > config.fromM + 25 && j.metre <= approachEnd + 25).length + 1;
    if (gate && config.fromM >= gate.metre - 25)
        return { percent: 0, mandatory: false, delayMin: 0, upstreamRank };
    const service = Math.max(1, Math.min(1200, config.geometry.roadCapacityVph));
    const normal = gate ? entries.find(e => e.enabled !== false && e.config.path === path && Math.abs(e.config.fromM - gate.metre) <= 25 &&
        requiredDiversionGate(e.config, route, events, exits)) : undefined;
    const gateService = Math.max(1, Math.min(1200, normal?.config.geometry.roadCapacityVph ?? service));
    const motorwayFree = gate ? (gate.metre - config.fromM) / 1000 / freeSpeedKmh(path) * 60 +
        (normal?.config.geometry.freeMinutes ?? 0) : cross ? (sourceEnd - config.fromM) / 1000 / freeSpeedKmh(path) * 60 +
        (config.toM - (config.targetEntryM ?? 0)) / 1000 / freeSpeedKmh(target) * 60 :
        (config.toM - config.fromM) / 1000 / freeSpeedKmh(path) * 60;
    const extra = Math.max(0, config.geometry.freeMinutes - motorwayFree) +
        (state.waitingRoad + state.waitingMerge) / service * 60;
    const spans = cellQueueSpans(source);
    const eligible = (tail, end) => {
        const nearest = nearestExitBeforeQueue(path, route, exits, tail, approachEnd);
        return config.fromM >= (nearest?.metre ?? tail) - 25 && config.fromM <= end + 25;
    };
    const measuredLoss = (grid, start, end, rate = service) => {
        const loss = speedDelayInCells(grid, start, end, end + grid.cellM);
        return loss.blocked ? Math.max(loss.delayMin, excessQueue(grid, start, end, demands[grid.pathKey] ?? 0) / rate * 60) : loss.delayMin;
    };
    let delayMin = 0, desired = 0;
    const consider = (loss) => {
        const percent = voluntaryDiversionPercent(loss, extra);
        if (percent > desired || percent === desired && loss > delayMin) {
            desired = percent;
            delayMin = loss;
        }
    };
    for (const span of spans) {
        const end = Math.min(span.toM, gate ? gate.metre + source.cellM : sourceEnd);
        const start = Math.max(span.fromM, config.fromM);
        if (start >= end || !eligible(span.fromM, end) || !cross && !gate && config.toM < span.toM - 1)
            continue;
        let loss = measuredLoss(source, start, end, gate ? gateService : service);
        if (gate && span.toM >= gate.metre - source.cellM) {
            loss += (normal ? normal.state.waitingRoad + normal.state.waitingMerge : 0) / gateService * 60;
        }
        consider(loss);
    }
    if (cross) {
        // Each approaching motorway has its own nearest exit. A queue on A3
        // cannot activate every A48 exit simply because all would avoid it.
        const approach = spans.find(s => s.fromM < sourceEnd && s.toM >= sourceEnd - source.cellM);
        const tail = approach?.fromM ?? sourceEnd;
        if (eligible(tail, sourceEnd))
            for (const span of cellQueueSpans(destination)) {
                const start = Math.max(span.fromM, config.targetEntryM ?? 0), end = Math.min(span.toM, config.toM);
                if (start >= end || config.toM < span.toM - 1)
                    continue;
                const sourceLoss = approach ? measuredLoss(source, Math.max(config.fromM, approach.fromM), sourceEnd) : 0;
                consider(sourceLoss + measuredLoss(destination, start, end));
            }
    }
    // A newly selected exit adopts a high target gradually. Remember this
    // only when advancing a model minute; redraw/pause cannot raise it.
    const percent = Math.min(desired, (state.choicePercent ?? 0) + 5);
    return { percent, mandatory: false, delayMin, upstreamRank };
}
