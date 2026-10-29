/** One snapshot for map geometry, jam cards and direction summaries.
 * Mainline queues are measured on the same congested CTM cells as the map.
 * Legacy queues remain the simulation input for the separate ramp ledger;
 * their synthetic lengths never truncate a mainline display queue.
 */
import { PATHS, baselineCapacity } from './traffic.js?build=320aeaf18baab650';
import { routeSlice } from './spatial.js?build=320aeaf18baab650';
import { cellSpeedBands, cellQueueSpans } from './traffic-cells.js?build=320aeaf18baab650';
import { physicalSpeedBands, stopAndGoBands, resolveSpeedBands, freeSpeedKmh, colorAtSpeed } from './traffic-physics.js?build=320aeaf18baab650';
import { speedDelayInCells, speedDelayInBands, queueTravelHeads } from './speed-delay.js?build=320aeaf18baab650';
import { routeReport } from './network-report.js?build=320aeaf18baab650';
import { positionM } from './spatial.js?build=320aeaf18baab650';
function extents(bands) {
    const groups = [];
    for (const b of bands) {
        if (b.color === 'free' || b.toM - b.fromM < .1)
            continue;
        const last = groups.at(-1);
        if (last && b.fromM <= last.toM + .1) {
            last.toM = Math.max(last.toM, b.toM);
            last.bands.push(b);
        }
        else
            groups.push({ fromM: b.fromM, toM: b.toM, bands: [b] });
    }
    return groups;
}
function lengthM(bands) {
    return extents(resolveSpeedBands(bands)).reduce((n, g) => n + g.toM - g.fromM, 0);
}
function bandMeanSpeed(bands, fallback) {
    const length = bands.reduce((n, b) => n + b.toM - b.fromM, 0);
    return length > 0 ? bands.reduce((n, b) => n + (b.toM - b.fromM) * b.speedKmh, 0) / length : fallback;
}
function addDelay(a, b) {
    const forecast = a.forecastWaitMin !== undefined || b.forecastWaitMin !== undefined;
    return { delayMin: a.delayMin + b.delayMin - (forecast ? Math.min(a.forecastWaitMin ?? 0, b.forecastWaitMin ?? 0) : 0), blocked: a.blocked || b.blocked,
        assessedKm: a.assessedKm + b.assessedKm, stoppedKm: a.stoppedKm + b.stoppedKm,
        ...(a.diversionExitRef || b.diversionExitRef ? { diversionExitRef: a.diversionExitRef ?? b.diversionExitRef } : {}),
        ...(forecast ? { forecastWaitMin: Math.max(a.forecastWaitMin ?? 0, b.forecastWaitMin ?? 0) } : {}) };
}
/** Clearing cells inside a stop-and-go wave are not a second incident.
 * Fragments served by the same observed bottleneck retain one card. Count only
 * colored lengths and their individual travel losses. Keep the true
 * geographic span for card positioning; the solver gets raw sections. */
function joinWaveFragments(jams, cellM) {
    const joined = [];
    for (const jam of [...jams].reverse()) {
        const next = joined.at(-1), gap = next ? next.anchorM - next.visibleQueueM - jam.anchorM : Infinity;
        const differentOwners = jam.queueOwnerId && next?.queueOwnerId && jam.queueOwnerId !== next.queueOwnerId;
        const sameHead = jam.waveHeadM !== undefined && jam.waveHeadM === next?.waveHeadM;
        const unassigned = jam.waveHeadM === undefined && next?.waveHeadM === undefined;
        if (next && next.pathKey === jam.pathKey && !differentOwners && gap >= 0 && (sameHead || unassigned && gap <= cellM + .1)) {
            const delay = addDelay(jam.delay, next.delay), speedKmh = Math.min(jam.speedKmh, next.speedKmh);
            joined[joined.length - 1] = { ...next, eventId: next.eventId ?? jam.eventId,
                queueOwnerId: next.queueOwnerId ?? jam.queueOwnerId, eventKind: next.eventKind ?? jam.eventKind,
                waveHeadM: next.waveHeadM ?? jam.waveHeadM,
                queueM: next.queueM + jam.queueM, visibleQueueM: next.anchorM - (jam.anchorM - jam.visibleQueueM),
                queueVehicles: next.queueVehicles + jam.queueVehicles, feederM: next.feederM + jam.feederM,
                meanSpeedKmh: (next.meanSpeedKmh * next.queueVehicles + jam.meanSpeedKmh * jam.queueVehicles) /
                    Math.max(1e-9, next.queueVehicles + jam.queueVehicles),
                delay, delayMin: delay.blocked ? null : delay.delayMin, speedKmh, color: colorAtSpeed(speedKmh) };
        }
        else
            joined.push(jam);
    }
    return joined.reverse();
}
export function trafficView(legacy, cells, corridors, events, spills, minute) {
    const bands = new Map(), spillBands = new Map();
    const jams = [], reports = {}, delays = {};
    const overflow = new Map();
    for (const spill of spills) {
        const parent = legacy.find(j => j.pathKey === spill.rampId && j.id === spill.id);
        if (!parent)
            continue;
        const mapped = stopAndGoBands({ id: parent.id, pathKey: spill.source, anchorM: spill.toM,
            queueM: spill.toM - spill.fromM, speedKmh: parent.speedKmh, speedHistory: parent.speedHistory,
            offsetBackM: corridors[spill.rampId].lengthM }, minute);
        overflow.set(spill.rampId + '|' + spill.id, mapped);
        spillBands.set(spill.source, [...(spillBands.get(spill.source) ?? []), ...mapped]);
    }
    for (const [key, value] of spillBands)
        spillBands.set(key, resolveSpeedBands(value));
    for (const path of PATHS) {
        const state = cells[path], route = corridors[path], own = legacy.filter(j => j.pathKey === path);
        const queueSpans = state ? cellQueueSpans(state) : [];
        const serviceHeads = state ? queueTravelHeads(state) : undefined;
        const queueBands = resolveSpeedBands(state ? cellSpeedBands(state) : own.flatMap(jam => [
            ...physicalSpeedBands(jam).filter(b => b.source === 'approach'),
            ...stopAndGoBands(jam, minute)
        ]));
        const restrictions = [];
        for (const event of events) {
            if (event.pathKey !== path || event.kind === 'closure')
                continue;
            const at = positionM(route, event.point);
            if (at === null)
                continue;
            const speedKmh = Math.min(freeSpeedKmh(path), event.settings.speedKmh);
            restrictions.push({ fromM: at, toM: Math.min(route.lengthM, at + event.settings.lengthM),
                speedKmh, color: colorAtSpeed(speedKmh), source: 'restriction' });
        }
        // A posted maximum is not a speed observation. Show measured cell flow
        // within the worksite even before it reaches queued density; keep these
        // bands separate from queueBands so a lower speed alone adds no jam km.
        if (state)
            for (const restriction of [...restrictions])
                for (const cell of state.cells) {
                    const fromM = Math.max(restriction.fromM, cell.fromM), toM = Math.min(restriction.toM, cell.toM);
                    if (toM <= fromM || cell.vehicles < .01 || cell.speedKmh >= restriction.speedKmh)
                        continue;
                    restrictions.push({ fromM, toM, speedKmh: cell.speedKmh, color: colorAtSpeed(cell.speedKmh), source: 'restriction' });
                }
        const mapped = resolveSpeedBands([...restrictions, ...queueBands]);
        bands.set(path, mapped);
        let ownVehicles = 0;
        for (const group of extents(queueBands)) {
            // Associate the card with an incident without ever clipping its geometry
            // to the old incident queue. Joined incidents produce one physical jam.
            const roots = own.map(j => ({ jam: j, overlap: Math.max(0, Math.min(j.anchorM, group.toM) -
                    Math.max(j.anchorM - j.visibleQueueM, group.fromM)) }))
                .filter(x => x.overlap > 0).sort((a, b) => b.overlap - a.overlap ||
                Math.abs(a.jam.anchorM - group.toM) - Math.abs(b.jam.anchorM - group.toM));
            const root = roots[0]?.jam;
            const event = events.find(e => e.id === root?.id);
            const spill = root && spills.find(s => s.rampId === path && s.id === root.id &&
                root.anchorM >= group.fromM - .1 && root.anchorM <= group.toM + .1);
            const feederBands = spill ? (overflow.get(path + '|' + spill.id) ?? []) : [];
            const feederM = lengthM(feederBands);
            const approach = queueSpans.find(s => s.fromM <= group.fromM + .1 && s.toM >= group.toM - .1);
            const firstCell = state?.cells.find(c => c.toM > group.fromM + .1);
            const head = firstCell ? serviceHeads?.get(firstCell.toM) : undefined;
            // Retain the observed service across released braking-wave gaps. A
            // zero-flow reopening forecast, however, belongs only to its own queue.
            const forecast = head?.reopeningForecast !== undefined;
            const detectorEnd = forecast ? (approach?.toM ?? group.toM) + (state?.cellM ?? 0) : Infinity;
            const localDelay = state ? speedDelayInCells(state, group.fromM, group.toM, detectorEnd) : speedDelayInBands(path, group.bands);
            const delay = spill ? addDelay(localDelay, speedDelayInBands(spill.source, feederBands)) : localDelay;
            const speedKmh = Math.min(...group.bands.map(b => b.speedKmh), ...feederBands.map(b => b.speedKmh));
            const vehicles = state ? state.cells.reduce((n, c) => {
                const overlap = Math.max(0, Math.min(c.toM, group.toM) - Math.max(c.fromM, group.fromM));
                return n + c.vehicles * overlap / (c.toM - c.fromM);
            }, 0) : roots.reduce((n, r) => n + r.jam.queueVehicles * r.overlap / Math.max(.1, r.jam.visibleQueueM), 0);
            const meanSpeedKmh = state && vehicles > 0 ? state.cells.reduce((n, c) => {
                const overlap = Math.max(0, Math.min(c.toM, group.toM) - Math.max(c.fromM, group.fromM));
                return n + c.vehicles * overlap / (c.toM - c.fromM) * c.speedKmh;
            }, 0) / vehicles : bandMeanSpeed([...group.bands, ...feederBands], speedKmh);
            ownVehicles += vehicles;
            const point = routeSlice(route, Math.max(0, group.toM - 1), group.toM)[0] ?? route.points.at(-1);
            const waveHeadM = forecast ? approach?.toM : head?.toM;
            // Backpressure at an AD merge belongs to THIS connected queue. A
            // separate accident elsewhere on the same motorway may still have
            // zero capacity after this head reopens. The route-wide minimum would
            // falsely keep this ramp blocked and grow its feeder queue indefinitely.
            // Released heads recover their own road capacity; an uncontrolled
            // local queue cannot borrow a distant restriction through a free gap.
            const serviceCapacity = state ? head?.travelDetector?.capacityVph ?? baselineCapacity(path) : root?.capacityVph ?? 0;
            jams.push({ id: 'display:' + path + ':' + Math.round(group.toM), eventId: event?.id, queueOwnerId: root?.id, waveHeadM,
                pathKey: path, eventKind: event?.kind ?? null, point, anchorM: group.toM,
                queueVehicles: vehicles, queueM: group.toM - group.fromM + feederM,
                visibleQueueM: group.toM - group.fromM, delayMin: delay.blocked ? null : delay.delayMin,
                capacityVph: serviceCapacity, speedKmh, meanSpeedKmh, color: colorAtSpeed(speedKmh),
                released: root?.released ?? false, outOfBoundsM: 0, delay, feederM });
        }
        let delay = state ? speedDelayInCells(state) : speedDelayInBands(path, mapped);
        if (path.startsWith('ramp-'))
            for (const spill of spills.filter(s => s.rampId === path)) {
                delay = addDelay(delay, speedDelayInBands(spill.source, overflow.get(path + '|' + spill.id) ?? []));
            }
        const base = routeReport(path, legacy, spills, events);
        const speedKmh = Math.min(freeSpeedKmh(path), ...mapped.filter(b => b.color !== 'free').map(b => b.speedKmh));
        const queueM = path.startsWith('ramp-') ? lengthM(queueBands) + spills.filter(s => s.rampId === path)
            .reduce((n, s) => n + lengthM(overflow.get(path + '|' + s.id) ?? []), 0) :
            lengthM([...queueBands, ...(spillBands.get(path) ?? [])]);
        const ownJams = jams.filter(j => j.pathKey === path), ownStock = ownJams.reduce((n, j) => n + j.queueVehicles, 0);
        const meanSpeedKmh = ownStock > 0 ? ownJams.reduce((n, j) => n + j.meanSpeedKmh * j.queueVehicles, 0) / ownStock : speedKmh;
        reports[path] = { ...base, queueKm: queueM / 1000,
            ...(state ? { ownVehicles, queueVehicles: ownVehicles + base.sharedRampVehicles } : {}),
            delayMin: delay.blocked ? null : delay.delayMin, speedKmh, color: colorAtSpeed(speedKmh),
            meanSpeedKmh, throughMeanSpeedKmh: meanSpeedKmh, throughSpeedKmh: speedKmh, throughColor: colorAtSpeed(speedKmh),
            capacityVph: state?.capacityVph ?? base.capacityVph, dischargeVph: state?.dischargeVph };
        delays[path] = delay;
    }
    // Through traffic and motorists joining a backed-up exit retain separate
    // travel-time estimates, both based on their displayed local speeds.
    for (const path of PATHS) {
        const shared = spills.filter(s => s.source === path).map(s => delays[s.rampId]);
        if (shared.length) {
            const queues = spills.filter(s => s.source === path), stock = queues.reduce((n, s) => n + s.queuedVehiclesOnMotorway, 0);
            reports[path].exitMeanSpeedKmh = stock > 0 ? queues.reduce((n, s) => n + s.queuedVehiclesOnMotorway *
                (reports[s.rampId].meanSpeedKmh ?? reports[s.rampId].speedKmh), 0) / stock : reports[path].speedKmh;
            reports[path].exitDelayMin = shared.some(d => d.blocked) ? null : Math.max(...shared.map(d => d.delayMin));
            reports[path].exitColor = colorAtSpeed(Math.min(freeSpeedKmh(path), ...(spillBands.get(path) ?? []).map(b => b.speedKmh)));
            const exitSpeed = Math.min(freeSpeedKmh(path), ...(spillBands.get(path) ?? []).map(b => b.speedKmh));
            reports[path].speedKmh = Math.min(reports[path].speedKmh, exitSpeed);
            reports[path].color = colorAtSpeed(reports[path].speedKmh);
        }
    }
    const display = PATHS.flatMap(path => {
        const own = jams.filter(j => j.pathKey === path), state = cells[path];
        return state ? joinWaveFragments(own, state.cellM) : own;
    });
    return { jams: display, physicalJams: jams, bands, spillBands, reports, delays };
}
