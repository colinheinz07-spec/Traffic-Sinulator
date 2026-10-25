/** Direction-specific entrance/exit situation for the A3/A48 simulator.
 * Targets are PLANNED route-choice percentages, not counted departures.
 * Counted values come from ordinary junction cells and detour ledgers.
 * Every normal AS is covered; AK/AD are separate motorway nodes and cannot
 * be misrepresented as exits onto local roads.
 */
import { names } from './core.js?build=0e7a141e43a790ca';
import { positionM, closureGate } from './spatial.js?build=0e7a141e43a790ca';
import { diversionJunctions } from './diversions.js?build=0e7a141e43a790ca';
/** A formal closure forces departure only at the LAST usable normal exit.
 * Earlier exits are voluntary alternatives chosen by remaining time loss,
 * independently of the tail's distance from any junction.
 * The requested exit intention is never a claim that a
 * ramp can absorb an unlimited traffic stream.
 */
export function junctionMovements(path, route, exits, events, _delayMin, real = [], local = []) {
    const junctions = diversionJunctions(path, exits, route);
    const rows = junctions.map((exit) => ({
        path, exit, desiredPercent: 0, mandatory: false, entryClosed: false, eventId: null, distanceBeforeClosureKm: null,
        outVph: 0, inVph: 0, vehiclesOnDetour: 0, waitingAtReentry: 0, validatedRouteActive: false,
        normalOutVph: 0, normalInVph: 0, diversionOutVph: 0, returningInVph: 0, waitingToEnter: 0
    }));
    for (const event of events.filter(x => x.pathKey === path)) {
        const at = positionM(route, event.point);
        if (at === null)
            continue;
        if (event.kind === 'closure') {
            const gate = closureGate(route, event, exits);
            if (gate)
                for (const row of rows)
                    if (!row.exit.isInterchange &&
                        row.exit.metre >= gate.metre - 25 && row.exit.metre < gate.endM - 25)
                        row.entryClosed = true;
            const nearest = rows.find(r => r.exit.ref === gate?.exit?.ref);
            if (!nearest)
                continue;
            nearest.desiredPercent = 100;
            nearest.mandatory = true;
            nearest.eventId = event.id;
            nearest.distanceBeforeClosureKm = (at - nearest.exit.metre) / 1000;
        }
    }
    // Voluntary percentages come exclusively from the same delay policy
    // that supplies the actual cell transfers, never a second UI estimate.
    for (const movement of local) {
        const row = rows.find(r => !r.exit.isInterchange && r.exit.ref === movement.ref);
        if (!row)
            continue;
        row.normalOutVph = movement.lastExited * 60;
        row.normalInVph = movement.lastEntered * 60;
        row.waitingToEnter = movement.waiting;
        row.outVph += row.normalOutVph;
        row.inVph += row.normalInVph;
    }
    const measured = new Set();
    for (const flow of real) {
        const from = flow.path === path ? rows.find(r => !r.exit.isInterchange && Math.abs(r.exit.metre - flow.fromM) <= 25) : undefined;
        const to = (flow.targetPath ?? flow.path) === path ? rows.find(r => !r.exit.isInterchange && Math.abs(r.exit.metre - flow.toM) <= 25) : undefined;
        if (from) {
            if (!from.mandatory && flow.desiredPercent !== undefined) {
                if (!measured.has(from))
                    from.desiredPercent = 0;
                from.desiredPercent = Math.max(from.desiredPercent, flow.desiredPercent);
                measured.add(from);
            }
            from.outVph += flow.outVph;
            from.diversionOutVph += flow.outVph;
            from.vehiclesOnDetour += flow.vehiclesOnDetour;
            from.validatedRouteActive = true;
        }
        if (to) {
            to.inVph += flow.inVph;
            to.returningInVph += flow.inVph;
            to.waitingAtReentry += flow.waitingAtReentry;
            to.validatedRouteActive = true;
        }
    }
    return rows;
}
/** Always name the driving direction: the opposite carriageway may still
 * have ordinary entries while this direction has a formal closure. */
export function junctionMovementHint(row) {
    const count = (value) => value.toLocaleString('de-DE', { maximumFractionDigits: 0 });
    return { title: 'AS ' + row.exit.ref + ' · ' + names[row.path].replace(' Richtung ', ' → '),
        flow: 'Abfahrt ' + count(row.outVph) + '/h · Auffahrt ' + count(row.inVph) + '/h' + (row.entryClosed ? ' ⛔' : '') };
}
