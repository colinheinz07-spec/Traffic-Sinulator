import { positionM, closureGate } from './spatial.js?build=8b08edf9bc043858';
import { baselineCapacity, eventCapacity } from './traffic.js?build=8b08edf9bc043858';
import { flowPolicy, DEFAULT_CLEARANCE_MIN } from './events.js?build=8b08edf9bc043858';
import { colorAtSpeed, freeSpeedKmh, QUEUE_JAM_DENSITY_PER_LANE, CONGESTION_WAVE_KMH } from './traffic-physics.js?build=8b08edf9bc043858';
import { normalJunctionTraffic } from './junction-traffic.js?build=8b08edf9bc043858';
const TARGET_CELL_M = 100, WAVE_KMH = CONGESTION_WAVE_KMH, JAM_PER_LANE = QUEUE_JAM_DENSITY_PER_LANE;
// One observation per MODEL minute; repainting/pause never advances this.
const TRAVEL_ALPHA = 1 - Math.exp(-1 / 6);
export function cellLanes(path) {
    return path.startsWith('ramp-') ? 1 : path.startsWith('A48') ? 2 : 3;
}
export function cellCriticalDensity(path) {
    return Math.min(baselineCapacity(path) / freeSpeedKmh(path), JAM_PER_LANE * cellLanes(path) * WAVE_KMH / (freeSpeedKmh(path) + WAVE_KMH));
}
export function initialiseCells(route, initialDemandVph) {
    if (!Number.isFinite(initialDemandVph) || initialDemandVph < 0 || initialDemandVph > 8000)
        throw Error('Ungültiger Zufluss für Zellmodell');
    const count = Math.ceil(route.lengthM / TARGET_CELL_M);
    const cellM = route.lengthM / count, dx = cellM / 1000;
    const v = freeSpeedKmh(route.key), lanes = cellLanes(route.key);
    const jam = JAM_PER_LANE * lanes;
    const cap = Math.min(baselineCapacity(route.key), v * WAVE_KMH * jam / (v + WAVE_KMH));
    const equilibriumDensity = Math.min(.96 * jam, Math.min(initialDemandVph, cap) / v);
    const cells = Array.from({ length: count }, (_, i) => {
        const fromM = i * cellM, toM = (i + 1) * cellM;
        return { fromM, toM, vehicles: equilibriumDensity * dx,
            flowVph: Math.min(initialDemandVph, cap), speedKmh: v, densityVehKm: equilibriumDensity };
    });
    return { pathKey: route.key, minute: 0, cellM, cells, backlog: 0, initialVehicles: cells.reduce((s, c) => s + c.vehicles, 0),
        offeredTotal: 0, exitedTotal: 0 };
}
export function cellInventory(state) {
    return state.backlog + state.cells.reduce((s, c) => s + c.vehicles, 0) +
        (state.junctions ?? []).reduce((s, j) => s + j.waiting, 0);
}
export function assertCellConservation(state) {
    const lhs = cellInventory(state) + state.exitedTotal + (state.divertedTotal ?? 0);
    const rhs = state.initialVehicles + state.offeredTotal + (state.rejoinedTotal ?? 0);
    const tolerance = 1e-5 * Math.max(1, rhs);
    if (!Number.isFinite(lhs) || !Number.isFinite(rhs) || Math.abs(lhs - rhs) > tolerance)
        throw Error('Zellmodell hat Fahrzeuge verloren oder dupliziert');
    for (const j of state.junctions ?? []) {
        if (!Number.isFinite(j.waiting) || j.waiting < 0 ||
            Math.abs(j.offeredTotal - j.enteredTotal - j.waiting) > 1e-5 * Math.max(1, j.offeredTotal))
            throw Error('Anschlussstellenzufluss hat Fahrzeuge verloren oder dupliziert');
    }
    for (const c of state.cells) {
        const tagged = Object.values(c.routedVehicles ?? {});
        if (tagged.some(v => !Number.isFinite(v) || v < 0) || tagged.reduce((n, v) => n + v, 0) > c.vehicles + 1e-5)
            throw Error('Zielgebundene Fahrzeuge widersprechen dem Zellbestand');
    }
}
function localControls(route, events, demandVph, count, cellM, exits = []) {
    const free = freeSpeedKmh(route.key), laneCount = cellLanes(route.key);
    const speeds = Array(count).fill(free);
    const faceCapacity = Array(count + 1).fill(Infinity);
    const faceControls = Array.from({ length: count + 1 }, () => []);
    const releases = [];
    const closedEntries = [];
    const closureGates = [];
    const forecasts = new Map(), unknownBlocks = new Set();
    for (const event of events) {
        if (event.pathKey !== route.key)
            continue;
        const at = positionM(route, event.point);
        if (at === null)
            continue;
        const from = Math.max(0, at), to = Math.min(route.lengthM, from + event.settings.lengthM);
        // An administrative closure forbids entry at the last exit, NOT travel
        // for cars already in the road segment after that exit. Do not reduce
        // free speeds downstream of that gate.
        if (event.kind === 'closure' && exits.length) {
            const gate = closureGate(route, event, exits);
            if (!gate)
                continue;
            const face = gate.exit ? Math.max(1, Math.min(count, Math.round(gate.metre / cellM))) : 0;
            faceCapacity[face] = 0;
            unknownBlocks.add(face);
            faceControls[face].push(event.id + ':closure');
            closedEntries.push({ fromM: gate.metre - 25, toM: gate.endM - 25 });
            closureGates.push({ face, fromM: gate.metre, toM: gate.endM, exitRef: gate.exit?.ref ?? null, eventId: event.id });
            continue;
        }
        for (let c = Math.floor(from / cellM); c < Math.min(count, Math.ceil(to / cellM)); c++) {
            speeds[c] = Math.min(speeds[c], event.settings.speedKmh === 0 ? free : event.settings.speedKmh);
        }
        const face = Math.max(1, Math.min(count, Math.round((from + Math.min(150, event.settings.lengthM)) / cellM)));
        const limit = eventCapacity(event, demandVph);
        faceCapacity[face] = Math.min(faceCapacity[face], limit);
        if (limit === 0) {
            if (event.kind === 'closure')
                unknownBlocks.add(face);
            else {
                // Forecast one reopened lane at 40 km/h. This is an explicit scenario;
                // the physical event remains completely blocked until the user edits it.
                const release = { ...event, closedLanes: Array.from({ length: event.laneCount - 1 }, (_, i) => i),
                    settings: { ...event.settings, speedKmh: 40, shoulder: 'normal' } };
                const old = forecasts.get(face);
                forecasts.set(face, { waitMin: Math.max(old?.waitMin ?? 0, event.settings.clearanceMin ?? DEFAULT_CLEARANCE_MIN),
                    serviceVph: Math.min(old?.serviceVph ?? Infinity, eventCapacity(release, demandVph)) });
            }
        }
        faceControls[face].push(JSON.stringify([event.id, event.kind, event.closedLanes, event.settings]));
        const policy = flowPolicy(event);
        if (event.closedLanes.length && policy.openMainLanes > 0)
            releases.push({ face, event, maximum: 1800 * (policy.openMainLanes + (event.settings.shoulder === 'open' ? .65 : 0)) });
    }
    const jam = JAM_PER_LANE * laneCount;
    const capacity = speeds.map(v => Math.min(baselineCapacity(route.key), v * WAVE_KMH * jam / (v + WAVE_KMH)));
    for (const face of unknownBlocks)
        forecasts.delete(face);
    return { speeds, capacity, faceCapacity, faceControls: faceControls.map(c => c.sort().join('|')), jam, releases, closedEntries, closureGates, forecasts };
}
const dischargeHistories = new Map();
function dischargeSeed(id) {
    let seed = 2166136261;
    for (const c of id)
        seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
    return seed >>> 0;
}
function dischargeRandom(seed, index, channel) {
    let x = seed ^ Math.imul(index + 37, 0x9e3779b9) ^ Math.imul(channel + 1, 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
export function platoonServiceFactor(id, minute) {
    if (!Number.isFinite(minute))
        throw Error('Ungültige Anfahrzeit');
    // Generate a reproducible history with independently varying episode
    // duration, braking depth and recovery. There is no repeating pulse period.
    let history = dischargeHistories.get(id);
    if (!history) {
        history = { seed: dischargeSeed(id), end: -300, episodes: [] };
        dischargeHistories.set(id, history);
    }
    if (minute < -300)
        return 1;
    while (history.end <= minute) {
        const i = history.episodes.length, r = (channel) => dischargeRandom(history.seed, i, channel);
        const stop = .28 + .95 * r(0), rise = .22 + .6 * r(1), flow = 2 + 5.1 * r(2), fall = .20 + .65 * r(3), low = .12 + .32 * r(4);
        const total = stop + rise + flow + fall, lowWeight = stop + (rise + fall) / 2;
        // Mean requested service is sustained capacity, with physical free-lane
        // capacity still limiting the actual transfer at each substep.
        const high = (total - low * lowWeight) / (total - lowWeight);
        history.episodes.push({ start: history.end, stop, rise, flow, fall, low, high });
        history.end += total;
    }
    let lo = 0, hi = history.episodes.length - 1;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (history.episodes[mid].start <= minute)
            lo = mid;
        else
            hi = mid - 1;
    }
    const e = history.episodes[lo], t = minute - e.start;
    if (t < e.stop)
        return e.low;
    if (t < e.stop + e.rise)
        return e.low + (e.high - e.low) * (t - e.stop) / e.rise;
    if (t < e.stop + e.rise + e.flow)
        return e.high;
    return e.high - (e.high - e.low) * (t - e.stop - e.rise - e.flow) / e.fall;
}
/** Advance exactly one model minute, including stable updates of at most 2s.
 * Domain demand not admitted at the map entry is retained in backlog.
 * Outflow is discharged at the far end. No arbitrary time-loss surcharges.
 */
export function advanceCells(previous, route, events, demandVph, exits = [], ports = [], junctionDemand = normalJunctionTraffic(route, exits, demandVph)) {
    if (previous.pathKey !== route.key || !Number.isFinite(demandVph) || demandVph < 0 || demandVph > 8000)
        throw Error('Zellmodell: Richtung oder Zufluss ungültig');
    const n = previous.cells.length, dx = previous.cellM / 1000;
    const substeps = Math.max(30, Math.ceil(freeSpeedKmh(route.key) * 1000 / (60 * previous.cellM))), dtMin = 1 / substeps;
    const controls = localControls(route, events, demandVph, n, previous.cellM, exits);
    const { speeds, capacity, faceCapacity, faceControls, jam, releases, closedEntries } = controls;
    // Join free flow to the congested branch at ONE capacity density. The
    // former clipped linear receiver admitted capacity at much higher density
    // too, leaving kilometres of stationary orange traffic after reopening.
    // Calibrate the backward branch to Q/v instead of clipping a steeper
    // branch at Q. Its wave speed stays within the existing 22-km/h CFL bound.
    const receivingWave = capacity.map((q, i) => q / (jam - q / speeds[i]));
    const passages = new Map();
    for (const gate of controls.closureGates) {
        const candidate = ports.find(p => p.closurePassage && p.fromM !== null && p.fromM > gate.fromM &&
            controls.closureGates.filter(g => g.face === gate.face).every(g => {
                const event = events.find(e => e.id === g.eventId), at = event ? positionM(route, event.point) : null;
                return at !== null && at > p.fromM;
            }));
        const passage = candidate?.closurePassage;
        if (passage && passage.sharePercent >= 0 && passage.sharePercent <= 100) {
            passages.set(gate.face, passage);
            faceCapacity[gate.face] = baselineCapacity(route.key);
            faceControls[gate.face] += '|open-turn:' + passage.vehicleClass + ':' + passage.sharePercent;
        }
    }
    const routed = ports.map(port => {
        if (!((port.fromM === null || port.fromM >= 0 && port.fromM < route.lengthM) &&
            (port.toM === null || port.toM >= 0 && port.toM <= route.lengthM) &&
            (port.fromM === null || port.toM === null || port.toM > port.fromM) &&
            Number.isFinite(port.interestPercent) && port.interestPercent >= 0 && port.interestPercent <= 100 &&
            Number.isFinite(port.exitCapacityVph) && port.exitCapacityVph >= 0 &&
            Number.isFinite(port.returnVehicles) && port.returnVehicles >= 0))
            throw Error('Ungültiger Umleitungsanschluss');
        return { ...port, from: port.fromM === null ? -1 : Math.max(1, Math.min(n - 1, Math.round(port.fromM / previous.cellM))),
            to: port.toM === null ? -1 : Math.max(1, Math.min(n - 1, Math.round(port.toM / previous.cellM))), left: 0, joined: 0 };
    });
    const junctions = junctionDemand.map(d => {
        if (!Number.isFinite(d.entryVph) || d.entryVph < 0 || !Number.isFinite(d.exitPercent) || d.exitPercent < 0 || d.exitPercent > 100 ||
            !Number.isFinite(d.metre) || d.metre < 0 || d.metre >= route.lengthM ||
            !Number.isFinite(d.entryCapacityVph) || !Number.isFinite(d.exitCapacityVph) || d.entryCapacityVph <= 0 || d.exitCapacityVph <= 0)
            throw Error('Ungültiger Anschlussstellenzufluss');
        const old = previous.junctions?.find(j => j.id === d.id);
        const face = Math.max(1, Math.min(n - 1, Math.round(d.metre / previous.cellM)));
        const entryBlocked = closedEntries.some(c => d.metre >= c.fromM && d.metre < c.toM);
        // Apply the SAME delay-based route choice to new local trips. This is
        // demand avoided before entering our network, not cars deleted from an
        // existing ramp queue. Actual ramp/side-road capacities do not set it.
        const entryAvoidancePercent = entryBlocked ? 0 : Math.min(100, routed.filter(p => p.from === face)
            .reduce((sum, p) => sum + p.interestPercent, 0));
        return { ...d, entryVph: d.entryVph * (1 - entryAvoidancePercent / 100), entryAvoidancePercent,
            waiting: old?.waiting ?? 0, offeredTotal: old?.offeredTotal ?? 0,
            enteredTotal: old?.enteredTotal ?? 0, exitedTotal: old?.exitedTotal ?? 0, lastEntered: 0, lastExited: 0, lastExitDemand: 0,
            face, entryBlocked };
    });
    // An existing ramp queue is a vehicle inventory, even if a caller stops
    // offering new local demand. It may still merge and must never be dropped.
    for (const old of previous.junctions ?? [])
        if (!junctions.some(j => j.id === old.id))
            junctions.push({
                ...old, entryVph: 0, entryAvoidancePercent: 0, lastEntered: 0, lastExited: 0, lastExitDemand: 0, face: Math.max(1, Math.min(n - 1, Math.round(old.metre / previous.cellM))),
                entryBlocked: closedEntries.some(c => old.metre >= c.fromM && old.metre < c.toM)
            });
    const occupancy = previous.cells.map(c => c.vehicles);
    const closures = controls.closureGates.map(g => {
        const interest = routed.filter(p => p.from === g.face).reduce((n, p) => n + p.interestPercent, 0);
        return { ...g, diverting: g.exitRef !== null && interest > .001 && interest + (passages.get(g.face)?.sharePercent ?? 0) >= 100 - .001 };
    });
    let backlog = previous.backlog, offeredTotal = previous.offeredTotal, exitedTotal = previous.exitedTotal;
    const cumulativeOut = Array(n).fill(0);
    const through = Array(n + 1).fill(0);
    // Index sparse junctions once, rather than scanning every detour at every
    // 100m face and two-second update. Ordinary road faces use the fast path.
    const localAt = new Map(junctions.map(j => [j.face, j]));
    const departuresAt = new Map(), returnsAt = new Map();
    const noPorts = [];
    for (const port of routed) {
        if (port.from >= 1 && port.interestPercent > 0)
            departuresAt.set(port.from, [...(departuresAt.get(port.from) ?? []), port]);
        if (port.to >= 1 && port.toM !== null && !closedEntries.some(c => port.toM >= c.fromM && port.toM < c.toM))
            returnsAt.set(port.to, [...(returnsAt.get(port.to) ?? []), port]);
    }
    const density = new Float64Array(n), send = new Float64Array(n), receive = new Float64Array(n);
    const face = new Float64Array(n + 1), leaving = new Float64Array(n), joining = new Float64Array(n);
    const currentCapacity = new Float64Array(n + 1);
    const approachLimit = new Float64Array(n);
    const critical = cellCriticalDensity(route.key);
    const classIds = [...new Set([...previous.cells.flatMap(c => Object.keys(c.routedVehicles ?? {})),
            ...ports.flatMap(p => [p.vehicleClass, p.returnClass, p.closurePassage?.vehicleClass, p.classifyAt?.vehicleClass].filter((x) => !!x))])];
    const classStock = new Map(classIds.map(id => [id, Float64Array.from(previous.cells.map(c => c.routedVehicles?.[id] ?? 0))]));
    const classFace = new Map(classIds.map(id => [id, new Float64Array(n + 1)]));
    const classLeave = new Map(classIds.map(id => [id, new Float64Array(n)]));
    const classJoin = new Map(classIds.map(id => [id, new Float64Array(n)]));
    const classifiedJourneys = new Set(previous.classifiedJourneys ?? []);
    const classifications = ports.flatMap(p => p.classifyAt ? [p.classifyAt] : []);
    // Throughput describes queue service only while cars actually request it.
    // An empty new bottleneck has a low arrival count, not a tiny capacity.
    const observationFaces = previous.cells.flatMap((c, i) => Number.isFinite(faceCapacity[i + 1]) || c.travelDetector ? [i + 1] : []);
    const observationHours = new Float64Array(n + 1), observationVehicles = new Float64Array(n + 1);
    const exitObservations = new Set(closures.filter(c => c.diverting).map(c => c.face));
    // Assign an intent to the already-present vehicles when a new journey
    // becomes available. Later arrivals are classified at its decision face.
    for (const rule of classifications)
        if (rule.sharePercent > 0 && !classifiedJourneys.has(rule.vehicleClass)) {
            for (let i = 0; i < n; i++)
                if (previous.cells[i].fromM >= rule.metre && previous.cells[i].fromM < rule.untilM) {
                    const tagged = classIds.reduce((s, id) => s + classStock.get(id)[i], 0);
                    classStock.get(rule.vehicleClass)[i] += Math.max(0, occupancy[i] - tagged) * rule.sharePercent / 100;
                }
            classifiedJourneys.add(rule.vehicleClass);
        }
    for (let sub = 0; sub < substeps; sub++) {
        for (let i = 0; i < n; i++) {
            const k = occupancy[i] / dx;
            density[i] = k;
            send[i] = Math.min(speeds[i] * k, capacity[i]) * dtMin / 60;
            receive[i] = Math.min(receivingWave[i] * Math.max(0, jam - k), capacity[i]) * dtMin / 60;
        }
        // Drivers approach a locally visible slow tail instead of retaining
        // free speed until they hit its last 100m cell. Comfortable braking
        // (1.4m/s²) reaches at most ~470m ahead at 130 km/h. It applies only
        // to looser approaching traffic, never as a new cap on every dense
        // cell of the queue. Once the dense traffic clears, this constraint
        // disappears through the same local density/receiving observations.
        approachLimit.fill(Infinity);
        let slowAt = -1, slowSpeed = 0;
        for (let i = n - 1; i >= 0; i--) {
            const k = density[i];
            if (slowAt > i && k < jam * .55) {
                const distance = (slowAt - i) * previous.cellM;
                if (distance <= 500) {
                    const limit = Math.sqrt((slowSpeed / 3.6) ** 2 + 2 * 1.4 * distance) * 3.6;
                    if (limit < speeds[i]) {
                        approachLimit[i] = limit;
                        send[i] = Math.min(send[i], k * limit * dtMin / 60);
                    }
                }
            }
            if (k >= jam * .55) {
                const velocity = Math.min(speeds[i], receive[i] * 60 / dtMin / k);
                if (velocity <= 65) {
                    slowAt = i;
                    slowSpeed = velocity;
                }
            }
        }
        // Queue disturbances propagate ONLY through the accepted adjacent-cell
        // fluxes below. Do not replay a remote bottleneck's braking signal in
        // every dense cell: that creates new restrictions all along a clearing
        // queue, even where downstream receiving space has already recovered.
        face.fill(0);
        leaving.fill(0);
        joining.fill(0);
        currentCapacity.set(faceCapacity);
        for (const id of classIds) {
            classFace.get(id).fill(0);
            classLeave.get(id).fill(0);
            classJoin.get(id).fill(0);
        }
        for (const release of releases) {
            const densityBefore = density[release.face - 1] ?? 0;
            if (densityBefore > critical * 1.15) {
                // Independent lane departures create actual local flow changes. A
                // pause on one of two open lanes does not stop both lanes together.
                // Disturbances then travel solely through adjacent conserved fluxes.
                const open = flowPolicy(release.event).openMainLanes;
                let service = 0;
                for (let lane = 0; lane < open; lane++)
                    service += platoonServiceFactor(release.event.id + ':lane:' + lane, previous.minute + sub * dtMin);
                const shoulder = release.event.settings.shoulder === 'open' ? .65 : 0;
                const factor = (service + shoulder) / (open + shoulder);
                currentCapacity[release.face] = Math.min(currentCapacity[release.face] * factor, release.maximum);
            }
        }
        const arrived = demandVph / 60 * dtMin;
        offeredTotal += arrived;
        const available = arrived + backlog;
        face[0] = Math.min(available, receive[0], currentCapacity[0] * dtMin / 60);
        backlog = Math.max(0, available - face[0]);
        for (const j of junctions) {
            const arrived = j.entryVph * dtMin / 60;
            j.waiting += arrived;
            j.offeredTotal += arrived;
            offeredTotal += arrived;
        }
        for (let i = 1; i < n; i++) {
            const local = localAt.get(i), departures = departuresAt.get(i) ?? noPorts;
            const returnPorts = returnsAt.get(i) ?? noPorts;
            if (!local && !departures.length && !returnPorts.length) {
                face[i] = Math.min(send[i - 1], receive[i], currentCapacity[i] * dtMin / 60);
                for (const id of classIds)
                    classFace.get(id)[i] = occupancy[i - 1] > 0 ?
                        face[i] * classStock.get(id)[i - 1] / occupancy[i - 1] : 0;
                continue;
            }
            const sent = new Map(classIds.map(id => [id, occupancy[i - 1] > 0 ?
                    send[i - 1] * classStock.get(id)[i - 1] / occupancy[i - 1] : 0]));
            const ordinarySend = Math.max(0, send[i - 1] - [...sent.values()].reduce((s, v) => s + v, 0));
            const totalInterest = departures.filter(p => !p.vehicleClass).reduce((s, p) => s + p.interestPercent, 0);
            const normalFraction = (local?.exitPercent ?? 0) / 100;
            const detourFraction = Math.min(1, totalInterest / 100);
            const normalWanted = Math.min(ordinarySend, send[i - 1] * normalFraction);
            const normalRequest = Math.min(normalWanted, (local?.exitCapacityVph ?? 0) * dtMin / 60);
            const wanted = departures.map(p => p.vehicleClass ? (sent.get(p.vehicleClass) ?? 0) *
                Math.min(1, departures.filter(q => q.vehicleClass === p.vehicleClass).reduce((s, q) => s + q.interestPercent, 0) / 100) *
                p.interestPercent / Math.max(1e-9, departures.filter(q => q.vehicleClass === p.vehicleClass).reduce((s, q) => s + q.interestPercent, 0)) :
                totalInterest > 0 ? Math.max(0, ordinarySend - normalWanted) * detourFraction * p.interestPercent / totalInterest : 0);
            if (local)
                local.lastExitDemand += normalWanted + wanted.reduce((s, v) => s + v, 0);
            const requested = departures.map((p, k) => Math.min(wanted[k], p.exitCapacityVph * dtMin / 60, Math.max(0, p.exitCapacityVph / 60 - p.left)));
            const requestedTotal = normalRequest + requested.reduce((s, x) => s + x, 0);
            // Local destination traffic and diversion traffic share the SAME exit.
            const exitLimit = local?.exitCapacityVph ?? (departures.some(p => p.motorway) ? 1500 : baselineCapacity(route.key));
            const scale = requestedTotal > 0 ? Math.min(1, exitLimit * dtMin / 60 / requestedTotal) : 0;
            departures.forEach((p, k) => {
                const accepted = requested[k] * scale;
                p.left += accepted;
                leaving[i - 1] += accepted;
                if (p.vehicleClass)
                    classLeave.get(p.vehicleClass)[i - 1] += accepted;
            });
            if (local) {
                const accepted = normalRequest * scale;
                local.lastExited += accepted;
                local.exitedTotal += accepted;
                exitedTotal += accepted;
                leaving[i - 1] += accepted;
            }
            const passage = passages.get(i);
            const mainSend = passage ? Math.max(0, (sent.get(passage.vehicleClass) ?? 0) -
                departures.reduce((s, p, k) => s + (p.vehicleClass === passage.vehicleClass ? wanted[k] : 0), 0)) :
                Math.max(0, send[i - 1] - normalWanted - wanted.reduce((s, v) => s + v, 0));
            const returns = returnPorts.length ? returnPorts.filter(p => p.returnVehicles - p.joined > 1e-9) : noPorts;
            const localEntry = local && !local.entryBlocked ? Math.min(local.waiting, local.entryCapacityVph * dtMin / 60) : 0;
            const mergeDemand = localEntry + returns.reduce((s, p) => s + Math.min(p.returnVehicles - p.joined, 1200 * dtMin / 60), 0);
            const mergeLimit = Math.min(mergeDemand, (local?.entryCapacityVph ?? 1200) * dtMin / 60);
            const room = Math.min(receive[i], currentCapacity[i] * dtMin / 60);
            let main = Math.min(mainSend, room), merge = 0;
            if (mergeDemand > 0) {
                merge = Math.min(mergeLimit, room * .22);
                main = Math.min(mainSend, room - merge);
                merge = Math.min(mergeLimit, room - main);
            }
            for (const p of returns) {
                const accepted = merge * Math.min(p.returnVehicles - p.joined, 1200 * dtMin / 60) / mergeDemand;
                p.joined += accepted;
                joining[i] += accepted;
                if (p.returnClass)
                    classJoin.get(p.returnClass)[i] += accepted;
            }
            if (local && localEntry > 0) {
                const accepted = merge * localEntry / mergeDemand;
                local.waiting = Math.max(0, local.waiting - accepted);
                local.enteredTotal += accepted;
                local.lastEntered += accepted;
                joining[i] += accepted;
                for (const rule of classifications)
                    if (rule.metre <= 0 && i * previous.cellM < rule.untilM ||
                        rule.metre > 0 && Math.round(rule.metre / previous.cellM) === i)
                        classJoin.get(rule.vehicleClass)[i] += accepted * rule.sharePercent / 100;
            }
            face[i] = main;
            for (const id of classIds) {
                const retained = passage && id !== passage.vehicleClass ? 0 :
                    (sent.get(id) ?? 0) - departures.reduce((s, p, k) => s + (p.vehicleClass === id ? wanted[k] : 0), 0);
                classFace.get(id)[i] = mainSend > 0 ? main * Math.max(0, retained) / mainSend : 0;
            }
        }
        face[n] = Math.min(send[n - 1], currentCapacity[n] * dtMin / 60);
        for (const id of classIds)
            classFace.get(id)[n] = occupancy[n - 1] > 0 ?
                face[n] * classStock.get(id)[n - 1] / occupancy[n - 1] : 0;
        for (const rule of classifications) {
            if (rule.metre <= 0) {
                classJoin.get(rule.vehicleClass)[0] += face[0] * rule.sharePercent / 100;
                continue;
            }
            const at = Math.max(1, Math.min(n - 1, Math.round(rule.metre / previous.cellM)));
            const otherInterest = (departuresAt.get(at) ?? []).filter(p => !p.vehicleClass).reduce((s, p) => s + p.interestPercent, 0);
            const ratio = Math.min(1, rule.sharePercent / Math.max(1e-9, 100 - Math.min(100, otherInterest)));
            const already = classIds.reduce((s, id) => s + classFace.get(id)[at], 0);
            classJoin.get(rule.vehicleClass)[at] += Math.max(0, face[at] - already) * ratio;
        }
        for (const at of observationFaces)
            if (density[at - 1] >= critical * 1.10) {
                // A queue blocked by a different downstream event cannot measure this
                // worksite's own service. Sample its braking phases only when the next
                // cell could accept its nominal discharge; keep the prior otherwise.
                const wanted = Math.min(send[at - 1], faceCapacity[at] * dtMin / 60, capacity[at - 1] * dtMin / 60, at < n ? capacity[at] * dtMin / 60 : Infinity);
                if (!exitObservations.has(at) && at < n && receive[at] + 1e-9 < wanted)
                    continue;
                observationHours[at] += dtMin / 60;
                observationVehicles[at] += exitObservations.has(at) ? leaving[at - 1] : face[at];
            }
        exitedTotal += face[n];
        for (let i = 0; i < n; i++) {
            occupancy[i] = Math.max(0, occupancy[i] + face[i] + joining[i] - face[i + 1] - leaving[i]);
            cumulativeOut[i] += face[i + 1] + leaving[i];
            if (occupancy[i] > jam * dx + 1e-5)
                throw Error('Zellmodell: Speicherdichte überschritten');
            for (const id of classIds) {
                const stock = classStock.get(id);
                const value = stock[i] + classFace.get(id)[i] + classJoin.get(id)[i] - classFace.get(id)[i + 1] - classLeave.get(id)[i];
                if (value < -1e-6)
                    throw Error('Zielgebundener Fahrzeugbestand wurde negativ');
                stock[i] = Math.max(0, value);
            }
        }
        for (let i = 0; i <= n; i++)
            through[i] += face[i];
    }
    const cells = previous.cells.map((c, i) => {
        const densityVehKm = occupancy[i] / dx;
        const outflowVph = cumulativeOut[i] * 60;
        // Density/flow give local velocity. The physically clear free-flow state
        // remains green when the cell has no vehicles or is initially settling.
        const speedKmh = densityVehKm < .05 ? freeSpeedKmh(route.key) :
            Math.min(speeds[i], outflowVph / Math.max(.05, densityVehKm));
        const travelFlowVph = (c.travelFlowVph ?? c.flowVph) * (1 - TRAVEL_ALPHA) + outflowVph * TRAVEL_ALPHA;
        const active = Number.isFinite(faceCapacity[i + 1]), oldDetector = c.travelDetector;
        const exit = closures.find(g => g.face === i + 1 && g.diverting);
        const detectorCapacity = exit ? (localAt.get(i + 1)?.exitCapacityVph ?? baselineCapacity(route.key)) :
            active ? faceCapacity[i + 1] : capacity[i];
        const observed = observationHours[i + 1] > 0;
        const detectorFlow = observed ? observationVehicles[i + 1] / observationHours[i + 1] : detectorCapacity;
        // Changing time-of-day demand may slightly change effective capacity.
        // Only an edited/opened physical control resets the observations.
        const control = faceControls[i + 1] + (exit ? '|exit:' + exit.exitRef : ''), sameControl = oldDetector?.control === control;
        let queued = 0;
        if (active && detectorCapacity > 0)
            for (let k = i; k >= 0; k--) {
                if (occupancy[k] / dx >= critical * 1.10 || (previous.cells[k].queueMemoryMin ?? 0) > 0)
                    queued += occupancy[k];
                else
                    break;
            }
        // A journey lasting many minutes spans several braking/platoon phases.
        // Estimate its service from a representative period, instead of making
        // every car ahead inherit the latest short braking phase. Warm up
        // new/edited detectors quickly; reopened detectors must recover promptly.
        // The observation horizon must not feed its own old near-zero mean back
        // into itself: that would freeze a recovering detector for days.
        const window = active && sameControl && oldDetector.samples >= 12 && detectorCapacity > 0 ?
            Math.max(6, queued / detectorCapacity * 60) : 6;
        const detectorAlpha = 1 - Math.exp(-1 / window);
        const travelDetector = active || oldDetector ? {
            control, capacityVph: detectorCapacity, active, diversionExitRef: exit?.exitRef ?? undefined,
            samples: (sameControl ? oldDetector.samples : 0) + (observed ? 1 : 0),
            meanFlowVph: !sameControl ? detectorFlow :
                observed ? oldDetector.meanFlowVph * (1 - detectorAlpha) + detectorFlow * detectorAlpha : oldDetector.meanFlowVph
        } : undefined;
        return { ...c, vehicles: occupancy[i], flowVph: outflowVph,
            speedKmh: Math.max(0, speedKmh), densityVehKm,
            queueMemoryMin: densityVehKm >= critical * 1.10 ? 3 : Math.max(0, (c.queueMemoryMin ?? 0) - 1),
            travelFlowVph, limitKmh: speeds[i], travelDetector,
            approachLimitKmh: Number.isFinite(approachLimit[i]) ? approachLimit[i] : undefined,
            routedVehicles: classIds.length ? Object.fromEntries(classIds.map(id => [id, classStock.get(id)[i]]).filter(([, v]) => Number(v) > 1e-9)) : undefined,
            blockedAtM: faceCapacity[i + 1] === 0 ? c.toM : undefined,
            reopeningForecast: controls.forecasts.get(i + 1) };
    });
    const limiting = faceCapacity.reduce((best, c, i) => c < faceCapacity[best] ? i : best, 0);
    const next = { ...previous, cells, closures, minute: previous.minute + 1, backlog, offeredTotal, exitedTotal,
        classifiedJourneys: [...classifiedJourneys],
        junctions: junctions.map(({ face: _, entryBlocked: __, ...j }) => j),
        divertedTotal: (previous.divertedTotal ?? 0) + routed.reduce((s, p) => s + p.left, 0),
        rejoinedTotal: (previous.rejoinedTotal ?? 0) + routed.reduce((s, p) => s + p.joined, 0),
        lastTransfers: routed.map(p => ({ id: p.id, leaveVpm: p.left, joinVpm: p.joined })),
        dischargeVph: through[Number.isFinite(faceCapacity[limiting]) ? limiting : n] * 60,
        capacityVph: Math.min(baselineCapacity(route.key), ...faceCapacity) };
    assertCellConservation(next);
    return next;
}
/** Display colors only where actual congested density exists; not an
 * arbitrary static strip. A separate speed-limit overlay covers worksites.
 */
export function cellSpeedBands(state) {
    const critical = cellCriticalDensity(state.pathKey);
    const bands = [];
    for (const c of state.cells) {
        if ((c.densityVehKm < critical * 1.10 && c.approachLimitKmh === undefined) || c.speedKmh > 65)
            continue;
        const color = colorAtSpeed(c.speedKmh);
        if (color === 'free')
            continue;
        const last = bands.at(-1);
        if (last?.color === color && Math.abs(last.toM - c.fromM) < .1) {
            last.toM = c.toM;
            last.speedKmh = Math.min(last.speedKmh, c.speedKmh);
        }
        else
            bands.push({ fromM: c.fromM, toM: c.toM, speedKmh: c.speedKmh, color, source: 'cell' });
    }
    return bands;
}
/** Queue approaches for route choice, independent of event type or AS
 * names. Dense moving packets and recently released cells belong to the
 * same queue; persistent free gaps keep independent queues separate.
 * This geographic span never adds free cells to the displayed jam length. */
export function cellQueueSpans(state) {
    const threshold = cellCriticalDensity(state.pathKey) * 1.10, spans = [];
    for (const c of state.cells) {
        if (c.densityVehKm < threshold && (c.queueMemoryMin ?? 0) <= 0 &&
            !(c.approachLimitKmh !== undefined && c.speedKmh <= 65))
            continue;
        const last = spans.at(-1);
        if (last && Math.abs(last.toM - c.fromM) < .1)
            last.toM = c.toM;
        else
            spans.push({ fromM: c.fromM, toM: c.toM });
    }
    return spans;
}
