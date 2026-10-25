import { positionM, closureGate } from './spatial.js?build=e5dc2a5d589428ef';
import { DIVERSION_LINKS, diversionJunctions, nearestExitBeforeQueue } from './diversions.js?build=e5dc2a5d589428ef';
import { speedDelayInCells } from './speed-delay.js?build=e5dc2a5d589428ef';
import { cellQueueSpans } from './traffic-cells.js?build=e5dc2a5d589428ef';
import { bundledTargets, isNetworkDestination } from './bundled-detours.js?build=e5dc2a5d589428ef';
export function automaticDiversions(events, corridors, exits, cells, connections = []) {
    const plans = new Map();
    for (const event of events) {
        if (event.pathKey.startsWith('ramp-'))
            continue;
        const path = event.pathKey, route = corridors[path], at = positionM(route, event.point);
        if (at === null)
            continue;
        const targets = bundledTargets(path, exits, route), all = targets.filter(x => !isNetworkDestination(x));
        const section = closureGate(route, event, exits);
        const end = Math.min(route.lengthM, at + event.settings.lengthM + 50);
        const after = targets.filter(x => isNetworkDestination(x) || (section ? x.metre >= section.endM - 1 : x.metre > end));
        for (const connection of connections.filter(c => c.to === path && at > c.downstreamMergeM)) {
            // Prepare cross-motorway alternatives before the target queue reaches
            // the AD. The remaining journey's delay controls whether anyone uses it.
            const source = connection.from, to = after[0];
            const sources = diversionJunctions(source, exits, corridors[source]).filter(x => !x.isInterchange && x.metre < connection.rampEntryM - 50);
            for (const from of sources) {
                const link = { id: source + '-BUNDLED-' + from.ref + '-to-' + path, code: 'SIM', path: source,
                    fromRoad: from.road, fromRef: from.ref, toRoad: to.road, toRef: to.ref, evidence: 'partial',
                    description: 'Enthaltene simulierte Umfahrung des blockierten Autobahnknotens' };
                const key = link.id + ':' + to.ref;
                plans.set(source + ':' + from.ref, { key, event, path: source, from, to, link, targetPath: path,
                    sourceEndM: connection.rampEntryM, targetEntryM: connection.downstreamMergeM, delayMin: null });
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
            const from = nearestExitBeforeQueue(path, route, exits, span.fromM);
            const to = targets.find(t => isNetworkDestination(t) || t.metre > span.toM + 1);
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
                const from = nearestExitBeforeQueue(source, sourceRoute, exits, approach?.fromM ?? connection.rampEntryM, connection.rampEntryM);
                if (!from || !to || plans.has(source + ':' + from.ref))
                    continue;
                const link = { id: source + '-BUNDLED-' + from.ref + '-to-' + path, code: 'SIM', path: source,
                    fromRoad: from.road, fromRef: from.ref, toRoad: to.road, toRef: to.ref, evidence: 'partial',
                    description: 'Enthaltene simulierte Umfahrung des Autobahnknotens' };
                const key = link.id + ':' + to.ref;
                plans.set(source + ':' + from.ref, { key, event: null, causeId: 'queue:' + key, path: source, from, to, link,
                    targetPath: path, sourceEndM: connection.rampEntryM, targetEntryM: connection.downstreamMergeM, delayMin: time.delayMin });
            }
        }
    }
    // Preparing alternatives is not permission for remote exits to divert.
    return [...plans.values()].sort((a, b) => a.path.localeCompare(b.path) || b.from.metre - a.from.metre);
}
