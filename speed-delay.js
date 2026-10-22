import { freeSpeedKmh } from './traffic-physics.js';
export function speedDelayInCells(state, fromM = 0, toM = Infinity) {
    const free = freeSpeedKmh(state.pathKey);
    if (!Number.isFinite(fromM) || Number.isNaN(toM) || fromM < 0 || toM <= fromM)
        throw Error('Ungültiger Streckenbereich zur Zeitverlustberechnung');
    let delayMin = 0, assessedKm = 0, stoppedKm = 0;
    for (const c of state.cells) {
        const start = Math.max(c.fromM, fromM), end = Math.min(c.toM, toM);
        if (end <= start || c.vehicles < .01)
            continue;
        const km = (end - start) / 1000;
        const local = Math.min(free, Math.max(0, c.speedKmh));
        // A true standstill is not equivalent to driving at a fictional 1–5 km/h.
        if (local < .5) {
            stoppedKm += km;
            continue;
        }
        assessedKm += km;
        delayMin += Math.max(0, 60 * km * (1 / local - 1 / free));
    }
    return { delayMin, blocked: stoppedKm > .0001, assessedKm, stoppedKm };
}
export function speedDelayLabel(value, precision = 1) {
    const n = value.delayMin.toLocaleString('de-DE', { minimumFractionDigits: precision, maximumFractionDigits: precision });
    if (value.blocked)
        return value.delayMin >= .05 ?
            'mindestens +' + n + ' min · Durchfahrt blockiert' :
            'Durchfahrt blockiert · Verzögerung nicht prognostizierbar';
    return '+' + n + ' min';
}
