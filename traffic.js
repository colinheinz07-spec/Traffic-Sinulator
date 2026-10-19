/** Deliberately isolated, macroscopic first-pass traffic-flow simulation.
 * Traffic volumes, capacities, and queue density are modelling assumptions,
 * NOT measured flows, road regulations, official diversion routes, or observed jams.
 * One controlling bottleneck per directional path; no A3/A48 ramp transfer yet.
 */
import { flowPolicy } from './events.js';
export const PATHS = [
    'A3-koeln', 'A3-frankfurt', 'A48-dernbach', 'A48-koblenz',
    'ramp-a3-to-a48-from-frankfurt', 'ramp-a48-to-koeln',
    'ramp-a3-to-a48-from-koeln', 'ramp-a48-to-frankfurt'
];
const demandDefaults = {
    'A3-koeln': 4200, 'A3-frankfurt': 4100,
    'A48-dernbach': 2400, 'A48-koblenz': 2200,
    'ramp-a3-to-a48-from-frankfurt': 700, 'ramp-a48-to-koeln': 700,
    'ramp-a3-to-a48-from-koeln': 700, 'ramp-a48-to-frankfurt': 700
};
const motorwayBaseLanes = {
    'A3-koeln': 3, 'A3-frankfurt': 3, 'A48-dernbach': 2, 'A48-koblenz': 2
};
const defaultKmH = (key) => key.startsWith('ramp-') ? 80 : key.startsWith('A48') ? 100 : 120;
export function defaultDemand(key) { return demandDefaults[key]; }
export function baselineCapacity(key) {
    return key.startsWith('ramp-') ? 1500 : 1800 * motorwayBaseLanes[key];
}
export function emptyTraffic() {
    return { minute: 0, vehiclesWaiting: Object.fromEntries(PATHS.map(p => [p, 0])) };
}
/** Illustrative per-lane demand shares (right -> left), NOT observed counts.
 * Right typically carries more HGVs and merging demand; closure of that lane
 * therefore disrupts the stream differently from closing the left lane.
 */
export function laneDemandShares(n) {
    if (n <= 1)
        return [1];
    if (n === 2)
        return [.58, .42];
    if (n === 3)
        return [.45, .34, .21];
    const weights = Array.from({ length: n }, (_, i) => i === 0 ? 1.45 : i === n - 1 ? .75 : 1);
    const total = weights.reduce((a, b) => a + b, 0);
    return weights.map(w => w / total);
}
export function closedDemandShare(e) {
    const shares = laneDemandShares(e.laneCount);
    return e.closedLanes.reduce((sum, lane) => sum + (shares[lane] ?? 0), 0);
}
export function eventCapacity(e) {
    const policy = flowPolicy(e);
    if (!policy.canEnter)
        return 0;
    const ramp = e.pathKey.startsWith('ramp-');
    const perLane = ramp ? 1500 : 1800;
    // Standstreifen are explicitly less capable than ordinary traffic lanes.
    const laneCapacity = perLane * (policy.openMainLanes + (e.settings.shoulder === 'open' ? .65 : 0));
    const normalSpeed = defaultKmH(e.pathKey);
    const speedRatio = Math.min(1, policy.speedKmh / normalSpeed);
    // Scenario assumptions, not calibrated field measurements: below motorway free-flow
    // a posted limit does not reduce peak *throughput* in proportion to speed.
    // Previous 0.42+0.58*ratio combined with hard merging penalties could leave
    // a single lane at 40 km/h with only ~916 veh/h, exaggerating delays.
    // Keep a stronger penalty for very slow (<40 km/h) incident pass-bys.
    const speedAt40 = .86 + .14 * Math.min(1, 40 / normalSpeed);
    const speedFactor = policy.speedKmh < 40
        ? speedAt40 * (.45 + .55 * policy.speedKmh / 40)
        : .86 + .14 * speedRatio;
    // A blocked right lane requires more HGV/merging flow to change lane than a
    // blocked left lane. Only a *moderate* extra bottleneck penalty is applied.
    const baseMerge = e.closedLanes.length === 0 ? 1 : e.kind === 'roadworks' ? .92 : .87;
    const mergeFactor = baseMerge * (1 - (e.closedLanes.length ? .07 * closedDemandShare(e) : 0));
    return Math.max(0, Math.round(laneCapacity * speedFactor * mergeFactor));
}
export function pathBottleneck(key, events) {
    const relevant = events.filter(e => e.pathKey === key);
    let capacity = baselineCapacity(key), critical = null;
    for (const e of relevant) {
        const c = eventCapacity(e);
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
    const bn = pathBottleneck(key, events), queue = Math.max(0, state.vehiclesWaiting[key]);
    const capacity = bn.capacityVph;
    // Long queues spread across available approach lanes, using a declared illustrative density.
    const approachLanes = key.startsWith('ramp-') ? 1 : motorwayBaseLanes[key];
    const queueKm = queue / (95 * approachLanes);
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
        for (const key of PATHS) {
            const volume = demands[key];
            if (!Number.isFinite(volume) || volume < 0 || volume > 8000)
                throw Error('Zufluss außerhalb des zulässigen Bereichs');
            const capacity = pathBottleneck(key, events).capacityVph;
            const available = waiting[key] + volume / 60;
            const discharged = Math.min(available, capacity / 60);
            waiting[key] = Math.max(0, available - discharged);
        }
    return { minute: state.minute + minutes, vehiclesWaiting: waiting };
}
export function defaultDemands() { return { ...demandDefaults }; }
const WEEKDAY_PROFILE = [
    [0, .14], [4, .09], [5, .20], [6, .52], [7, .86], [8, 1], [9, .79], [10, .66],
    [12, .68], [14, .72], [15, .82], [16, 1], [17, 1.05], [18, .82], [19, .58],
    [21, .32], [23, .19], [24, .14]
];
const SATURDAY_PROFILE = [
    [0, .23], [3, .15], [6, .14], [8, .28], [10, .54], [12, .78], [15, .85],
    [17, .76], [20, .61], [23, .33], [24, .23]
];
const SUNDAY_PROFILE = [
    [0, .22], [4, .13], [8, .18], [10, .40], [12, .63], [15, .79], [17, .92],
    [19, .76], [21, .46], [23, .26], [24, .22]
];
function interpolateHourly(points, hour) {
    for (let i = 1; i < points.length; i++) {
        const [end, value] = points[i], [start, previous] = points[i - 1];
        if (hour <= end)
            return previous + (value - previous) * (hour - start) / (end - start);
    }
    return points.at(-1)[1];
}
/** Synthetic local-clock demand: reference volumes are peak-hour inputs, NOT
 * measured traffic counts. Public holidays and school holidays not modelled.
 * Date uses local device time, including DST at a real elapsed-minute rollover.
 */
export function demandAtClock(base, moment) {
    if (!Number.isFinite(moment.getTime()))
        throw Error('Ungültiges Simulationsdatum');
    const weekday = moment.getDay(), hour = moment.getHours() + moment.getMinutes() / 60;
    const profile = weekday === 0 ? SUNDAY_PROFILE : weekday === 6 ? SATURDAY_PROFILE : WEEKDAY_PROFILE;
    const factor = interpolateHourly(profile, hour);
    return Object.fromEntries(PATHS.map(key => {
        let direction = 1;
        if (weekday !== 0 && weekday !== 6) {
            const morning = Math.max(0, 1 - Math.abs(hour - 7.75) / 2.5);
            const evening = Math.max(0, 1 - Math.abs(hour - 16.75) / 2.5);
            if (key === 'A3-frankfurt' || key === 'A48-dernbach' || key === 'ramp-a48-to-frankfurt')
                direction += .09 * morning;
            if (key === 'A3-koeln' || key === 'A48-koblenz' || key === 'ramp-a48-to-koeln')
                direction += .09 * evening;
        }
        return [key, Math.max(0, Math.min(8000, Math.round(base[key] * factor * direction)))];
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
    return Object.fromEntries(PATHS.map(key => [key, Math.round(base[key] * factor)]));
}
