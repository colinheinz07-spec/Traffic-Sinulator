/** One snapshot for map geometry, jam cards and direction summaries.
 * Mainline queues are measured on the same congested CTM cells as the map.
 * Legacy queues remain the simulation input for the separate ramp ledger;
 * their synthetic lengths never truncate a mainline display queue.
 */
import { PATHS } from './traffic.js?build=b0a387e5cb5e18cc';
import { routeSlice } from './spatial.js?build=b0a387e5cb5e18cc';
import { cellSpeedBands } from './traffic-cells.js?build=b0a387e5cb5e18cc';
import { physicalSpeedBands, stopAndGoBands, resolveSpeedBands, freeSpeedKmh, colorAtSpeed } from './traffic-physics.js?build=b0a387e5cb5e18cc';
import { speedDelayInCells, speedDelayInBands } from './speed-delay.js?build=b0a387e5cb5e18cc';
import { routeReport } from './network-report.js?build=b0a387e5cb5e18cc';
import { positionM } from './spatial.js?build=b0a387e5cb5e18cc';
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
function addDelay(a, b) {
    return { delayMin: a.delayMin + b.delayMin, blocked: a.blocked || b.blocked,
        assessedKm: a.assessedKm + b.assessedKm, stoppedKm: a.stoppedKm + b.stoppedKm,
        ...(a.diversionExitRef || b.diversionExitRef ? { diversionExitRef: a.diversionExitRef ?? b.diversionExitRef } : {}) };
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
        if (next && next.pathKey === jam.pathKey && !differentOwners && gap >= 0 && (sameHead || gap <= cellM + .1)) {
            const delay = addDelay(jam.delay, next.delay), speedKmh = Math.min(jam.speedKmh, next.speedKmh);
            joined[joined.length - 1] = { ...next, eventId: next.eventId ?? jam.eventId,
                queueOwnerId: next.queueOwnerId ?? jam.queueOwnerId, eventKind: next.eventKind ?? jam.eventKind,
                waveHeadM: next.waveHeadM ?? jam.waveHeadM,
                queueM: next.queueM + jam.queueM, visibleQueueM: next.anchorM - (jam.anchorM - jam.visibleQueueM),
                queueVehicles: next.queueVehicles + jam.queueVehicles, feederM: next.feederM + jam.feederM,
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
            const localDelay = state ? speedDelayInCells(state, group.fromM, group.toM) : speedDelayInBands(path, group.bands);
            const delay = spill ? addDelay(localDelay, speedDelayInBands(spill.source, feederBands)) : localDelay;
            const speedKmh = Math.min(...group.bands.map(b => b.speedKmh), ...feederBands.map(b => b.speedKmh));
            const vehicles = state ? state.cells.reduce((n, c) => {
                const overlap = Math.max(0, Math.min(c.toM, group.toM) - Math.max(c.fromM, group.fromM));
                return n + c.vehicles * overlap / (c.toM - c.fromM);
            }, 0) : roots.reduce((n, r) => n + r.jam.queueVehicles * r.overlap / Math.max(.1, r.jam.visibleQueueM), 0);
            ownVehicles += vehicles;
            const point = routeSlice(route, Math.max(0, group.toM - 1), group.toM)[0] ?? route.points.at(-1);
            // The congestion front may extend one cell past its capacity face,
            // e.g. where the speed-restricted accident straddles a cell boundary.
            const waveHeadM = state?.cells.find(c => c.toM > group.fromM + .1 && c.travelDetector)?.toM;
            jams.push({ id: 'display:' + path + ':' + Math.round(group.toM), eventId: event?.id, queueOwnerId: root?.id, waveHeadM,
                pathKey: path, eventKind: event?.kind ?? null, point, anchorM: group.toM,
                queueVehicles: vehicles, queueM: group.toM - group.fromM + feederM,
                visibleQueueM: group.toM - group.fromM, delayMin: delay.blocked ? null : delay.delayMin,
                capacityVph: state?.capacityVph ?? root?.capacityVph ?? 0, speedKmh, color: colorAtSpeed(speedKmh),
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
        reports[path] = { ...base, queueKm: queueM / 1000,
            ...(state ? { ownVehicles, queueVehicles: ownVehicles + base.sharedRampVehicles } : {}),
            delayMin: delay.blocked ? null : delay.delayMin, speedKmh, color: colorAtSpeed(speedKmh),
            throughSpeedKmh: speedKmh, throughColor: colorAtSpeed(speedKmh),
            capacityVph: state?.capacityVph ?? base.capacityVph, dischargeVph: state?.dischargeVph };
        delays[path] = delay;
    }
    // Through traffic and motorists joining a backed-up exit retain separate
    // travel-time estimates, both based on their displayed local speeds.
    for (const path of PATHS) {
        const shared = spills.filter(s => s.source === path).map(s => delays[s.rampId]);
        if (shared.length) {
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
