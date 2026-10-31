/** Direction-specific entrance/exit situation for the A3/A48 simulator.
 * Targets are PLANNED route-choice percentages, not counted departures.
 * Counted values come from ordinary junction cells and detour ledgers.
 * Every normal AS is covered; AK/AD are separate motorway nodes and cannot
 * be misrepresented as exits onto local roads.
 */
import { names } from './core.js?build=9296d788994cefba';
import { positionM, closureGate } from './spatial.js?build=9296d788994cefba';
import { diversionJunctions } from './diversions.js?build=9296d788994cefba';
import { exitRampVehicles, DEFAULT_EXIT_TERMINAL_VPH, DEFAULT_EXIT_STORAGE_VEHICLES } from './junction-traffic.js?build=9296d788994cefba';
import { junctionAccess } from './road-controls.js?build=9296d788994cefba';
/** A formal closure forces departure only at the LAST usable normal exit.
 * Earlier exits are voluntary alternatives chosen by remaining time loss,
 * independently of the tail's distance from any junction.
 * The requested exit intention is never a claim that a
 * ramp can absorb an unlimited traffic stream.
 */
export function junctionMovements(path, route, exits, events, _delayMin, real = [], local = []) {
    const junctions = diversionJunctions(path, exits, route);
    const rows = junctions.map((exit) => ({
        path, exit, desiredPercent: 0, mandatory: false, entryClosed: !junctionAccess(route, events, exit.metre, exit.ref).entry,
        exitClosed: !junctionAccess(route, events, exit.metre, exit.ref).exit, eventId: null, distanceBeforeClosureKm: null,
        outVph: 0, inVph: 0, vehiclesOnDetour: 0, waitingAtReentry: 0, validatedRouteActive: false,
        normalOutVph: 0, normalInVph: 0, diversionOutVph: 0, returningInVph: 0, waitingToEnter: 0, exitDemandVph: 0,
        exitRampVehicles: 0, exitRampStorageVehicles: DEFAULT_EXIT_STORAGE_VEHICLES, exitTerminalVph: DEFAULT_EXIT_TERMINAL_VPH, exitAdmittedVph: 0
    }));
    for (const event of events.filter(x => x.pathKey === path)) {
        const at = positionM(route, event.point);
        if (at === null)
            continue;
        if (event.kind === 'closure') {
            const gate = closureGate(route, event, exits, events);
            if (gate)
                for (const row of rows)
                    if (!row.exit.isInterchange &&
                        row.exit.metre >= gate.metre - 25 && row.exit.metre < gate.endM - 25)
                        row.entryClosed = true;
            const nearest = rows.find(r => r.exit.ref === gate?.exit?.ref);
            if (!nearest)
                continue;
            const open = real.filter(f => f.path === path && f.openTurn && Math.abs(f.openTurn.gateM - gate.metre) < 25)
                .reduce((n, f) => n + f.openTurn.percent, 0);
            nearest.desiredPercent = Math.max(0, 100 - Math.min(100, open));
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
        row.exitDemandVph = (movement.lastExitDemand ?? movement.lastExited) * 60;
        row.exitRampVehicles = exitRampVehicles(movement);
        row.exitAdmittedVph = (movement.lastExitAdmitted ?? 0) * 60;
        row.exitRampStorageVehicles = movement.exitStorageVehicles ?? DEFAULT_EXIT_STORAGE_VEHICLES;
        row.exitTerminalVph = movement.exitTerminalVph ?? DEFAULT_EXIT_TERMINAL_VPH;
        row.waitingToEnter = movement.waiting;
        row.outVph += row.normalOutVph;
        row.inVph += row.normalInVph;
    }
    const measured = new Map();
    for (const flow of real) {
        const from = flow.path === path ? rows.find(r => !r.exit.isInterchange && Math.abs(r.exit.metre - flow.fromM) <= 25) : undefined;
        const to = (flow.targetPath ?? flow.path) === path ? rows.find(r => !r.exit.isInterchange && Math.abs(r.exit.metre - flow.toM) <= 25) : undefined;
        if (from) {
            if (!from.mandatory && flow.desiredPercent !== undefined) {
                const groups = measured.get(from) ?? new Map(), group = flow.movementId ?? 'mainline';
                groups.set(group, Math.max(groups.get(group) ?? 0, flow.desiredPercent));
                measured.set(from, groups);
                from.desiredPercent = Math.min(100, [...groups.values()].reduce((s, v) => s + v, 0));
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
        flow: 'Abfahrt ' + (row.exit.access?.[row.path]?.exit === false ? 'nicht vorhanden' : count(row.outVph) + '/h' + (row.exitClosed ? ' ⛔' : '')) + ' · Auffahrt ' + (row.exit.access?.[row.path]?.entry === false ? 'nicht vorhanden' : count(row.inVph) + '/h' + (row.entryClosed ? ' ⛔' : '')) };
}
