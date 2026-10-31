import { positionM, closureGate } from './spatial.js?build=4bca424d0a51d349';
import { DIVERSION_LINKS, diversionJunctions, nearestExitBeforeQueue } from './diversions.js?build=4bca424d0a51d349';
import { speedDelayInCells } from './speed-delay.js?build=4bca424d0a51d349';
import { cellQueueSpans } from './traffic-cells.js?build=4bca424d0a51d349';
import { bundledTargets, isNetworkDestination } from './bundled-detours.js?build=4bca424d0a51d349';
import { junctionAccess, accessibleExits } from './road-controls.js?build=4bca424d0a51d349';
import { interchangeJourneys } from './interchange-journeys.js?build=4bca424d0a51d349';
import { INTERCHANGE_DIVERSION_START_MIN } from './interchange.js?build=4bca424d0a51d349';
export function automaticDiversions(events, corridors, exits, cells, connections = [], turnDelays = {}) {
    const plans = new Map();
    const available = (path, access) => accessibleExits(corridors[path], events, exits, access);
    for (const event of events) {
        if (event.pathKey.startsWith('ramp-'))
            continue;
        const path = event.pathKey, route = corridors[path], at = positionM(route, event.point);
        if (at === null)
            continue;
        const targets = bundledTargets(path, exits, route), all = targets.filter(x => !isNetworkDestination(x) && junctionAccess(route, events, x.metre, x.ref).exit);
        const section = closureGate(route, event, exits, events);
        const end = Math.min(route.lengthM, at + event.settings.lengthM + 50);
        const after = targets.filter(x => isNetworkDestination(x) || junctionAccess(route, events, x.metre, x.ref).entry && (section ? x.metre >= section.endM - 1 : x.metre > end));
        for (const connection of connections.filter(c => c.to === path && at > c.downstreamMergeM)) {
            // Prepare cross-motorway alternatives before the target queue reaches
            // the AD. The remaining journey's delay controls whether anyone uses it.
            const source = connection.from, to = after[0];
            const junctions = diversionJunctions(source, available(source, 'exit'), corridors[source]).filter(x => !x.isInterchange);
            const sources = source === 'A3-koeln' && path === 'A48-koblenz'
                ? junctions.filter(x => x.metre > connection.rampEntryM).slice(0, 1)
                : junctions.filter(x => x.metre < connection.rampEntryM - 50);
            for (const from of sources) {
                const link = { id: source + '-BUNDLED-' + from.ref + '-to-' + path, code: 'SIM', path: source,
                    fromRoad: from.road, fromRef: from.ref, toRoad: to.road, toRef: to.ref, evidence: 'partial',
                    description: 'Enthaltene simulierte Umfahrung des blockierten Autobahnknotens' };
                const key = link.id + ':' + to.ref;
                plans.set(source + ':' + from.ref + ':' + path, { key, event, path: source, from, to, link, targetPath: path,
                    movementId: connection.rampId, sourceEndM: connection.rampEntryM, targetEntryM: connection.downstreamMergeM, delayMin: null });
            }
        }
        for (const from of all.filter(x => section ? x.metre <= section.metre + 1 : x.metre < at - 50)) {
            const documented = DIVERSION_LINKS.find(l => l.path === path && l.fromRef === from.ref);
            const officialTarget = after.find(x => x.ref === documented?.toRef);
            const to = officialTarget ?? after[0];
            const link = officialTarget ? documented : { id: path + '-BUNDLED-' + from.ref, code: 'SIM', path,
                fromRoad: from.road, fromRef: from.ref, toRoad: to.road, toRef: to.ref, evidence: 'partial',
                description: 'Enthaltene simulierte Umleitung mit angenähertem Verlauf' };
            const time = cells[path] ? speedDelayInCells(cells[path], from.metre, to.metre) : null;
            // Prepare roads when a lane closes, before a long queue has formed.
            // Loading geometry itself never makes drivers leave: the cell node's
            // delay/extra-journey comparison still controls actual departures.
            if (event.kind !== 'closure' && event.closedLanes.length === 0 && (!time || !time.blocked && time.delayMin < 5))
                continue;
            const key = link.id + ':' + to.ref, choice = { key, event, path, from, to, link, delayMin: time?.blocked ? null : time?.delayMin ?? null };
            const old = plans.get(path + ':' + from.ref);
            if (!old || to.metre > old.to.metre)
                plans.set(path + ':' + from.ref, choice);
        }
    }
    // Congestion needs no named incident. Natural overload and queues still
    // clearing after an event use the same nearest-exit rule. Queue IDs are
    // internal route causes; no fictional event is added to the timeline.
    for (const [key, grid] of Object.entries(cells)) {
        if (!grid || key.startsWith('ramp-'))
            continue;
        const path = key, route = corridors[path], targets = bundledTargets(path, exits, route);
        for (const span of cellQueueSpans(grid)) {
            const time = speedDelayInCells(grid, span.fromM, span.toM, span.toM + grid.cellM);
            if (time.blocked || time.delayMin < 45 - 1e-9)
                continue;
            const from = nearestExitBeforeQueue(path, route, available(path, 'exit'), span.fromM);
            const to = targets.find(t => isNetworkDestination(t) || junctionAccess(route, events, t.metre, t.ref).entry && t.metre > span.toM + 1);
            if (from && to) {
                const old = plans.get(path + ':' + from.ref);
                if (!old || old.to.metre < span.toM - 1) {
                    const link = { id: path + '-BUNDLED-' + from.ref, code: 'SIM', path,
                        fromRoad: from.road, fromRef: from.ref, toRoad: to.road, toRef: to.ref, evidence: 'partial',
                        description: 'Enthaltene simulierte Stauumfahrung' };
                    const key = link.id + ':' + to.ref;
                    plans.set(path + ':' + from.ref, { key, event: null, causeId: 'queue:' + key, path, from, to, link, delayMin: time.delayMin });
                }
            }
            for (const connection of connections.filter(c => c.to === path && span.toM > c.downstreamMergeM)) {
                const source = connection.from, sourceRoute = corridors[source], sourceGrid = cells[source];
                const approach = sourceGrid && cellQueueSpans(sourceGrid).find(s => s.fromM < connection.rampEntryM &&
                    s.toM >= connection.rampEntryM - sourceGrid.cellM);
                const from = source === 'A3-koeln' && path === 'A48-koblenz'
                    ? diversionJunctions(source, available(source, 'exit'), sourceRoute).find(j => !j.isInterchange && j.metre > connection.rampEntryM)
                    : nearestExitBeforeQueue(source, sourceRoute, available(source, 'exit'), approach?.fromM ?? connection.rampEntryM, connection.rampEntryM);
                if (!from || !to || plans.has(source + ':' + from.ref + ':' + path))
                    continue;
                const link = { id: source + '-BUNDLED-' + from.ref + '-to-' + path, code: 'SIM', path: source,
                    fromRoad: from.road, fromRef: from.ref, toRoad: to.road, toRef: to.ref, evidence: 'partial',
                    description: 'Enthaltene simulierte Umfahrung des Autobahnknotens' };
                const key = link.id + ':' + to.ref;
                plans.set(source + ':' + from.ref + ':' + path, { key, event: null, causeId: 'queue:' + key, path: source, from, to, link,
                    targetPath: path, movementId: connection.rampId, sourceEndM: connection.rampEntryM, targetEntryM: connection.downstreamMergeM, delayMin: time.delayMin });
            }
        }
    }
    // All four AD movements need a route even when the queue is on their
    // source approach or on the turn itself. Preparing the two A48 targets
    // under distinct keys must not replace one destination with the other.
    for (const connection of connections) {
        const source = connection.from, target = connection.to, sourceRoute = corridors[source], targetRoute = corridors[target];
        const targetExits = bundledTargets(target, available(target, 'entry'), targetRoute);
        const first = diversionJunctions(target, available(target, 'exit'), targetRoute)
            .find(j => !j.isInterchange && j.metre > connection.downstreamMergeM + 1) ?? targetExits.at(-1);
        let end = connection.downstreamMergeM;
        const relevant = cells[target] ? cellQueueSpans(cells[target]).filter(s => s.fromM <= first.metre + 1 &&
            s.toM > connection.downstreamMergeM) : [];
        const sourceExits = diversionJunctions(source, available(source, 'exit'), sourceRoute).filter(j => !j.isInterchange);
        const lastSource = sourceExits.filter(j => j.metre < connection.rampEntryM - 1).at(-1);
        const sourceQueue = cells[source] && cellQueueSpans(cells[source]).some(s => s.toM >= (lastSource?.metre ?? connection.rampEntryM) - 1 && s.fromM < connection.rampEntryM);
        const sourceEvent = events.some(e => e.pathKey === source && (() => {
            const at = positionM(sourceRoute, e.point);
            return at !== null && at >= (lastSource?.metre ?? connection.rampEntryM) - 1 && at < connection.rampEntryM;
        })());
        const targetEvent = events.some(e => e.pathKey === target && (() => {
            const at = positionM(targetRoute, e.point);
            return at !== null && at + e.settings.lengthM > connection.downstreamMergeM && at <= first.metre;
        })());
        if (!sourceQueue && !sourceEvent && !targetEvent && !relevant.length && !events.some(e => e.pathKey === connection.rampId) &&
            (turnDelays[connection.rampId] ?? 0) < INTERCHANGE_DIVERSION_START_MIN)
            continue;
        for (const span of relevant)
            end = Math.max(end, span.toM);
        for (const event of events.filter(e => e.pathKey === target)) {
            const at = positionM(targetRoute, event.point);
            if (at === null || at + event.settings.lengthM <= connection.downstreamMergeM || at > Math.max(first.metre, end) + 150)
                continue;
            const closure = closureGate(targetRoute, event, exits, events);
            end = Math.max(end, closure?.endM ?? at + event.settings.lengthM + 50);
        }
        const to = targetExits.find(j => isNetworkDestination(j) || j.metre >= end - 1 && j.metre > connection.downstreamMergeM + 1);
        const all = sourceExits;
        // For Koblenz-bound traffic from Frankfurt the useful Cologne-side AS
        // is AFTER the normal AD turn: continue on A3 to Ransbach, then Höhr.
        let sources = source === 'A3-koeln' && target === 'A48-koblenz'
            ? all.filter(j => j.metre > connection.rampEntryM).slice(0, 1)
            : all.filter(j => j.metre < connection.rampEntryM - 1);
        if (!sourceEvent && !targetEvent && !events.some(e => e.pathKey === connection.rampId) && source !== 'A3-koeln') {
            const allowed = new Set();
            if (cells[source])
                for (const span of cellQueueSpans(cells[source])) {
                    if (span.toM < (lastSource?.metre ?? connection.rampEntryM) - 1)
                        continue;
                    const near = nearestExitBeforeQueue(source, sourceRoute, available(source, 'exit'), span.fromM, connection.rampEntryM);
                    for (const j of sources)
                        if (j.metre >= (near?.metre ?? span.fromM) - 25 && j.metre <= Math.min(span.toM, connection.rampEntryM) + 25)
                            allowed.add(j.ref);
                }
            if (relevant.length || (turnDelays[connection.rampId] ?? 0) > 0) {
                const approach = cells[source] && cellQueueSpans(cells[source]).find(s => s.fromM < connection.rampEntryM && s.toM >= connection.rampEntryM - cells[source].cellM);
                const near = nearestExitBeforeQueue(source, sourceRoute, available(source, 'exit'), approach?.fromM ?? connection.rampEntryM, connection.rampEntryM);
                for (const j of sources)
                    if (near && (j.ref === near.ref || approach && j.metre >= approach.fromM && j.metre <= connection.rampEntryM))
                        allowed.add(j.ref);
            }
            sources = sources.filter(j => allowed.has(j.ref));
        }
        for (const from of sources) {
            const mapKey = source + ':' + from.ref + ':' + target;
            const old = plans.get(mapKey);
            if (old && old.to.metre >= to.metre)
                continue;
            const link = { id: source + '-BUNDLED-' + from.ref + '-to-' + target, code: 'SIM', path: source,
                fromRoad: from.road, fromRef: from.ref, toRoad: to.road, toRef: to.ref, evidence: 'partial',
                description: 'Zielgerichtete simulierte Umfahrung des AD Dernbach' };
            const key = link.id + ':' + to.ref;
            plans.set(mapKey, { key, event: null, causeId: 'turn:' + connection.rampId, path: source, from, to, link,
                targetPath: target, movementId: connection.rampId, sourceEndM: connection.rampEntryM,
                targetEntryM: connection.downstreamMergeM, delayMin: null });
        }
    }
    // Preparing alternatives is not permission for remote exits to divert.
    return [...plans.values(), ...interchangeJourneys(events, corridors, exits, cells, connections, turnDelays)]
        .sort((a, b) => a.path.localeCompare(b.path) || b.from.metre - a.from.metre);
}
