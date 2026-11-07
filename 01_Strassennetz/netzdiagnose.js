/**
 * STRASSENNETZ > Netzdiagnose
 *
 * Ein read-only Audit der vorhandenen gerichteten OSM-Geometrie und der
 * tatsächlichen lokalen Rampenzuordnungen. Keine Erzeugung/Veränderung von
 * Straßen, Rampen, Nachfrage, Simulation oder Fahrzeugbeständen.
 *
 * "prüfen" bedeutet: noch keine physisch gebundene lokale Rampe in diesem
 * Modell. Das beweist NICHT, dass die echte Rampe fehlt. AK/AD werden
 * separat durch die gerichteten Autobahn-Überleitungen modelliert.
 */
import { networkRoad } from '../network-road.js?build=acf463921baa3f59';
import { diversionJunctions } from '../diversions.js?build=acf463921baa3f59';
import { junctionRampBindings } from '../junction-ramp-bindings.js?build=acf463921baa3f59';
import { buildExtensionConnections } from '../extension-connections.js?build=acf463921baa3f59';
import { extensionRoutes } from '../network-extensions.js?build=acf463921baa3f59';
/** A detached terminal may be an intentional open map boundary or a
 * segment continuing along another ramp. Never invent a link from proximity. */
export function directionNetworkAudit(path, routes, exits) {
    const route = routes[path], road = networkRoad(path);
    const name = road ? road + ' – ' + path : 'Rampe/Überleitung – ' + path;
    const out = { path, road, label: name, routeExists: !!route,
        lengthKm: route ? route.lengthM / 1000 : 0, lanes: null, ordinaryJunctions: 0,
        interchanges: 0, accesses: [], unboundAccesses: 0,
        exactMainlineLinks: 0, touchedExtensions: 0, unlinkedExtensions: 0, issues: [] };
    if (!route) {
        out.issues.push('Fahrweg im berechneten Streckennetz nicht vorhanden.');
        return out;
    }
    if (!route.points?.length || route.points.length < 2 || !Number.isFinite(route.lengthM) || route.lengthM <= 0)
        out.issues.push('Fahrweg hat keine gültige durchgehende Geometrie.');
    if (!road) {
        // Interchange turning paths cannot be described as local side-road
        // entry/exit lanes. Their connection is assessed by the exact OSM link.
        const linked = buildExtensionConnections(routes);
        out.exactMainlineLinks = linked.filter(l => l.rampId === path).length;
        if (extensionRoutes.some(r => r.id === path && r.kind === 'ramp') && !out.exactMainlineLinks)
            out.issues.push('Keine direkte Hauptbahn-Verknüpfung erfasst; Rampenkette oder Kartenrand prüfen.');
        return out;
    }
    const ordinary = diversionJunctions(path, exits, route);
    out.interchanges = ordinary.filter(a => a.isInterchange).length;
    const normal = ordinary.filter(a => !a.isInterchange);
    out.ordinaryJunctions = normal.length;
    const bindings = junctionRampBindings(route, exits);
    const links = buildExtensionConnections(routes);
    out.exactMainlineLinks = links.filter(l => l.from === path || l.to === path).length;
    const used = new Set();
    for (const link of links)
        if (link.from === path || link.to === path)
            used.add(link.rampId);
    out.touchedExtensions = used.size;
    // Direct motorway link count is not the same as the number of local AS arms.
    // A physical AS can consist of several chained OSM ramp segments.
    for (const j of normal) {
        const entryRamps = [...new Set(bindings.filter(b => b.ref === j.ref && b.kind === 'entry')
                .flatMap(b => b.segments.map(s => s.ramp.id)))];
        const exitRamps = [...new Set(bindings.filter(b => b.ref === j.ref && b.kind === 'exit')
                .flatMap(b => b.segments.map(s => s.ramp.id)))];
        const expectedEntry = j.access?.[path]?.entry !== false;
        const expectedExit = j.access?.[path]?.exit !== false;
        const entry = !expectedEntry ? 'not-applicable' : entryRamps.length ? 'bound' : 'review';
        const exit = !expectedExit ? 'not-applicable' : exitRamps.length ? 'bound' : 'review';
        out.unboundAccesses += Number(entry === 'review') + Number(exit === 'review');
        out.accesses.push({ ref: j.ref, name: j.name, metre: j.metre,
            entry, exit, entryRamps, exitRamps, expectedEntry, expectedExit });
    }
    if (out.unboundAccesses > 0)
        out.issues.push(out.unboundAccesses + ' mögliche Auffahrts-/Abfahrtsarme noch nicht mit eigener Rampengeometrie verknüpft.');
    // Unlinked extension ramp count is an informational engineering flag.
    // Multi-segment turn chains can be valid without direct mainline contact.
    const near = extensionRoutes.filter(r => r.kind === 'ramp' &&
        (r.name.includes(path) || r.zone.includes(road + ' ')));
    out.unlinkedExtensions = near.filter(r => !links.some(l => l.rampId === r.id)).length;
    return out;
}
/** Deterministic and deliberately narrow: only assert structural defects,
 * not the completeness of the external real-world OSM network. */
export function validateNetworkAudit(a) {
    const errors = [];
    if (!a.routeExists)
        errors.push(a.path + ': Geometrie fehlt');
    if (a.routeExists && (!Number.isFinite(a.lengthKm) || a.lengthKm <= 0))
        errors.push(a.path + ': ungültige Streckenlänge');
    if (a.ordinaryJunctions !== a.accesses.length)
        errors.push(a.path + ': Anschlussstellen-Liste unvollständig');
    for (const row of a.accesses) {
        if (row.entry === 'not-applicable' && row.expectedEntry)
            errors.push(a.path + ': Auffahrt-Widerspruch ' + row.ref);
        if (row.exit === 'not-applicable' && row.expectedExit)
            errors.push(a.path + ': Abfahrt-Widerspruch ' + row.ref);
        if (row.entry === 'bound' && !row.entryRamps.length)
            errors.push(a.path + ': gebundene Auffahrt ohne Geometrie ' + row.ref);
        if (row.exit === 'bound' && !row.exitRamps.length)
            errors.push(a.path + ': gebundene Abfahrt ohne Geometrie ' + row.ref);
    }
    return errors;
}
