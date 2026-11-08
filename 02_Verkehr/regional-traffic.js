import { exitPosition } from '../core.js?build=9b249171bed12707';
import { positionM, closureGate } from '../spatial.js?build=9b249171bed12707';
import { profileFactor, REFERENCE_PEAKS } from '../traffic-profiles.js?build=9b249171bed12707';
const anchorCache = new WeakMap();
function anchor(route, exits, ref) {
    let cached = anchorCache.get(route);
    if (!cached) {
        cached = new Map();
        anchorCache.set(route, cached);
    }
    if (cached.has(ref))
        return cached.get(ref);
    let metre;
    if (ref === 'city')
        metre = positionM(route, route.key === 'A3-koeln' ? [50.9316883, 7.0523016] : [50.9319642, 7.051661], 20);
    else {
        const road = route.key.startsWith('A48') ? 'A48' : route.key.startsWith('extra-a59-') ? 'A59' : 'A560';
        const exit = exits.find(e => e.road === road && e.ref === ref);
        metre = exit ? positionM(route, exitPosition(exit, route.key), 50) : null;
    }
    if (metre !== null) {
        metre = Math.max(1, Math.min(route.lengthM - 1, metre));
        cached.set(ref, metre);
    }
    return metre;
}
function uncachedShape(route, exits, moment) {
    const key = route.key;
    if (key === 'A3-koeln' || key === 'A3-frankfurt') {
        const at = anchor(route, exits, 'city');
        if (at === null)
            return { initial: 1, steps: [] };
        const peak = key === 'A3-koeln' ? 6700 : 6500;
        const ratio = peak / REFERENCE_PEAKS[key] * profileFactor(key, moment, 'ring') / profileFactor(key, moment);
        const before = key === 'A3-koeln' ? 1 : ratio, after = key === 'A3-koeln' ? ratio : 1;
        return { initial: before, steps: [{ metre: at, ref: '28', before, after }] };
    }
    let ref, before, after;
    if (key === 'A48-dernbach') {
        ref = '11';
        before = 1.55;
        after = 1;
    }
    else if (key === 'A48-koblenz') {
        ref = '11';
        before = 1;
        after = 1.55;
    }
    else if (key === 'extra-a59-bonn') {
        ref = '33';
        before = .42;
        after = 1;
    }
    else if (key === 'extra-a59-koeln') {
        ref = '33';
        before = 1;
        after = .55;
    }
    else if (key === 'extra-a560-hennef') {
        ref = '5';
        before = 1;
        after = .78;
    }
    else if (key === 'extra-a560-bonn') {
        ref = '5';
        before = .78;
        after = 1;
    }
    else
        return { initial: 1, steps: [] };
    const at = anchor(route, exits, ref);
    return at === null ? { initial: 1, steps: [] } : { initial: before, steps: [{ metre: at, ref, before, after }] };
}
const shapeCache = new WeakMap();
function shape(route, exits, moment) {
    const cached = shapeCache.get(route), time = moment.getTime();
    if (cached?.time === time)
        return cached.value;
    const value = uncachedShape(route, exits, moment);
    shapeCache.set(route, { time, value });
    return value;
}
export function regionalFlowAt(route, exits, referenceVph, metre, moment) {
    const plan = shape(route, exits, moment);
    let factor = plan.initial;
    for (const s of plan.steps)
        if (metre >= s.metre)
            factor = s.after;
    return Math.max(0, referenceVph * factor);
}
export function regionalBoundaryFlow(route, exits, referenceVph, moment) {
    return regionalFlowAt(route, exits, referenceVph, 0, moment);
}
/** Merge a regional exchange into its existing AS node. A node face owns
 * exactly one queue; a regional addition must not overwrite a local ledger. */
export function regionalJunctionDemands(route, exits, referenceVph, moment, ordinary, events = []) {
    const result = ordinary.map(j => ({ ...j }));
    for (const step of shape(route, exits, moment).steps) {
        const before = referenceVph * step.before, after = referenceVph * step.after;
        const old = result.find(j => j.ref === step.ref && Math.abs(j.metre - step.metre) < 25);
        const base = old ?? { id: route.key + ':regional:' + step.ref, ref: step.ref, metre: step.metre, entryVph: 0, exitPercent: 0,
            entryCapacityVph: 8000, exitCapacityVph: 8000, exitTerminalVph: 8000, exitStorageVehicles: 200 };
        const entryClosed = events.some(event => { const gate = closureGate(route, event, exits, events); return gate && step.metre >= gate.metre && step.metre < gate.endM; });
        const normalShare = base.exitPercent / 100;
        if (step.after >= step.before) {
            if (!entryClosed)
                base.entryVph += (after - before) * (1 - normalShare);
        }
        else
            base.exitPercent = step.before > 0 ? 100 * (1 - (1 - normalShare) * step.after / step.before) : base.exitPercent;
        if (!old)
            result.push(base);
    }
    return result;
}
export function regionalDescription(key) {
    if (key.startsWith('A3-'))
        return 'Regionaler A3-Referenzwert; zwischen Heumar und Köln-Ost eigener, deutlich höherer Kölner Ringverkehr.';
    if (key.startsWith('A48-'))
        return 'Regionaler A48-Referenzwert; am Rheinübergang Bendorf zusätzliche lokale Belastung.';
    if (key === 'extra-a59-bonn')
        return 'Referenz für die Hauptstrecke südlich Porz; die schmale Heumar-Zufahrt führt nur einen Teil, Porz ergänzt den übrigen Modellzufluss.';
    if (key === 'extra-a59-koeln')
        return 'Referenz für die Hauptstrecke bis Porz; dort zweigt ein Teil des Modellverkehrs Richtung A559 ab.';
    if (key.startsWith('extra-a560-'))
        return 'Referenz für den westlichen A560-Abschnitt; jenseits Bonn/Siegburg eigener geringerer Durchgangsanteil.';
    return 'Eigener Spitzenstunden-Referenzwert für diesen Fahrweg.';
}
