import { positionM, closureGate } from './spatial.js?build=b0a387e5cb5e18cc';
import { baselineCapacity, eventCapacity } from './traffic.js?build=b0a387e5cb5e18cc';
import { flowPolicy } from './events.js?build=b0a387e5cb5e18cc';
import { colorAtSpeed, freeSpeedKmh } from './traffic-physics.js?build=b0a387e5cb5e18cc';
import { normalJunctionTraffic } from './junction-traffic.js?build=b0a387e5cb5e18cc';
const SUBSTEPS = 6, DT_MIN = 1 / SUBSTEPS, WAVE_KMH = 22, JAM_PER_LANE = 95;
// One observation per MODEL minute; repainting/pause never advances this.
const TRAVEL_ALPHA = 1 - Math.exp(-1 / 6);
export function cellLanes(path) {
    return path.startsWith('ramp-') ? 1 : path.startsWith('A48') ? 2 : 3;
}
export function cellCriticalDensity(path) {
    return JAM_PER_LANE * cellLanes(path) * WAVE_KMH / (freeSpeedKmh(path) + WAVE_KMH);
}
export function initialiseCells(route, initialDemandVph) {
    if (!Number.isFinite(initialDemandVph) || initialDemandVph < 0 || initialDemandVph > 8000)
        throw Error('Ungültiger Zufluss für Zellmodell');
    const count = Math.ceil(route.lengthM / 500);
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
}
function localControls(route, events, demandVph, count, cellM, exits = []) {
    const free = freeSpeedKmh(route.key), laneCount = cellLanes(route.key);
    const speeds = Array(count).fill(free);
    const faceCapacity = Array(count + 1).fill(Infinity);
    const faceControls = Array.from({ length: count + 1 }, () => []);
    const releases = [];
    const closedEntries = [];
    const closureGates = [];
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
            faceControls[face].push(event.id + ':closure');
            closedEntries.push({ fromM: gate.metre - 25, toM: gate.endM - 25 });
            closureGates.push({ face, fromM: gate.metre, toM: gate.endM, exitRef: gate.exit?.ref ?? null, eventId: event.id });
            continue;
        }
        for (let c = Math.floor(from / cellM); c < Math.min(count, Math.ceil(to / cellM)); c++) {
            speeds[c] = Math.min(speeds[c], event.settings.speedKmh === 0 ? free : event.settings.speedKmh);
        }
        const face = Math.max(1, Math.min(count, Math.round((from + Math.min(150, event.settings.lengthM)) / cellM)));
        faceCapacity[face] = Math.min(faceCapacity[face], eventCapacity(event, demandVph));
        faceControls[face].push(JSON.stringify([event.id, event.kind, event.closedLanes, event.settings]));
        const policy = flowPolicy(event);
        if (event.closedLanes.length && policy.openMainLanes > 0)
            releases.push({ face, event, maximum: 1800 * (policy.openMainLanes + (event.settings.shoulder === 'open' ? .65 : 0)) });
    }
    const jam = JAM_PER_LANE * laneCount;
    const capacity = speeds.map(v => Math.min(baselineCapacity(route.key), v * WAVE_KMH * jam / (v + WAVE_KMH)));
    return { speeds, capacity, faceCapacity, faceControls: faceControls.map(c => c.sort().join('|')), jam, releases, closedEntries, closureGates };
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
/** Correlated spatial differences in reaction time stretch/compress packets
 * along a queue. Adjacent cells do not get independent cosmetic noise. */
function reactionTravelMinutes(id, distanceM) {
    const seed = dischargeSeed(id), sectionM = 2700;
    let time = 0;
    for (let from = 0, index = 0; from < distanceM; from += sectionM, index++) {
        const speed = 16 + 8 * dischargeRandom(seed, index, 9);
        time += Math.min(sectionM, distanceM - from) / (speed * 1000 / 60);
    }
    return time;
}
/** Advance exactly one model minute, including six stable 10-second updates.
 * Domain demand not admitted at the map entry is retained in backlog.
 * Outflow is discharged at the far end. No arbitrary time-loss surcharges.
 */
export function advanceCells(previous, route, events, demandVph, exits = [], ports = [], junctionDemand = normalJunctionTraffic(route, exits, demandVph)) {
    if (previous.pathKey !== route.key || !Number.isFinite(demandVph) || demandVph < 0 || demandVph > 8000)
        throw Error('Zellmodell: Richtung oder Zufluss ungültig');
    const n = previous.cells.length, dx = previous.cellM / 1000;
    const controls = localControls(route, events, demandVph, n, previous.cellM, exits);
    const { speeds, capacity, faceCapacity, faceControls, jam, releases, closedEntries } = controls;
    const junctions = junctionDemand.map(d => {
        if (!Number.isFinite(d.entryVph) || d.entryVph < 0 || !Number.isFinite(d.exitPercent) || d.exitPercent < 0 || d.exitPercent > 100 ||
            !Number.isFinite(d.metre) || d.metre < 0 || d.metre >= route.lengthM ||
            !Number.isFinite(d.entryCapacityVph) || !Number.isFinite(d.exitCapacityVph) || d.entryCapacityVph <= 0 || d.exitCapacityVph <= 0)
            throw Error('Ungültiger Anschlussstellenzufluss');
        const old = previous.junctions?.find(j => j.id === d.id);
        return { ...d, waiting: old?.waiting ?? 0, offeredTotal: old?.offeredTotal ?? 0,
            enteredTotal: old?.enteredTotal ?? 0, exitedTotal: old?.exitedTotal ?? 0, lastEntered: 0, lastExited: 0,
            face: Math.max(1, Math.min(n - 1, Math.round(d.metre / previous.cellM))),
            entryBlocked: closedEntries.some(c => d.metre >= c.fromM && d.metre < c.toM) };
    });
    // An existing ramp queue is a vehicle inventory, even if a caller stops
    // offering new local demand. It may still merge and must never be dropped.
    for (const old of previous.junctions ?? [])
        if (!junctions.some(j => j.id === old.id))
            junctions.push({
                ...old, entryVph: 0, lastEntered: 0, lastExited: 0, face: Math.max(1, Math.min(n - 1, Math.round(old.metre / previous.cellM))),
                entryBlocked: closedEntries.some(c => old.metre >= c.fromM && old.metre < c.toM)
            });
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
    const occupancy = previous.cells.map(c => c.vehicles);
    const closures = controls.closureGates.map(g => ({ ...g, diverting: g.exitRef !== null &&
            routed.filter(p => p.from === g.face).reduce((n, p) => n + p.interestPercent, 0) >= 100 - .001 }));
    let backlog = previous.backlog, offeredTotal = previous.offeredTotal, exitedTotal = previous.exitedTotal;
    const cumulativeOut = Array(n).fill(0);
    const through = Array(n + 1).fill(0);
    for (let sub = 0; sub < SUBSTEPS; sub++) {
        const density = occupancy.map(x => x / dx);
        const send = density.map((k, i) => Math.min(speeds[i] * k, capacity[i]) * DT_MIN / 60);
        // Slow-to-start/platoon reaction inside an ACTUAL dense queue. The
        // bottleneck signal travels upstream at finite wave speed and limits
        // actual sending flow. Released gaps and braking packets therefore
        // change cell vehicle counts, local speeds and subsequent queue length.
        for (let i = 0; i < n; i++) {
            if (density[i] <= jam * WAVE_KMH / (freeSpeedKmh(route.key) + WAVE_KMH) * 1.15)
                continue;
            const next = releases.filter(r => r.face > i).sort((a, b) => a.face - b.face)[0];
            if (!next)
                continue;
            const distance = (next.face - i - .5) * previous.cellM;
            const signal = previous.minute + sub * DT_MIN - reactionTravelMinutes(next.event.id, distance);
            const reaction = Math.min(1, platoonServiceFactor(next.event.id, signal));
            send[i] = Math.min(send[i], capacity[i] * reaction * DT_MIN / 60);
        }
        const receive = density.map((k, i) => Math.min(WAVE_KMH * Math.max(0, jam - k), capacity[i]) * DT_MIN / 60);
        const face = Array(n + 1).fill(0);
        const leaving = Array(n).fill(0), joining = Array(n).fill(0);
        const currentCapacity = [...faceCapacity];
        for (const release of releases) {
            const densityBefore = density[release.face - 1] ?? 0;
            if (densityBefore > jam * WAVE_KMH / (freeSpeedKmh(route.key) + WAVE_KMH) * 1.15) {
                currentCapacity[release.face] = Math.min(currentCapacity[release.face] * platoonServiceFactor(release.event.id, previous.minute + sub * DT_MIN), release.maximum);
            }
        }
        const arrived = demandVph / 60 * DT_MIN;
        offeredTotal += arrived;
        const available = arrived + backlog;
        face[0] = Math.min(available, receive[0], currentCapacity[0] * DT_MIN / 60);
        backlog = Math.max(0, available - face[0]);
        for (const j of junctions) {
            const arrived = j.entryVph * DT_MIN / 60;
            j.waiting += arrived;
            j.offeredTotal += arrived;
            offeredTotal += arrived;
        }
        for (let i = 1; i < n; i++) {
            const local = junctions.find(j => j.face === i);
            const departures = routed.filter(p => p.from === i && p.interestPercent > 0);
            const totalInterest = departures.reduce((s, p) => s + p.interestPercent, 0);
            const normalFraction = (local?.exitPercent ?? 0) / 100;
            const detourFraction = (1 - normalFraction) * Math.min(1, totalInterest / 100);
            const fraction = normalFraction + detourFraction;
            const normalRequest = Math.min(send[i - 1] * normalFraction, (local?.exitCapacityVph ?? 0) * DT_MIN / 60);
            const requested = departures.map(p => Math.min(send[i - 1] * detourFraction * p.interestPercent / totalInterest, p.exitCapacityVph * DT_MIN / 60, Math.max(0, p.exitCapacityVph / 60 - p.left)));
            const requestedTotal = normalRequest + requested.reduce((s, x) => s + x, 0);
            // Local destination traffic and diversion traffic share the SAME exit.
            const scale = requestedTotal > 0 ? Math.min(1, (local?.exitCapacityVph ?? 1200) * DT_MIN / 60 / requestedTotal) : 0;
            departures.forEach((p, k) => { const accepted = requested[k] * scale; p.left += accepted; leaving[i - 1] += accepted; });
            if (local) {
                const accepted = normalRequest * scale;
                local.lastExited += accepted;
                local.exitedTotal += accepted;
                exitedTotal += accepted;
                leaving[i - 1] += accepted;
            }
            const mainSend = send[i - 1] * (1 - fraction);
            const returns = routed.filter(p => p.to === i && p.returnVehicles - p.joined > 1e-9 && p.toM !== null &&
                !closedEntries.some(c => p.toM >= c.fromM && p.toM < c.toM));
            const localEntry = local && !local.entryBlocked ? Math.min(local.waiting, local.entryCapacityVph * DT_MIN / 60) : 0;
            const mergeDemand = localEntry + returns.reduce((s, p) => s + Math.min(p.returnVehicles - p.joined, 1200 * DT_MIN / 60), 0);
            const mergeLimit = Math.min(mergeDemand, (local?.entryCapacityVph ?? 1200) * DT_MIN / 60);
            const room = Math.min(receive[i], currentCapacity[i] * DT_MIN / 60);
            let main = Math.min(mainSend, room), merge = 0;
            if (mergeDemand > 0) {
                merge = Math.min(mergeLimit, room * .22);
                main = Math.min(mainSend, room - merge);
                merge = Math.min(mergeLimit, room - main);
            }
            for (const p of returns) {
                const accepted = merge * Math.min(p.returnVehicles - p.joined, 1200 * DT_MIN / 60) / mergeDemand;
                p.joined += accepted;
                joining[i] += accepted;
            }
            if (local && localEntry > 0) {
                const accepted = merge * localEntry / mergeDemand;
                local.waiting = Math.max(0, local.waiting - accepted);
                local.enteredTotal += accepted;
                local.lastEntered += accepted;
                joining[i] += accepted;
            }
            face[i] = main;
        }
        face[n] = Math.min(send[n - 1], currentCapacity[n] * DT_MIN / 60);
        exitedTotal += face[n];
        for (let i = 0; i < n; i++) {
            occupancy[i] = Math.max(0, occupancy[i] + face[i] + joining[i] - face[i + 1] - leaving[i]);
            cumulativeOut[i] += face[i + 1] + leaving[i];
            if (occupancy[i] > jam * dx + 1e-5)
                throw Error('Zellmodell: Speicherdichte überschritten');
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
        const detectorCapacity = exit ? 1200 : active ? faceCapacity[i + 1] : capacity[i];
        const detectorFlow = (exit ? cumulativeOut[i] - through[i + 1] : through[i + 1]) * 60;
        // Changing time-of-day demand may slightly change effective capacity.
        // Only an edited/opened physical control resets the observations.
        const control = faceControls[i + 1] + (exit ? '|exit:' + exit.exitRef : ''), sameControl = oldDetector?.control === control;
        let queued = 0, found = false;
        if (active && detectorCapacity > 0)
            for (let k = i; k >= 0; k--) {
                if (occupancy[k] / dx >= jam * WAVE_KMH / (freeSpeedKmh(route.key) + WAVE_KMH) * 1.10) {
                    queued += occupancy[k];
                    found = true;
                }
                else if (found)
                    break;
            }
        // A journey lasting many minutes spans several braking/platoon phases.
        // Estimate its service from a representative period, instead of making
        // every car ahead inherit the latest ten-second braking phase. Warm up
        // new/edited detectors quickly; reopened detectors must recover promptly.
        const window = active && sameControl && oldDetector.samples >= 12 ?
            Math.max(6, queued / Math.max(1, oldDetector.meanFlowVph) * 60) : 6;
        const detectorAlpha = 1 - Math.exp(-1 / window);
        const travelDetector = active || oldDetector ? {
            control, capacityVph: detectorCapacity, active, diversionExitRef: exit?.exitRef ?? undefined,
            samples: sameControl ? oldDetector.samples + 1 : 1,
            meanFlowVph: !sameControl ? detectorFlow :
                oldDetector.meanFlowVph * (1 - detectorAlpha) + detectorFlow * detectorAlpha
        } : undefined;
        return { ...c, vehicles: occupancy[i], flowVph: outflowVph,
            speedKmh: Math.max(0, speedKmh), densityVehKm,
            travelFlowVph, limitKmh: speeds[i], travelDetector,
            blockedAtM: faceCapacity[i + 1] === 0 ? c.toM : undefined };
    });
    const limiting = faceCapacity.reduce((best, c, i) => c < faceCapacity[best] ? i : best, 0);
    const next = { ...previous, cells, closures, minute: previous.minute + 1, backlog, offeredTotal, exitedTotal,
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
        if (c.densityVehKm < critical * 1.10 || c.speedKmh > 65)
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
