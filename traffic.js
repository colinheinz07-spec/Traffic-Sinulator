import { REFERENCE_PEAKS, profileFactor, profileIdentity } from './traffic-profiles.js?build=20261102-flow1';
import { EXTENSION_IDS, extensionRoutes, extensionRoute } from './network-extensions.js?build=20261102-flow1';
/** Deliberately isolated, macroscopic first-pass traffic-flow simulation.
 * Traffic volumes, capacities, and queue density are modelling assumptions,
 * NOT measured flows, road regulations, official diversion routes, or observed jams.
 * One controlling bottleneck per directional path; no A3/A48 ramp transfer yet.
 */
import { flowPolicy } from './events.js?build=20261102-flow1';
import { baseLaneCapacity, QUEUE_JAM_DENSITY_PER_LANE } from './traffic-physics.js?build=20261102-flow1';
export const PATHS = [
    'A3-koeln', 'A3-frankfurt', 'A48-dernbach', 'A48-koblenz',
    'ramp-a3-to-a48-from-frankfurt', 'ramp-a48-to-koeln',
    'ramp-a3-to-a48-from-koeln', 'ramp-a48-to-frankfurt'
];
export const NETWORK_PATHS = [...PATHS, ...EXTENSION_IDS];
const demandDefaults = {
    ...Object.fromEntries(extensionRoutes.map(r => [r.id, r.demandVph])),
    ...REFERENCE_PEAKS,
    'A3-koeln': 4200, 'A3-frankfurt': 4100,
    'A48-dernbach': 2400, 'A48-koblenz': 1700,
    'ramp-a3-to-a48-from-frankfurt': 1000, 'ramp-a48-to-koeln': 1000,
    'ramp-a3-to-a48-from-koeln': 700, 'ramp-a48-to-frankfurt': 1400
};
const motorwayBaseLanes = {
    'A3-koeln': 3, 'A3-frankfurt': 3, 'A48-dernbach': 2, 'A48-koblenz': 2
};
const defaultKmH = (key) => extensionRoute(key)?.freeKmh ?? (key.startsWith('ramp-') ? 80 : 130);
export function defaultDemand(key) { return demandDefaults[key]; }
export function baselineCapacity(key) {
    return baseLaneCapacity(key) * (extensionRoute(key)?.lanes ?? (key.startsWith('ramp-') ? 1 : motorwayBaseLanes[key]));
}
export function emptyTraffic() {
    return { minute: 0, vehiclesWaiting: Object.fromEntries(NETWORK_PATHS.map(p => [p, 0])) };
}
/** A3/A48 scenario assumptions (NOT actual freight counts). The vehicle
 * composition can be supplied by subsequent route/time-based demand models.
 */
export function defaultHeavyShare(key) {
    return key.startsWith('A3') ? .23 : key.startsWith('A48') ? .16 : .15;
}
/** Shares ordered RIGHT -> LEFT, from car- and HGV-specific lane choices.
 * Heavy trucks are predominantly right; cars are more evenly distributed.
 * Expose heavyFraction so an automated or measured fleet mix can replace the
 * synthetic reference. This is not a measured lane occupation distribution.
 */
export function laneDemandShares(n, heavyFraction = .23) {
    if (!Number.isInteger(n) || n < 1 || n > 7 || !Number.isFinite(heavyFraction) || heavyFraction < 0 || heavyFraction > 1)
        throw Error('Ungültige Fahrstreifenanzahl oder Schwerlastanteil');
    if (n === 1)
        return [1];
    const cars = n === 2 ? [.53, .47] : n === 3 ? [.38, .36, .26] :
        Array.from({ length: n }, (_, i) => 1.10 - .40 * i / (n - 1));
    const trucks = n === 2 ? [.96, .04] : n === 3 ? [.90, .10, 0] :
        Array.from({ length: n }, (_, i) => i === 0 ? .89 : i === 1 ? .09 : .02 / (n - 2));
    const carTotal = cars.reduce((a, b) => a + b, 0), truckTotal = trucks.reduce((a, b) => a + b, 0);
    return cars.map((v, i) => (1 - heavyFraction) * v / carTotal + heavyFraction * trucks[i] / truckTotal);
}
export function closedDemandShare(e, heavyFraction = defaultHeavyShare(e.pathKey)) {
    const shares = laneDemandShares(e.laneCount, heavyFraction);
    return e.closedLanes.reduce((sum, lane) => sum + (shares[lane] ?? 0), 0);
}
/** Relative closure sensitivity: with more HGVs, closing the truck-heavy
 * right lane causes additional merging disturbance at saturated demand.
 * This *reduces effective capacity*, never adds fictional queued vehicles.
 */
export function eventCapacity(e, volumeVph = defaultDemand(e.pathKey), heavyFraction = defaultHeavyShare(e.pathKey)) {
    const policy = flowPolicy(e);
    if (!policy.canEnter)
        return 0;
    if (!Number.isFinite(volumeVph) || volumeVph < 0 || volumeVph > 16000)
        throw Error('Ungültiger Zufluss');
    if (!Number.isFinite(heavyFraction) || heavyFraction < 0 || heavyFraction > 1)
        throw Error('Ungültiger Schwerlastanteil');
    const perLane = baseLaneCapacity(e.pathKey);
    const laneCapacity = perLane * (policy.openMainLanes + (e.settings.shoulder === 'open' ? .65 : 0));
    // 0,5 km/h ist Kriechverkehr, keine typische Fahrstreifenkapazität.
    if (policy.speedKmh === 0.5)
        return Math.max(1, Math.floor(.5 * QUEUE_JAM_DENSITY_PER_LANE * policy.openTotalLanes));
    const normalSpeed = defaultKmH(e.pathKey);
    const parallel = policy.openMainLanes >= 2 && e.closedLanes.length > 0;
    // The 2000 veh/h/lane motorway reference is a saturated service headway, not
    // 130 km/h times a fixed density. Two usable lanes can still serve that
    // headway at 60 km/h. Do not penalize them against free motorway speed
    // and then apply the same merge disturbance a second and third time.
    const speedRatio = Math.min(1, policy.speedKmh / (parallel ? 60 : normalSpeed));
    const speedAt40 = parallel ? .80 + .20 * (40 / 60) : .86 + .14 * Math.min(1, 40 / normalSpeed);
    const speedFactor = policy.speedKmh < 40
        ? speedAt40 * (.45 + .55 * policy.speedKmh / 40)
        : parallel ? Math.min(1, .80 + .20 * speedRatio) : .86 + .14 * speedRatio;
    // Two usable lanes can sustain orderly parallel discharge. The per-lane
    // reference already represents a sustained flow; avoid stacking the full
    // single-lane speed/merging penalty onto both available lanes again.
    const baseMerge = e.closedLanes.length === 0 ? 1 : parallel ? (e.kind === 'roadworks' ? .999 : .997) : e.kind === 'roadworks' ? .92 : .87;
    const shares = laneDemandShares(e.laneCount, heavyFraction);
    const hgvDistribution = laneDemandShares(e.laneCount, 1);
    const affectedShare = e.closedLanes.reduce((sum, i) => sum + shares[i], 0);
    const divertedHeavyShare = e.closedLanes.reduce((sum, i) => sum + hgvDistribution[i] * heavyFraction, 0);
    // When only one lane remains, vehicles have no further alternative merge
    // lane. Avoid multiplying the loss as if every truck changes lanes twice.
    const remaining = Math.max(0, policy.openMainLanes);
    const constrained = remaining <= 1 ? .45 : 1;
    const loading = Math.min(1, volumeVph / Math.max(1, laneCapacity));
    const extraMergeLoss = e.closedLanes.length === 0 ? 0 :
        constrained * loading * (parallel ? (.008 * affectedShare + .012 * divertedHeavyShare) : (.10 * affectedShare + .14 * divertedHeavyShare));
    const mergeFactor = baseMerge * Math.max(.72, 1 - extraMergeLoss);
    return Math.max(0, Math.round(laneCapacity * speedFactor * mergeFactor));
}
export function pathBottleneck(key, events, volumeVph = defaultDemand(key)) {
    const relevant = events.filter(e => e.pathKey === key);
    let capacity = baselineCapacity(key), critical = null;
    for (const e of relevant) {
        const c = eventCapacity(e, volumeVph);
        if (c < capacity || (c === capacity && critical === null)) {
            capacity = c;
            critical = e;
        }
    }
    return { capacityVph: capacity, event: critical, count: relevant.length, speedKmh: critical?.settings.speedKmh ?? defaultKmH(key) };
}
export function trafficEstimate(state, key, events, inputVph) {
    if (!Number.isFinite(inputVph) || inputVph < 0 || inputVph > 8000)
        throw Error('Zufluss muss zwischen 0 und 8000 Fahrzeugen/h liegen');
    const bn = pathBottleneck(key, events, inputVph), queue = Math.max(0, state.vehiclesWaiting[key]);
    const capacity = bn.capacityVph;
    // Long queues spread across available approach lanes, using a declared illustrative density.
    const approachLanes = key.startsWith('ramp-') ? 1 : motorwayBaseLanes[key];
    const queueKm = queue / (QUEUE_JAM_DENSITY_PER_LANE * approachLanes);
    // Queue delay is unknowable when a closure has zero discharge; never display a finite prediction.
    const physicalWait = capacity === 0 ? null : queue / capacity * 60;
    const eventDelay = bn.event && capacity > 0 ?
        Math.max(0, bn.event.settings.lengthM / 1000 * (1 / bn.event.settings.speedKmh - 1 / defaultKmH(key)) * 60) : 0;
    const delayMin = physicalWait === null ? null : Math.max(0, physicalWait + eventDelay);
    let color = 'free';
    if (capacity === 0)
        color = 'standstill';
    else if (queueKm >= 1.5 || (delayMin !== null && delayMin >= 10))
        color = 'jam';
    else if (queue > 5 || inputVph > capacity * .91 || (delayMin !== null && delayMin > .8))
        color = 'slow';
    const dischargedVph = Math.min(capacity, inputVph + queue * 60);
    return { pathKey: key, demandVph: inputVph, capacityVph: capacity, dischargedVph,
        queueVehicles: queue, queueKm, delayMin, speedKmh: bn.speedKmh, color,
        bottleneckId: bn.event?.id ?? null, eventCount: bn.count,
        officiallyClosed: bn.event?.kind === 'closure' || false };
}
export function advanceTraffic(state, events, demands, minutes) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60)
        throw Error('Zeitschritt muss 1 bis 60 Minuten betragen');
    const waiting = { ...state.vehiclesWaiting };
    // Minute-by-minute conservation: queued vehicles + arrivals - discharged vehicles.
    // Deliberately NO fake ramp interchanges, departures or fictional detours.
    for (let minute = 0; minute < minutes; minute++)
        for (const key of NETWORK_PATHS) {
            const volume = demands[key];
            if (!Number.isFinite(volume) || volume < 0 || volume > 8000)
                throw Error('Zufluss außerhalb des zulässigen Bereichs');
            const capacity = pathBottleneck(key, events, volume).capacityVph;
            const available = waiting[key] + volume / 60;
            const discharged = Math.min(available, capacity / 60);
            waiting[key] = Math.max(0, available - discharged);
        }
    return { minute: state.minute + minutes, vehiclesWaiting: waiting };
}
export function defaultDemands() { return { ...demandDefaults }; }
/** Local calendar profiles vary by motorway and direction. References are
 * peak-hour model inputs, not DTV or current measured hourly counts. */
export function demandAtClock(base, moment) {
    if (!Number.isFinite(moment.getTime()))
        throw Error('Ungültiges Simulationsdatum');
    const factors = new Map();
    return Object.fromEntries(NETWORK_PATHS.map(key => {
        // Most ramps share one family. Cache the result per profile/direction
        // inside this minute rather than recomputing a curve for every fragment.
        const id = profileIdentity(key);
        let factor = factors.get(id);
        if (factor === undefined) {
            factor = profileFactor(key, moment);
            factors.set(id, factor);
        }
        return [key, Math.max(0, Math.min(8000, Math.round(base[key] * factor)))];
    }));
}
/** Synthetic ending of a traffic peak. No measured traffic; no arbitrary delay cap. */
export function demandScale(minute, mode) {
    if (!Number.isFinite(minute) || minute < 0)
        throw Error('Ungültige Modellzeit');
    if (mode === 'constant')
        return 1;
    const t = Math.max(0, Math.min(1, (minute - 10) / 90));
    return 1 - .77 * t * t * (3 - 2 * t);
}
export function demandAtMinute(base, minute, mode) {
    const factor = demandScale(minute, mode);
    return Object.fromEntries(NETWORK_PATHS.map(key => [key, Math.round(base[key] * factor)]));
}
