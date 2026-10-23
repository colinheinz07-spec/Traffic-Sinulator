/** Speed-based travel-time LOSS on the actual mainline cells.
 * For a traversable cell: delta=t_at_local_speed - t_at_free_speed.
 * Observed discharge is averaged in the simulation, before taking its
 * reciprocal with local density. A short brake must not multiply the whole
 * journey time. A closed through edge has NO finite predictive travel time;
 * its asymptotically tiny numerical upstream flow is not a travel forecast.
 * This calculation depends on NO clock, event age or queue-created timestamp.
 */
import { cellCriticalDensity } from './traffic-cells.js';
import { freeSpeedKmh } from './traffic-physics.js';
export function speedDelayInCells(state, fromM = 0, toM = Infinity) {
    const free = freeSpeedKmh(state.pathKey);
    if (!Number.isFinite(fromM) || Number.isNaN(toM) || fromM < 0 || toM <= fromM)
        throw Error('Ungültiger Streckenbereich zur Zeitverlustberechnung');
    const selected = state.cells.filter(c => c.toM > fromM && c.fromM < toM);
    // Resolve a physical road block BEFORE any divisions. Cells upstream of
    // a zero-capacity edge approach zero speed without necessarily reaching
    // floating-point zero. Summing their inverse speeds produced years of
    // fictitious "minimum" delay despite the explicit blocked state.
    if (selected.some(c => c.blockedAtM !== undefined && c.blockedAtM > fromM && c.blockedAtM <= toM + .1)) {
        const stoppedKm = selected.filter(c => c.vehicles >= .01 && c.speedKmh <= 10)
            .reduce((n, c) => n + (Math.min(c.toM, toM) - Math.max(c.fromM, fromM)) / 1000, 0);
        return { delayMin: 0, blocked: true, assessedKm: 0, stoppedKm };
    }
    const critical = cellCriticalDensity(state.pathKey);
    const detectors = state.cells.filter(d => d.travelDetector);
    let delayMin = 0, assessedKm = 0, stoppedKm = 0;
    for (const c of selected) {
        const start = Math.max(c.fromM, fromM), end = Math.min(c.toM, toM);
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
        const congested = c.speedKmh <= 65 && c.densityVehKm >= critical * 1.10;
        const detector = congested ? detectors.find(d => d.toM >= c.toM - .1)?.travelDetector : undefined;
        const flow = detector?.meanFlowVph ?? c.travelFlowVph;
        const observed = congested && flow !== undefined && c.densityVehKm > 0 ?
            Math.min(c.limitKmh ?? free, flow / c.densityVehKm) : c.speedKmh;
        const local = Math.min(free, Math.max(0, observed));
        // A true standstill is not equivalent to driving at a fictional 1–5 km/h.
        // Exit-bound cars may still move in a cell whose through edge is closed.
        // Their off-ramp flow must not imply an available motorway passage.
        if (local <= 1e-6 || c.blockedAtM !== undefined && end >= c.blockedAtM - .1) {
            stoppedKm += km;
            continue;
        }
        assessedKm += km;
        delayMin += Math.max(0, 60 * km * (1 / local - 1 / free));
    }
    return { delayMin, blocked: stoppedKm > .0001, assessedKm, stoppedKm };
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
    return '+' + n + ' min';
}
