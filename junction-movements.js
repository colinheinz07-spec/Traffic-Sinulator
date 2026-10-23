import { positionM, closureGate } from './spatial.js';
import { diversionJunctions } from './diversions.js';
/** 100% is reserved for the LAST normal exit that can be reached before
 * a formal complete road closure. Earlier exits are voluntary alternatives
 * recruited in stages as actual queue/side-road waiting grows.
 * The 100% value is the requested exit intention, never a claim that a
 * ramp can absorb an unlimited traffic stream.
 */
export function junctionMovements(path, route, exits, events, _delayMin, real = [], local = []) {
    const junctions = diversionJunctions(path, exits, route);
    const rows = junctions.map((exit) => ({
        path, exit, desiredPercent: 0, mandatory: false, eventId: null, distanceBeforeClosureKm: null,
        outVph: 0, inVph: 0, vehiclesOnDetour: 0, waitingAtReentry: 0, validatedRouteActive: false,
        normalOutVph: 0, normalInVph: 0, diversionOutVph: 0, returningInVph: 0, waitingToEnter: 0
    }));
    for (const event of events.filter(x => x.pathKey === path)) {
        const at = positionM(route, event.point);
        if (at === null)
            continue;
        if (event.kind === 'closure') {
            const gate = closureGate(route, event, exits);
            const nearest = rows.find(r => r.exit.ref === gate?.exit?.ref);
            if (!nearest)
                continue;
            nearest.desiredPercent = 100;
            nearest.mandatory = true;
            nearest.eventId = event.id;
            nearest.distanceBeforeClosureKm = (at - nearest.exit.metre) / 1000;
        }
    }
    // A direction-wide delay does not say which AS the tail has reached.
    // Voluntary percentages come exclusively from the same spatial policy
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
