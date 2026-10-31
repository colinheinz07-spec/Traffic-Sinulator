import { regionalDetours } from './regional-detours.js?build=9296d788994cefba';
import { junctionAccess } from './road-controls.js?build=9296d788994cefba';
import { networkData } from './geodata.js?build=9296d788994cefba';
/** Offline simulator side-road network. These hand-authored corridors are
 * approximate, NOT surveyed OSM ways, official U-routes or navigation advice.
 * Every normal AS has a route in both directions, including network exits.
 * Longer bypasses concatenate the same sections; no routing server is used.
 */
import { DIRECTIONS, names, exitPosition } from './core.js?build=9296d788994cefba';
import { diversionJunctions } from './diversions.js?build=9296d788994cefba';
import { metres, positionM } from './spatial.js?build=9296d788994cefba';
export const BUNDLED_SECTIONS = [
    { from: 'A3:33', to: 'A3:34', capacity: 820, via: [[50.6840, 7.2697], [50.6760, 7.2745], [50.6679, 7.2812], [50.6597, 7.2930], [50.6550, 7.3070], [50.6509, 7.3215]] },
    { from: 'A3:34', to: 'A3:35', capacity: 820, via: [[50.6450, 7.3414], [50.6379, 7.3547], [50.6268, 7.3675], [50.6212, 7.3900], [50.6087, 7.4115], [50.5986, 7.4184]] },
    { from: 'A3:35', to: 'A3:36', capacity: 760, via: [[50.5986, 7.4184], [50.5881, 7.4330], [50.5796, 7.4574], [50.5755, 7.4818], [50.5660, 7.4994], [50.5564, 7.5185]] },
    { from: 'A3:36', to: 'A3:37', capacity: 900, via: [[50.5564, 7.5185], [50.5496, 7.5352], [50.5420, 7.5550], [50.5353, 7.5689], [50.5264, 7.5810], [50.5282, 7.5961]] },
    { from: 'A3:37', to: 'A3:38', capacity: 700, via: [[50.5370, 7.6108], [50.5444, 7.6303], [50.5462, 7.6510], [50.5387, 7.6754], [50.5366, 7.7022], [50.5320, 7.7295], [50.5311, 7.7568], [50.5165, 7.7645], [50.5020, 7.7658], [50.4868, 7.7695]] },
    { from: 'A3:38', to: 'A3:40', capacity: 850, via: [[50.4762, 7.7512], [50.4690, 7.7400], [50.4625, 7.7348], [50.4592, 7.7530], [50.4624, 7.7782], [50.4707, 7.7966], [50.4622, 7.8064], [50.4501, 7.8145]] },
    { from: 'A3:40', to: 'A3:41', capacity: 800, via: [[50.4377, 7.8295], [50.4340, 7.8464], [50.4395, 7.8663], [50.4425, 7.8879], [50.4371, 7.9087], [50.4285, 7.9212], [50.4220, 7.9360], [50.4142, 7.9344]] },
    { from: 'A3:41', to: 'A3:42', capacity: 780, via: [[50.4093, 7.9430], [50.4051, 7.9580], [50.3972, 7.9701], [50.3908, 7.9880], [50.3900, 8.0086], [50.3887, 8.0293], [50.3939, 8.0475], [50.3995, 8.0592], [50.3972, 8.0730]] },
    { from: 'A3:42', to: 'A3:43', capacity: 650, via: [[50.3923, 8.0734], [50.3908, 8.0664], [50.3852, 8.0678], [50.3806, 8.0740], [50.3800, 8.0810]] },
    // The Rhine crossing uses a southern surface corridor rather than the
    // A48 motorway bridge. Geometry remains explicitly approximate.
    { from: 'A48:10', to: 'A48:11', capacity: 720, via: [[50.3863, 7.5483], [50.3760, 7.5537], [50.3695, 7.5630], [50.3595, 7.5718], [50.3540, 7.5844], [50.3520, 7.5960], [50.3526, 7.6051], [50.3600, 7.6132], [50.3740, 7.6138], [50.3896, 7.6082], [50.4020, 7.6012], [50.4105, 7.5920]] },
    { from: 'A48:11', to: 'A48:12', capacity: 850, via: [[50.4200, 7.5856], [50.4255, 7.5980], [50.4308, 7.6130], [50.4405, 7.6248], [50.4475, 7.6405], [50.4460, 7.6525]] },
    { from: 'A48:12', to: 'A3:38', capacity: 780, via: [[50.4420, 7.6770], [50.4483, 7.6845], [50.4572, 7.6896], [50.4613, 7.7045], [50.4625, 7.7200], [50.4663, 7.7300], [50.4762, 7.7410]] }
];
const ends = {
    'A3-koeln': { from: 'A3:33', point: [50.7856487, 7.2401905], via: [[50.6961, 7.2718], [50.7040, 7.2780], [50.7140, 7.2702], [50.7210, 7.2530], [50.7287, 7.2330], [50.7400, 7.2293], [50.7519, 7.2310], [50.7641, 7.2290], [50.7740, 7.2294], [50.7810, 7.2350]] },
    'A3-frankfurt': { from: 'A3:43', point: [50.3630, 8.1130], via: [[50.3800, 8.0875], [50.3740, 8.0938], [50.3690, 8.1021]] },
    'A48-koblenz': { from: 'A48:10', point: [50.3500, 7.4630], via: [[50.3855, 7.5255], [50.3800, 7.5124], [50.3672, 7.5054], [50.3580, 7.4854]] },
    'A48-dernbach': { from: 'A48:12', point: [50.4610, 7.7780], via: [[50.4420, 7.6770], [50.4483, 7.6845], [50.4572, 7.6896], [50.4613, 7.7045], [50.4625, 7.7200], [50.4592, 7.7470], [50.4600, 7.7640]] }
};
// Extended mainline boundaries are exact OSM vertices. Side-road corridors
// remain the same explicitly approximate simulator assumptions as before.
if (networkData.exits.some(e => e.road === 'A3' && e.ref === '28')) {
    const point = (path, north) => networkData.roads.filter(r => r.road === path).flatMap(r => r.points)
        .reduce((a, b) => (north ? b[0] > a[0] : b[0] < a[0]) ? b : a);
    ends['A3-koeln'] = { from: 'A3:29', point: point('A3-koeln', true), via: [] };
    ends['A3-frankfurt'] = { from: 'A3:44', point: point('A3-frankfurt', false), via: [] };
    for (const path of ['A3-koeln', 'A3-frankfurt']) {
        const end = regionalDetours.find(r => r.path === path && r.to === 'end-' + path && 'A3:' + r.from === ends[path].from);
        if (end)
            ends[path].point = end.points.at(-1);
    }
}
export function isNetworkDestination(exit) { return exit.source === 'simulation-boundary'; }
export function bundledTargets(path, exits, route) {
    const normal = diversionJunctions(path, exits, route).filter(x => !x.isInterchange);
    return [...normal, { road: path.startsWith('A3') ? 'A3' : 'A48', ref: 'end-' + path,
            name: 'Weiterfahrt außerhalb des Netzes · ' + names[path], position: ends[path].point,
            source: 'simulation-boundary', metre: route.lengthM, isInterchange: false }];
}
/** Pure synchronous lookup/composition: deliberately has no fetch argument. */
export function bundledDetourGeometry(id, path, from, to, exits) {
    const graph = new Map(), coordinates = new Map(exits.map(e => [e.road + ':' + e.ref, exitPosition(e, path)]));
    const start = from.road + ':' + from.ref, finish = isNetworkDestination(to) ? to.ref : to.road + ':' + to.ref;
    coordinates.set(start, from.position);
    coordinates.set(finish, to.position);
    const add = (a, b, via, capacity) => {
        const start = coordinates.get(a), end = coordinates.get(b);
        if (!start || !end)
            throw Error('Enthaltenes Umleitungsnetz ist unvollständig: ' + a + ' → ' + b);
        const points = [start, ...via, end], lengthM = points.slice(1).reduce((n, p, i) => n + metres(points[i], p), 0);
        graph.set(a, [...(graph.get(a) ?? []), { to: b, points, lengthM, capacity, sectionId: a + '>' + b }]);
        graph.set(b, [...(graph.get(b) ?? []), { to: a, points: [...points].reverse(), lengthM, capacity, sectionId: b + '>' + a }]);
    };
    for (const p of DIRECTIONS)
        coordinates.set('end-' + p, ends[p].point);
    for (const s of BUNDLED_SECTIONS)
        add(s.from, s.to, s.via, s.capacity);
    for (const p of DIRECTIONS) {
        const boundary = regionalDetours.find(r => r.path === p && r.to === 'end-' + p && 'A3:' + r.from === ends[p].from);
        if (boundary) {
            const points = boundary.points, lengthM = points.slice(1).reduce((n, v, i) => n + metres(points[i], v), 0);
            graph.set(ends[p].from, [...(graph.get(ends[p].from) ?? []), { to: 'end-' + p, points, lengthM, capacity: 650, sectionId: ends[p].from + '>end-' + p }]);
        }
        else
            add(ends[p].from, 'end-' + p, ends[p].via, 760);
    }
    for (const r of regionalDetours.filter(r => r.path === path)) {
        const a = 'A3:' + r.from, b = r.to.startsWith('end-') ? r.to : 'A3:' + r.to, points = r.points;
        const lengthM = points.slice(1).reduce((n, v, i) => n + metres(points[i], v), 0);
        graph.set(a, [...(graph.get(a) ?? []), { to: b, points, lengthM, capacity: 650, sectionId: a + '>' + b }]);
    }
    const costs = new Map([[start, 0]]), previous = new Map(), done = new Set();
    while (true) {
        let current, best = Infinity;
        for (const [node, cost] of costs)
            if (!done.has(node) && cost < best) {
                current = node;
                best = cost;
            }
        if (current === undefined || current === finish)
            break;
        done.add(current);
        for (const edge of graph.get(current) ?? []) {
            const cost = best + edge.lengthM;
            if (cost < (costs.get(edge.to) ?? Infinity)) {
                costs.set(edge.to, cost);
                previous.set(edge.to, { from: current, edge });
            }
        }
    }
    const sections = [];
    let cursor = finish;
    while (cursor !== start) {
        const step = previous.get(cursor);
        if (!step)
            throw Error('Keine enthaltene Umleitung für ' + start + ' → ' + finish);
        sections.unshift(step.edge);
        cursor = step.from;
    }
    if (!sections.length)
        throw Error('Umleitung braucht zwei verschiedene Anschlüsse');
    const points = sections.flatMap((s, i) => i && s.points[0][0] === sections[i - 1].points.at(-1)[0] && s.points[0][1] === sections[i - 1].points.at(-1)[1] ? s.points.slice(1) : s.points);
    const lengthKm = points.slice(1).reduce((n, p, i) => n + metres(points[i], p), 0) / 1000;
    const junctionCount = sections.reduce((n, s) => n + Math.max(1, Math.round(s.lengthM / 2300)), 0);
    return { id, path, sourceExitRef: from.ref, targetExitRef: to.ref, points,
        lengthKm, freeMinutes: Math.max(2, lengthKm / 46 * 60 + junctionCount * .4),
        roadCapacityVph: Math.min(...sections.map(s => s.capacity)), junctionCount, trafficLightCount: 0,
        source: 'simulated-bundled', relationId: null, label: 'Simulierte Umleitung · angenäherter Verlauf',
        sections: sections.map(s => ({ id: s.sectionId, capacityVph: s.capacity })) };
}
/** One ready default per directional AS; incident bypasses can span more AS. */
export function bundledExitRoutes(path, exits, route) {
    const targets = bundledTargets(path, exits, route);
    return targets.slice(0, -1).filter(from => junctionAccess(route, [], from.metre, from.ref).exit).map(from => {
        const to = targets.find(t => t.metre > from.metre + 1 && (isNetworkDestination(t) || junctionAccess(route, [], t.metre, t.ref).entry));
        const id = path + '-BUNDLED-' + from.ref + ':' + to.ref;
        const geometry = bundledDetourGeometry(id, path, from, to, exits), position = geometry.points.at(-1);
        return { from, to: { ...to, position, metre: isNetworkDestination(to) ? to.metre : positionM(route, position, 35) ?? to.metre }, geometry };
    });
}
