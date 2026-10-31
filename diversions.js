/** Publicly documented emergency diversion (Bedarfsumleitung) INVENTORY.
 * Sources:
 *  - OSM Wiki Germany/Bedarfsumleitung/Rheinland-Pfalz and Hessen (Oct 2026)
 *  - Autobahn GmbH A3 U5 (Jan 2025) and U8 (Jul 2026)
 * No local-road geometry, journey time or official active diversion is assumed.
 * This module produces ROUTE PLANNING PREVIEWS only. It must never silently
 * subtract or teleport vehicles from the conserved A3/A48 motorway queues.
 */
import { exitPosition } from './core.js?build=16d9a4ffa3b7c57e';
import { positionM, closureGate } from './spatial.js?build=16d9a4ffa3b7c57e';
const r = (code, path, fromRef, toRef, evidence = 'named-endpoints') => ({
    id: path + '-' + code, code, path, fromRoad: path.startsWith('A3') ? 'A3' : 'A48', fromRef,
    toRoad: toRef ? (path.startsWith('A3') ? 'A3' : 'A48') : null, toRef, evidence,
    description: evidence === 'partial' ? 'Start belegt, Ziel oder Straßenverlauf unvollständig' :
        'Start und Ziel dokumentiert; Nebenstraßen-Geometrie noch nicht übernommen'
});
/** Includes only U-signs we can attribute to this motorway/direction.
 * A missing number does NOT imply an impossible diversion or drive-through.
 */
export const DIVERSION_LINKS = [
    r('U72', 'A3-koeln', '43', '42'),
    r('U74', 'A3-koeln', '42', null, 'partial'),
    r('U1', 'A3-koeln', '41', '40'),
    r('U3', 'A3-koeln', '40', '38'),
    r('U5', 'A3-koeln', '38', '37'),
    r('U7', 'A3-koeln', '37', null, 'partial'),
    r('U9', 'A3-koeln', '36', null, 'partial'),
    r('U11', 'A3-koeln', '35', null, 'partial'),
    r('U4', 'A3-frankfurt', '35', '36'),
    r('U6', 'A3-frankfurt', '36', '37'),
    r('U8', 'A3-frankfurt', '37', '38'),
    r('U10', 'A3-frankfurt', '38', '40'),
    r('U12', 'A3-frankfurt', '40', '41'),
    r('U51', 'A3-frankfurt', '41', '42'),
    r('U53', 'A3-frankfurt', '42', '43'),
    r('U91', 'A48-dernbach', '9', null, 'partial'),
    r('U95', 'A48-dernbach', '10', '11'),
    r('U97', 'A48-dernbach', '11', null, 'partial'),
    r('U99', 'A48-dernbach', '12', null, 'partial'),
    r('U42', 'A48-koblenz', '12', '11', 'partial')
];
/** Known A3→A48 local diversion at Ransbach-Baumbach (U40).
 * This route is NOT a junction on the A48 carriageway itself. Keep separate
 * so a simulated A48 exit cannot magically become A3 AS 38.
 */
export const CROSS_MOTORWAY_DIVERSION = {
    id: 'a3-ransbach-u40-to-a48-hoehr', code: 'U40', path: 'A48-koblenz',
    fromRoad: 'A3', fromRef: '38', toRoad: 'A48', toRef: '12', evidence: 'named-endpoints',
    description: 'Über das nachgeordnete Netz von A3 AS 38 zur A48 AS 12; L307. Nicht direkt am AD Dernbach befahrbar.'
};
/** Exit coordinates come from the already-audited geodata file. Snap only
 * their motorway positions: this is NOT a side-road ramp location.
 */
export function diversionJunctions(path, exits, corridor) {
    if (path !== corridor.key)
        throw Error('Fahrtrichtung und Geometrie passen nicht zusammen');
    const road = path.startsWith('A3') ? 'A3' : 'A48';
    return exits.filter(e => e.road === road).map(e => ({
        ...e, position: exitPosition(e, path), metre: positionM(corridor, exitPosition(e, path), 900),
        isInterchange: e.name.startsWith('AD ') || e.name.startsWith('AK ')
    })).filter((e) => e.metre !== null)
        .sort((a, b) => a.metre - b.metre || a.ref.localeCompare(b.ref));
}
/** Illustrative willingness to divert. This percentage is NOT applied to the
 * motorway conservation model until a real reachable and capacity-limited
 * local road path with junction turn flows is available.
 */
export function potentialDiversionPercent(delayMin, required) {
    if (required)
        return null;
    if (delayMin === null || !Number.isFinite(delayMin) || delayMin < 45 - 1e-9)
        return 0;
    delayMin = Math.max(45, delayMin);
    const anchors = [
        [0, 0], [45, 2], [60, 10], [90, 30], [120, 60], [150, 85], [180, 100]
    ];
    for (let i = 1; i < anchors.length; i++) {
        const [end, to] = anchors[i], [begin, from] = anchors[i - 1];
        if (delayMin <= end)
            return Math.round((from + (to - from) * (delayMin - begin) / (end - begin)) * 10) / 10;
    }
    return 100;
}
/** Last ordinary exit before this queue, with no distance-to-tail limit.
 * AD/AK nodes cannot serve as exits onto local roads. */
export function nearestExitBeforeQueue(path, route, exits, tailM, endM = Infinity) {
    return diversionJunctions(path, exits, route).filter(j => !j.isInterchange && j.metre <= tailM + .1 && j.metre <= endM + 25).at(-1) ?? null;
}
export function planDiversion(event, route, exits, delayMin, maxOptions = Infinity) {
    if (route.key !== event.pathKey || route.key.startsWith('ramp-'))
        return null;
    const path = route.key;
    const at = positionM(route, event.point, 100);
    if (at === null)
        return null;
    const all = diversionJunctions(path, exits, route);
    const section = closureGate(route, event, exits);
    const upstream = all.filter(x => !x.isInterchange && (section ? x.metre <= section.metre + 1 : x.metre < at - 50)).reverse().slice(0, maxOptions);
    const candidates = upstream.map((exit, index) => {
        const link = DIVERSION_LINKS.find(u => u.path === path && u.fromRoad === exit.road && u.fromRef === exit.ref) ?? null;
        return { exit, link, upstreamKm: Math.max(0, (at - exit.metre) / 1000),
            isLastUsableExit: index === 0, canSimulate: false };
    });
    const required = event.kind === 'closure';
    return { eventId: event.id, path, eventKind: event.kind, delayMin, requiredDiversion: required,
        interestPercent: potentialDiversionPercent(delayMin, required), candidateExits: candidates,
        reason: required
            ? 'Vollsperrung: an geeigneter Ausfahrt ableiten oder Fahrzeuge davor zurückhalten. Ohne geprüfte Nebenstraßen darf keine Weiterfahrt simuliert werden.'
            : 'Ausweichbereitschaft ist nur eine angenommene Nachfrage; keine Fahrzeuge werden bisher automatisch umgeleitet.' };
}
