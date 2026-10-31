/** Explicit scenario assumptions, not measured local road counts. */
import { effectiveEventsAt } from './events.js?build=19433adb960dd212';
import { PATHS } from './traffic.js?build=19433adb960dd212';
/** Availability relative to the existing busy-weekday calibration.
 * A quiet road cannot exceed its geometric/signal maximum: the ramp
 * terminal remains bounded by its junction-specific maximum. No holiday assumptions. */
export function localRoadAvailability(moment) {
    if (!moment)
        return 1;
    if (!Number.isFinite(moment.getTime()))
        throw Error('Ungültiges Verkehrsdatum');
    const day = moment.getDay(), hour = moment.getHours() + moment.getMinutes() / 60;
    const weekend = day === 0 || day === 6;
    const peak = !weekend && ((hour >= 6 && hour < 9) || (hour >= 15 && hour < 18));
    return peak ? 1 : weekend ? (hour >= 8 && hour < 20 ? 1.2 : 1.4) : (hour >= 6 && hour < 20 ? 1.1 : 1.3);
}
const parent = {
    'ramp-a3-to-a48-from-frankfurt': 'A3-koeln', 'ramp-a3-to-a48-from-koeln': 'A3-frankfurt',
    'ramp-a48-to-koeln': 'A48-dernbach', 'ramp-a48-to-frankfurt': 'A48-dernbach'
};
/** Only scheduled closures are announced. Reduce NEW trips by up to 20%,
 * ramping in over the preceding hour; never remove existing vehicles.
 * Unscheduled incidents do not get this anticipation benefit. */
export function announcedClosureDemands(base, events, moment) {
    const factors = new Map();
    for (const minutes of [0, 15, 30, 45, 60]) {
        for (const event of effectiveEventsAt(events.filter(e => !!e.schedule), moment.getTime() + minutes * 60000)) {
            if (event.kind !== 'closure')
                continue;
            const factor = 1 - .2 * (1 - minutes / 60);
            factors.set(event.pathKey, Math.min(factors.get(event.pathKey) ?? 1, factor));
        }
    }
    return Object.fromEntries(PATHS.map(key => [key, base[key] * (factors.get(key) ?? factors.get(parent[key] ?? key) ?? 1)]));
}
