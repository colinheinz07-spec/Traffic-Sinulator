export const LOCAL_JUNCTION_PROFILES = [
    // A3: regionale Abschnitte zwischen Köln/Bonn, Westerwald und Limburg.
    { road: 'A3', ref: '33', name: 'Siebengebirge', entryPercent: 6, exitPercent: 6, reason: 'Regionaler Zubringer' },
    { road: 'A3', ref: '34', name: 'Bad Honnef/Linz', entryPercent: 5.5, exitPercent: 5, reason: 'Regionalverkehr Rheintal' },
    { road: 'A3', ref: '35', name: 'Neustadt/Wied', entryPercent: 4.5, exitPercent: 4, reason: 'Ländlicher Anschluss' },
    { road: 'A3', ref: '36', name: 'Neuwied', entryPercent: 7.5, exitPercent: 7, reason: 'Regionale Ziel- und Quellverkehre' },
    { road: 'A3', ref: '37', name: 'Dierdorf', entryPercent: 5, exitPercent: 5, reason: 'Kleinerer ländlicher Anschluss' },
    { road: 'A3', ref: '38', name: 'Ransbach-Baumbach', entryPercent: 8, exitPercent: 8, reason: 'Regional- und Gewerbeverkehr' },
    { road: 'A3', ref: '40', name: 'Montabaur', entryPercent: 12, exitPercent: 12, reason: 'Größerer regionaler Verteiler' },
    { road: 'A3', ref: '41', name: 'Diez', entryPercent: 6, exitPercent: 5.5, reason: 'Regionale Pendlerzufahrt' },
    { road: 'A3', ref: '42', name: 'Limburg-Nord', entryPercent: 11, exitPercent: 10, reason: 'Städtischer Anschluss und Bundesstraßen' },
    { road: 'A3', ref: '43', name: 'Limburg-Süd', entryPercent: 7, exitPercent: 8, reason: 'Bahnhof und lokales Einzugsgebiet' },
    // A48: westliche Anschlüsse und Rheinbrücke sind kein einheitlicher Korridor.
    { road: 'A48', ref: '10', name: 'Koblenz-Nord', entryPercent: 12, exitPercent: 12, reason: 'Großer regionaler Verteiler' },
    { road: 'A48', ref: '11', name: 'Bendorf/Neuwied', entryPercent: 11, exitPercent: 11, reason: 'Rheinquerung und Umland' },
    { road: 'A48', ref: '12', name: 'Höhr-Grenzhausen', entryPercent: 10, exitPercent: 10, reason: 'Westerwald und Gewerbe' },
    // Köln/Bonn: Flughafen, Pendler und städtische Anschlüsse erhalten eigene Ansätze.
    { road: 'A59', ref: '32', name: 'Rath', entryPercent: 8, exitPercent: 8, reason: 'Städtischer Verteiler' },
    { road: 'A59', ref: '34', name: 'Flughafen', entryPercent: 10, exitPercent: 9, reason: 'Flughafen- und Zubringerverkehr' },
    { road: 'A59', ref: '35', name: 'Wahn', entryPercent: 8, exitPercent: 8, reason: 'Städtischer Anschluss' },
    { road: 'A59', ref: '36', name: 'Lind', entryPercent: 8.5, exitPercent: 8, reason: 'Städtischer Anschluss' },
    { road: 'A59', ref: '37', name: 'Spich', entryPercent: 9.5, exitPercent: 9, reason: 'Gewerbe und Wohngebiete' },
    { road: 'A59', ref: '38', name: 'Troisdorf', entryPercent: 10, exitPercent: 10, reason: 'Regionaler Stadtanschluss' },
    { road: 'A59', ref: '41', name: 'Bonn-Vilich', entryPercent: 8, exitPercent: 8, reason: 'Städtischer Einzugsbereich' },
    { road: 'A59', ref: '42', name: 'Bonn-Pützchen', entryPercent: 7.5, exitPercent: 7, reason: 'Städtischer Einzugsbereich' },
    { road: 'A4', ref: '11a', name: 'Köln-Klettenberg', entryPercent: 8, exitPercent: 8, reason: 'Städtische Ein- und Ausfahrt' },
    { road: 'A4', ref: '11b', name: 'Köln-Eifeltor', entryPercent: 9.5, exitPercent: 9, reason: 'Gewerbe und städtischer Verkehr' },
    { road: 'A4', ref: '13', name: 'Köln-Poll', entryPercent: 10, exitPercent: 10, reason: 'Städtischer Verteiler' },
    { road: 'A559', ref: '2', name: 'Köln-Gremberghoven', entryPercent: 11, exitPercent: 11, reason: 'Gewerbe und Stadtzubringer' },
    { road: 'A555', ref: '3', name: 'Rodenkirchen', entryPercent: 9.5, exitPercent: 9, reason: 'Städtischer Anschluss' },
    { road: 'A555', ref: '4', name: 'Köln-Godorf', entryPercent: 10, exitPercent: 9, reason: 'Industrie und Gewerbe' },
    { road: 'A555', ref: '5', name: 'Wesseling', entryPercent: 9, exitPercent: 9, reason: 'Pendler und Gewerbe' },
    { road: 'A555', ref: '6', name: 'Bornheim', entryPercent: 7.5, exitPercent: 7.5, reason: 'Regionalverkehr' },
    { road: 'A560', ref: '2', name: 'Siegburg', entryPercent: 9, exitPercent: 9, reason: 'Städtischer Anschluss' },
    { road: 'A560', ref: '3', name: 'Sankt Augustin', entryPercent: 9.5, exitPercent: 9, reason: 'Pendler und Stadtzubringer' },
    { road: 'A560', ref: '4', name: 'Niederpleis', entryPercent: 8, exitPercent: 8, reason: 'Regionaler Stadtanschluss' },
    { road: 'A560', ref: '6', name: 'Hennef-West', entryPercent: 8, exitPercent: 8, reason: 'Regionale Pendlerzufahrt' },
    { road: 'A560', ref: '7', name: 'Hennef-Ost', entryPercent: 6.5, exitPercent: 6.5, reason: 'Regionale Pendlerzufahrt' },
    { road: 'A562', ref: '2', name: 'Bonn-Bad Godesberg', entryPercent: 10, exitPercent: 10, reason: 'Städtischer Verteiler' },
    { road: 'A562', ref: '3', name: 'Bonn-Rheinaue', entryPercent: 9, exitPercent: 9, reason: 'Städtischer Anschluss' },
    { road: 'A562', ref: '4', name: 'Bonn-Ramersdorf', entryPercent: 9.5, exitPercent: 9, reason: 'Städtischer Anschluss' },
    { road: 'A565', ref: '2', name: 'Bonn-Beuel-Nord', entryPercent: 9, exitPercent: 9, reason: 'Städtischer Anschluss' },
    { road: 'A565', ref: '3', name: 'Bonn-Auerberg', entryPercent: 10, exitPercent: 9.5, reason: 'Städtischer Anschluss' }
];
const lookup = new Map(LOCAL_JUNCTION_PROFILES.map(p => [p.road + ':' + p.ref, p]));
/** In catalog: only registered real AS profiles; no invented missing ramps. */
export function junctionLocalProfile(road, ref) {
    return lookup.get(road + ':' + ref);
}
/** Validations deliberately leave room for local demand > ramp capacity.
 * Backlog, not input truncation, must handle overload. */
export function validateLocalJunctionProfiles() {
    const found = new Set(), errors = [];
    for (const p of LOCAL_JUNCTION_PROFILES) {
        const k = p.road + ':' + p.ref;
        if (found.has(k))
            errors.push('Doppelte Anschlussstelle ' + k);
        found.add(k);
        if (!p.name || !p.reason)
            errors.push('Fehlende Beschreibung ' + k);
        if (!Number.isFinite(p.entryPercent) || !Number.isFinite(p.exitPercent) ||
            p.entryPercent < 0 || p.exitPercent < 0 || p.entryPercent > 35 || p.exitPercent > 35)
            errors.push('Ungültige Nachfrage-Anteile ' + k);
    }
    return errors;
}
/** The original balanced demand profile remains for constant/wave stress tests. */
const LEGACY_LOCAL_SHARES = {
    'A3:40': 12, 'A3:43': 7, 'A3:37': 5, 'A3:36': 7, 'A3:38': 8,
    'A48:12': 10, 'A48:11': 11, 'A48:10': 12
};
export function localJunctionShares(road, ref, calendar) {
    const old = LEGACY_LOCAL_SHARES[road + ':' + ref] ?? (road === 'A559' || road === 'A59' ? 9 : 6);
    const configured = calendar ? junctionLocalProfile(road, ref) : undefined;
    return configured ?? { entryPercent: old, exitPercent: old, name: 'AS ' + ref,
        reason: 'Allgemeiner Standardwert; kein gesondertes örtliches Profil' };
}
