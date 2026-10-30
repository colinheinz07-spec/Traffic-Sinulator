/** Speed-based travel-time LOSS on the actual mainline cells.
 * For a traversable cell: delta=t_at_local_speed - t_at_free_speed.
 * Observed discharge is averaged in the simulation, before taking its
 * reciprocal with local density. A short brake must not multiply the whole
 * journey time. A closed through edge needs an explicit reopening scenario
 * for a finite forecast; tiny numerical flow is never its denominator.
 * A working mandatory off-ramp is a different traversable destination: its
 * actual discharge yields the time loss to that exit, labelled explicitly.
 * This calculation depends on NO clock, event age or queue-created timestamp.
 */
import { cellCriticalDensity, cellQueueSpans } from './traffic-cells.js?build=689b5e524f9e182c';
import { freeSpeedKmh } from './traffic-physics.js?build=689b5e524f9e182c';
/** A new, empty worksite does not serve a released queue kilometres away.
 * Use an active cross-section only once it belongs to that queue's physical
 * approach. Until then, its former head can still measure the release flow.
 * Queue memory bridges short moving gaps, never a separate free road. */
export function queueTravelHeads(state, detectorEndM = Infinity) {
    const spans = cellQueueSpans(state), heads = new Map();
    const detectors = state.cells.filter(c => c.travelDetector && c.toM <= detectorEndM + .1);
    for (const cell of state.cells) {
        if (cell.speedKmh > 65)
            continue;
        const span = spans.find(s => s.fromM < cell.toM - .1 && s.toM > cell.fromM + .1);
        const end = (span?.toM ?? cell.toM) + state.cellM;
        const ahead = detectors.filter(d => d.toM >= cell.toM - .1);
        const nextActive = ahead.find(d => d.travelDetector.active);
        // Connected incidents share the governing service. In particular, a
        // downstream complete block supplies its reopening forecast through an
        // upstream worksite; its stopped arrivals are not that site's capacity.
        const active = ahead.filter(d => d.travelDetector.active && d.toM <= end + .1).reduce((best, d) => !best || d.travelDetector.capacityVph <= best.travelDetector.capacityVph ? d : best, undefined);
        const released = ahead.find(d => !d.travelDetector.active && (!nextActive || d.toM < nextActive.toM));
        const head = active ?? released;
        if (head)
            heads.set(cell.toM, head);
    }
    return heads;
}
export function speedDelayInCells(state, fromM = 0, toM = Infinity, detectorEndM = Infinity) {
    const free = freeSpeedKmh(state.pathKey);
    if (!Number.isFinite(fromM) || Number.isNaN(toM) || fromM < 0 || toM <= fromM)
        throw Error('Ungültiger Streckenbereich zur Zeitverlustberechnung');
    if (state.closures?.some(c => fromM >= c.fromM - .1 && fromM < c.toM - .1))
        return { delayMin: 0, blocked: true, assessedKm: 0, stoppedKm: 0 };
    const selected = state.cells.filter(c => c.toM > fromM && c.fromM < toM);
    const barriers = selected.filter(c => c.blockedAtM !== undefined && c.blockedAtM > fromM && c.blockedAtM <= toM + .1);
    const exit = barriers.find(c => c.travelDetector?.diversionExitRef);
    let diversionExitRef = exit?.travelDetector?.diversionExitRef;
    const endM = exit ? Math.min(toM, exit.toM) : toM;
    const barrier = barriers.find(c => c.toM <= endM + .1 && !c.travelDetector?.diversionExitRef && !c.reopeningForecast);
    // Resolve a physical road block BEFORE any divisions. Cells upstream of
    // a zero-capacity edge approach zero speed without necessarily reaching
    // floating-point zero. Summing their inverse speeds produced years of
    // fictitious "minimum" delay despite the explicit blocked state.
    if (barrier) {
        const stoppedKm = selected.filter(c => c.vehicles >= .01 && c.speedKmh <= 10)
            .reduce((n, c) => n + (Math.min(c.toM, toM) - Math.max(c.fromM, fromM)) / 1000, 0);
        return { delayMin: 0, blocked: true, assessedKm: 0, stoppedKm };
    }
    const critical = cellCriticalDensity(state.pathKey);
    // A local queue must not borrow a distant incident's zero-flow forecast
    // through kilometres of genuinely free road. Direction-wide callers may
    // still assess the full journey; queue callers bound their own head.
    const heads = queueTravelHeads(state, detectorEndM);
    let delayMin = 0, assessedKm = 0, stoppedKm = 0;
    let forecastWaitMin;
    for (const b of barriers)
        if (b.toM <= endM + .1 && b.reopeningForecast)
            forecastWaitMin = Math.max(forecastWaitMin ?? 0, b.reopeningForecast.waitMin);
    for (const c of selected) {
        const start = Math.max(c.fromM, fromM), end = Math.min(c.toM, endM);
        if (end <= start || c.vehicles < .01)
            continue;
        const km = (end - start) / 1000;
        // Free-flow and speed-limit cells use their current velocity. Once a
        // queue drains, its historical low speed cannot leave a phantom delay.
        // In a dense queue, its observed head discharge serves the vehicles
        // ahead, including those momentarily standing in a braking wave. With
        // k=N/L and v=q/k, L/v=N/q: exactly the usual distance/speed formula
        // in a stationary queue, without assuming a temporary local stop lasts
        // throughout the journey. Detectors persist while a released queue drains.
        const congested = c.speedKmh <= 65 && c.densityVehKm >= (c.criticalDensityVehKm ?? critical) * 1.10;
        const head = heads.get(c.toM);
        const forecast = head?.reopeningForecast;
        const detector = congested || forecast ? head?.travelDetector : undefined;
        diversionExitRef ??= detector?.diversionExitRef;
        if (forecast)
            forecastWaitMin = Math.max(forecastWaitMin ?? 0, forecast.waitMin);
        const flow = forecast?.serviceVph ?? detector?.meanFlowVph ?? c.travelFlowVph;
        const observed = (congested || forecast) && flow !== undefined && c.densityVehKm > 0 ?
            Math.min(forecast ? 40 : c.limitKmh ?? free, flow / c.densityVehKm) : c.speedKmh;
        const local = Math.min(free, Math.max(0, observed));
        // A true standstill is not equivalent to driving at a fictional 1–5 km/h.
        // Exit-bound cars may still move in a cell whose through edge is closed.
        // Their off-ramp flow must not imply an available motorway passage.
        if (local <= 1e-6 || c.blockedAtM !== undefined && end >= c.blockedAtM - .1 && !c.travelDetector?.diversionExitRef && !c.reopeningForecast) {
            stoppedKm += km;
            continue;
        }
        assessedKm += km;
        delayMin += Math.max(0, 60 * km * (1 / local - 1 / free));
    }
    return { delayMin: delayMin + (forecastWaitMin ?? 0), blocked: stoppedKm > .0001, assessedKm, stoppedKm,
        ...(diversionExitRef ? { diversionExitRef } : {}), ...(forecastWaitMin !== undefined ? { forecastWaitMin } : {}) };
}
/** Bands must already be resolved, so overlapping queues count only once. */
export function speedDelayInBands(path, bands) {
    const free = freeSpeedKmh(path);
    let delayMin = 0, assessedKm = 0, stoppedKm = 0;
    for (const b of bands) {
        const km = Math.max(0, b.toM - b.fromM) / 1000;
        const speed = Math.max(0, Math.min(free, b.speedKmh));
        if (speed <= 1e-6) {
            stoppedKm += km;
            continue;
        }
        assessedKm += km;
        delayMin += Math.max(0, 60 * km * (1 / speed - 1 / free));
    }
    return { delayMin, blocked: stoppedKm > .0001, assessedKm, stoppedKm };
}
export function speedDelayLabel(value, precision = 1, compact = false) {
    if (compact && value.blocked)
        return 'Durchfahrt blockiert';
    if (value.blocked)
        return 'Durchfahrt blockiert · Verzögerung nicht prognostizierbar';
    const n = value.delayMin.toLocaleString('de-DE', { minimumFractionDigits: precision, maximumFractionDigits: precision });
    const prefix = value.forecastWaitMin !== undefined ? '~+' : '+';
    const estimate = value.forecastWaitMin !== undefined && !compact ? ' (geschätzt)' : '';
    if (value.diversionExitRef)
        return prefix + n + ' min' + (compact ? ' · Ausleitung AS ' : ' bis Ausleitung AS ') + value.diversionExitRef + estimate;
    return prefix + n + ' min' + estimate;
}
