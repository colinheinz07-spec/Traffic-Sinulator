/** Demand curves are model assumptions. DTV anchors are two-way DAILY
 * counts, never hourly inputs. See docs/Regional-demand.md for evidence. */
import { extensionRoute } from './network-extensions.js?build=bea2f2f4f6fb2e9b';
const weekday = {
    transit: [[0, .14], [4, .09], [5, .20], [6, .52], [7, .86], [8, 1], [9, .79], [10, .66], [12, .68], [14, .72], [15, .82], [16, 1], [17, 1.05], [18, .82], [19, .58], [21, .32], [23, .19], [24, .14]],
    koblenz: [[0, .12], [4, .08], [4.5, .12], [5, .24], [6, .62], [7.25, 1], [8, .94], [9, .64], [10, .55], [12, .58], [14, .68], [15.5, .94], [16.5, 1], [17.5, .92], [19, .52], [21, .28], [23, .16], [24, .12]],
    ring: [[0, .18], [4, .12], [4.5, .18], [5, .32], [6, .65], [7.5, 1], [8, .98], [9, .82], [10, .72], [12, .73], [14, .79], [15.5, .98], [16.75, 1.02], [18, .88], [19.5, .64], [22, .31], [24, .18]],
    airport: [[0, .17], [4, .13], [4.5, .21], [5, .34], [6, .72], [7.25, 1], [8, .96], [9, .80], [10, .70], [12, .72], [14, .77], [15.5, .96], [16.75, 1], [18, .86], [20, .52], [22, .28], [24, .17]],
    urban: [[0, .13], [4, .08], [4.5, .14], [5, .29], [6, .73], [7.25, 1], [8, .93], [9, .64], [10, .56], [12, .60], [14, .70], [15.5, .94], [17, 1], [18, .83], [20, .42], [22, .22], [24, .13]],
    siegtal: [[0, .13], [4, .08], [4.5, .13], [5, .27], [6, .66], [7.5, 1], [8, .94], [9, .69], [10, .59], [12, .62], [14, .73], [16, 1], [17, 1.01], [18, .84], [20, .46], [22, .23], [24, .13]]
};
const saturday = [[0, .14], [3, .15], [6, .14], [8, .28], [10, .54], [12, .78], [15, .85], [17, .76], [20, .61], [23, .25], [24, .14]];
const sunday = [[0, .14], [4, .13], [8, .18], [10, .40], [12, .63], [15, .79], [17, .92], [19, .76], [21, .46], [23, .23], [24, .14]];
const exponent = { transit: 1.4, koblenz: 1.25, ring: 1.15, airport: 1.2, urban: 1.3, siegtal: 1.3 };
export const REFERENCE_PEAKS = {
    'extra-a1-dortmund': 2900, 'extra-a1-koblenz': 2850,
    'A3-koeln': 4200, 'A3-frankfurt': 4100, 'A48-dernbach': 2400, 'A48-koblenz': 1700,
    'extra-a59-koeln': 3600, 'extra-a59-bonn': 3600,
    'extra-a4-aachen': 4200, 'extra-a4-olpe': 4300,
    // These retained A555 corridors include one-lane AK Köln-Süd turning arms.
    // Calibrate only traffic committed to each arm, not entire three-lane A555.
    'extra-a555-koeln': 1250, 'extra-a555-bonn': 1200,
    'extra-a559-gremberg': 3100, 'extra-a559-porz': 3000,
    'extra-a560-hennef': 2900, 'extra-a560-bonn': 3200,
    'extra-a562-bonn': 2800, 'extra-a562-bonn-ost': 2700
};
const cache = new Map();
const familiesByMotorway = {
    A3: 'transit', A48: 'koblenz', A59: 'airport', A4: 'ring', A555: 'ring',
    A1: 'ring', A559: 'urban', A562: 'urban', A560: 'siegtal'
};
export function profileFamily(key) {
    const cached = cache.get(key);
    if (cached)
        return cached;
    const match = key.match(/^(?:extra-)?(A\d{1,3})(?:-|$)/i);
    const motorway = match?.[1]?.toUpperCase();
    let family;
    if (motorway)
        family = familiesByMotorway[motorway] ?? 'transit';
    else if (key.startsWith('ramp-'))
        family = 'koblenz';
    else {
        const feature = extensionRoute(key);
        family = feature && feature.points.some(p => p[0] > 50.78 && p[1] < 7.17) ? 'ring' :
            feature?.zone.startsWith('A48') ? 'koblenz' : 'transit';
    }
    cache.set(key, family);
    return family;
}
function interpolate(points, hour) {
    for (let i = 1; i < points.length; i++) {
        const [end, value] = points[i], [start, previous] = points[i - 1];
        if (hour <= end) {
            const t = (hour - start) / (end - start), smooth = t * t * (3 - 2 * t);
            return previous + (value - previous) * smooth;
        }
    }
    return points.at(-1)[1];
}
function preferredMorning(key) { return ['A3-frankfurt', 'A48-dernbach', 'ramp-a48-to-frankfurt', 'extra-a59-koeln', 'extra-a559-gremberg', 'extra-a560-bonn', 'extra-a4-olpe', 'extra-a555-koeln', 'extra-a562-bonn'].includes(key); }
function preferredEvening(key) { return ['A3-koeln', 'A48-koblenz', 'ramp-a48-to-koeln', 'extra-a59-bonn', 'extra-a559-porz', 'extra-a560-hennef', 'extra-a4-aachen', 'extra-a555-bonn', 'extra-a562-bonn-ost'].includes(key); }
export function profileFactor(key, moment, family = profileFamily(key)) {
    if (!Number.isFinite(moment.getTime()))
        throw Error('Ungültiges Simulationsdatum');
    const day = moment.getDay(), hour = moment.getHours() + moment.getMinutes() / 60;
    let raw;
    if (day === 0 || day === 6) {
        const curve = (day === 0 ? sunday : saturday).map(([h, v]) => [h, h === 0 || h === 24 ? weekday[family][0][1] : v]);
        raw = interpolate(curve, hour);
        // Airport and ring retain more non-commuting traffic; commuter feeders
        // have a distinctly quieter weekend. All families meet at midnight.
        if (family === 'urban' || family === 'siegtal')
            raw *= 1 - .18 * Math.sin(Math.PI * hour / 24) ** 2;
        if (family === 'koblenz')
            raw *= 1 - .24 * Math.sin(Math.PI * hour / 24) ** 2;
        if (family === 'airport')
            raw += .08 * Math.sin(Math.PI * hour / 24) ** 2;
    }
    else {
        raw = interpolate(weekday[family], hour);
        const dayScale = day === 2 ? .98 : day === 4 ? 1.02 : day === 5 ? (family === 'transit' ? 1.06 : .94) : 1;
        raw *= 1 + (dayScale - 1) * Math.sin(Math.PI * hour / 24) ** 2;
    }
    let direction = 1;
    if (day !== 0 && day !== 6) {
        const morning = Math.max(0, 1 - Math.abs(hour - (family === 'transit' ? 7.75 : 7.4)) / 2.5);
        const evening = Math.max(0, 1 - Math.abs(hour - 16.75) / 2.5);
        if (preferredMorning(key))
            direction += .09 * morning;
        if (preferredEvening(key))
            direction += .09 * evening;
    }
    return (raw < 1 ? raw ** exponent[family] : raw) * direction;
}
const descriptions = { transit: 'A3-Transitprofil im Westerwald', koblenz: 'Koblenz/Westerwald-Pendlerprofil', ring: 'Kölner Ring: breites Ballungsraumprofil', airport: 'Köln/Bonn: Pendler- und Flughafenprofil', urban: 'Kölner Stadtzubringer: ausgeprägte Pendelspitzen', siegtal: 'Siegtal/Bonn: gerichteter Pendlerverkehr' };
export function profileDescription(key) { return descriptions[profileFamily(key)]; }
/** Public DTV observations are a calibration scale, not a live feed. */
export const DTV_ANCHORS = [
    { section: 'A3 Köln-Ost–Heumar', vehiclesPerDay: 166300, year: 2021, source: 'https://company.toll-collect.de/static/media/dokumente/toll-collect/informationen/nutzer/mautnetz-und-lkw-verkehr/mautnetz-und-lkw-verkehr-2-halbjahr-2022.pdf' },
    { section: 'A3 Heumar–Bad Honnef', range: [80000, 100000], source: 'https://www.autobahn.de/planen-bauen/projekt/grundhafte-erneuerung-der-a3-zwischen-koeln-heumar-und-bad-honnef' },
    { section: 'A48 Höhr-Grenzhausen', vehiclesPerDay: 44748, year: 2022, source: 'https://www.autobahn.de/planen-bauen/projekt/ersatzneubau-des-a48-ueberfuehrungsbauwerkes-der-l307-bei-hoehr-grenzhausen' },
    { section: 'A48 Rheinbrücke Bendorf', vehiclesPerDay: 70000, approximate: true, source: 'https://www.polizei.rlp.de/die-polizei/dienststellen/polizeipraesidium-koblenz/unsere-dienststellen/verkehrsdirektion-koblenz/polizeiautobahnstation-montabaur' },
    { section: 'A59 Flughafen–Troisdorf', vehiclesPerDay: 90000, year: 2021, source: 'https://www.autobahn.de/betrieb-verkehr/verkehrsmeldung/31-03-2026-update-a59-verlaengerung-der-sperrung-der-anschlussstelle-lind-in-richtung-koeln' }
];
const identities = new Map();
export function profileIdentity(key) { let id = identities.get(key); if (!id) {
    id = profileFamily(key) + ':' + (preferredMorning(key) ? 'morning' : preferredEvening(key) ? 'evening' : 'both');
    identities.set(key, id);
} return id; }
