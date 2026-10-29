import { metres } from './spatial.js?build=2f18e240f686aefb';
export const OFFICIAL_OSM_RELATION_IDS = {
    'A3-koeln-U72': 186925, 'A3-koeln-U74': 186902,
    'A3-koeln-U1': 186894, 'A3-koeln-U3': 398045, 'A3-koeln-U5': 398046,
    'A3-koeln-U7': 398057, 'A3-koeln-U9': 398059, 'A3-koeln-U11': 398061,
    'A3-frankfurt-U4': 186645, 'A3-frankfurt-U6': 186644,
    'A3-frankfurt-U8': 398709, 'A3-frankfurt-U10': 186855,
    'A3-frankfurt-U12': 186892, 'A3-frankfurt-U51': 170950,
    'A3-frankfurt-U53': 186895, 'A48-dernbach-U95': 6806117,
    'A48-dernbach-U97': 6806118, 'A48-dernbach-U99': 6806119,
    'A48-koblenz-U42': 7330760
};
const admissible = new Set(['primary', 'primary_link', 'secondary', 'secondary_link',
    'tertiary', 'tertiary_link', 'trunk', 'trunk_link', 'residential', 'unclassified',
    'living_street', 'service']);
const speed = { trunk: 75, trunk_link: 38, primary: 65, primary_link: 35,
    secondary: 55, secondary_link: 30, tertiary: 47, tertiary_link: 25,
    unclassified: 35, residential: 25, living_street: 10, service: 12 };
const penalty = { trunk: 1, trunk_link: 1.55, primary: 1,
    primary_link: 1.50, secondary: 1.13, secondary_link: 1.65, tertiary: 1.27,
    tertiary_link: 1.85, unclassified: 1.6, residential: 2.1, living_street: 5, service: 9 };
const noCar = new Set(['no', 'private', 'agricultural', 'forestry']);
export function validCarWay(w) {
    const tags = w.tags ?? {}, h = tags.highway;
    return admissible.has(h) && !noCar.has(tags.access) && !noCar.has(tags.motor_vehicle) &&
        !noCar.has(tags.motorcar) && !(tags.service === 'parking_aisle') &&
        w.nodes.length >= 2 && w.geometry.length === w.nodes.length;
}
export function graphFromWays(ways, trafficSignals = new Set()) {
    const adjacency = new Map(), coordinates = new Map(), neighbours = new Map();
    const link = (a, b) => {
        if (!neighbours.has(a))
            neighbours.set(a, new Set());
        neighbours.get(a).add(b);
    };
    const add = (edge) => {
        const arr = adjacency.get(edge.from) ?? [];
        arr.push(edge);
        adjacency.set(edge.from, arr);
    };
    for (const way of ways) {
        if (!validCarWay(way))
            continue;
        const highway = way.tags.highway, oneway = way.tags.oneway, roundabout = way.tags.junction === 'roundabout';
        const backward = oneway === '-1', forward = oneway === 'yes' || oneway === '1' || roundabout;
        for (let i = 1; i < way.nodes.length; i++) {
            const a = way.nodes[i - 1], b = way.nodes[i], pa = [way.geometry[i - 1].lat, way.geometry[i - 1].lon], pb = [way.geometry[i].lat, way.geometry[i].lon];
            const d = metres(pa, pb);
            if (d < .1 || !Number.isFinite(d))
                continue;
            coordinates.set(a, pa);
            coordinates.set(b, pb);
            link(a, b);
            link(b, a);
            const weight = d * penalty[highway];
            if (!backward)
                add({ from: a, to: b, lengthM: d, weight, roadClass: highway, points: [pa, pb] });
            if (!forward)
                add({ from: b, to: a, lengthM: d, weight, roadClass: highway, points: [pb, pa] });
        }
    }
    return { adjacency, coordinates, neighbours, trafficSignals: new Set(trafficSignals) };
}
function nearestNode(graph, point) {
    let id = 0, distanceM = Infinity;
    for (const [node, coord] of graph.coordinates) {
        const d = metres(coord, point);
        if (d < distanceM) {
            id = node;
            distanceM = d;
        }
    }
    return Number.isFinite(distanceM) ? { id, distanceM } : null;
}
export function shortestOSMRoute(graph, from, to, maxSnapM = 1900) {
    const source = nearestNode(graph, from), target = nearestNode(graph, to);
    if (!source || !target || source.distanceM > maxSnapM || target.distanceM > maxSnapM || source.id === target.id)
        return null;
    const distances = new Map([[source.id, 0]]), previous = new Map(), heap = [];
    function push(id, cost) {
        heap.push({ id, cost });
        let i = heap.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (heap[p].cost <= cost)
                break;
            heap[i] = heap[p];
            i = p;
        }
        heap[i] = { id, cost };
    }
    function pop() {
        if (!heap.length)
            return;
        const head = heap[0], last = heap.pop();
        if (heap.length) {
            let i = 0;
            while (i * 2 + 1 < heap.length) {
                let child = i * 2 + 1;
                if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost)
                    child++;
                if (heap[child].cost >= last.cost)
                    break;
                heap[i] = heap[child];
                i = child;
            }
            heap[i] = last;
        }
        return head;
    }
    push(source.id, 0);
    let iterations = 0;
    while (heap.length && iterations++ < 240000) {
        const next = pop();
        if (next.cost > (distances.get(next.id) ?? Infinity) + .001)
            continue;
        if (next.id === target.id)
            break;
        for (const edge of graph.adjacency.get(next.id) ?? []) {
            const cost = next.cost + edge.weight;
            if (cost < (distances.get(edge.to) ?? Infinity)) {
                distances.set(edge.to, cost);
                previous.set(edge.to, edge);
                push(edge.to, cost);
            }
        }
    }
    if (!distances.has(target.id))
        return null;
    const edges = [];
    let at = target.id;
    for (let i = 0; i < 200000 && at !== source.id; i++) {
        const e = previous.get(at);
        if (!e)
            return null;
        edges.push(e);
        at = e.from;
    }
    if (at !== source.id)
        return null;
    edges.reverse();
    const points = [graph.coordinates.get(source.id)], lengthM = edges.reduce((a, b) => a + b.lengthM, 0);
    let freeMinutes = 0;
    for (const e of edges) {
        points.push(e.points[1]);
        freeMinutes += e.lengthM / 1000 / (speed[e.roadClass] ?? 30) * 60;
    }
    const routeNodes = [source.id, ...edges.map(e => e.to)];
    const inner = routeNodes.slice(1, -1);
    // Only intersections actually present in fetched OSM topology are counted;
    // signals must be explicitly tagged, never invented at every turn.
    const junctionCount = inner.filter(id => (graph.neighbours.get(id)?.size ?? 0) >= 3).length;
    const trafficLightCount = inner.filter(id => graph.trafficSignals.has(id)).length;
    const straight = metres(from, to);
    if (lengthM < straight * .66 || lengthM > Math.max(8000, straight * 5) || lengthM > 120000)
        return null;
    return { points, lengthM, freeMinutes, startGapM: source.distanceM, endGapM: target.distanceM,
        junctionCount, trafficLightCount };
}
export function parseOSMWays(data) {
    if (!data || typeof data !== 'object')
        return [];
    const items = data.elements;
    if (!Array.isArray(items))
        return [];
    const byId = new Map();
    const add = (id, nodes, tags, geometry) => {
        if (!Array.isArray(nodes) || !Array.isArray(geometry) || nodes.length !== geometry.length)
            return;
        if (!nodes.every(x => typeof x === 'number') || !geometry.every(x => x &&
            typeof x === 'object' && Number.isFinite(x.lat) && Number.isFinite(x.lon)))
            return;
        byId.set(id, { id, nodes: nodes, tags: tags && typeof tags === 'object' ? tags : {},
            geometry: geometry });
    };
    for (const v of items) {
        if (!v || typeof v !== 'object')
            continue;
        const item = v;
        if (item.type === 'way')
            add(item.id, item.nodes, item.tags, item.geometry);
        if (item.type === 'relation')
            for (const mem of item.members ?? []) {
                // Relation out geom provides coordinates but not node ids; only these members
                // cannot create reliable shared-node topological connections.
                // Fetch the member ways including node IDs instead.
                if (mem.type === 'way' && Array.isArray(mem.geometry))
                    continue;
            }
    }
    return [...byId.values()];
}
/** Only OSM-tagged signal nodes count as confirmed traffic signals. */
export function parseTrafficSignalNodes(data) {
    if (!data || typeof data !== 'object')
        return new Set();
    const elements = data.elements;
    if (!Array.isArray(elements))
        return new Set();
    return new Set(elements.filter(x => {
        if (!x || typeof x !== 'object')
            return false;
        const n = x;
        return n.type === 'node' && Number.isInteger(n.id) &&
            (n.tags?.highway === 'traffic_signals' || n.tags?.crossing === 'traffic_signals');
    }).map(x => x.id));
}
export function relationQuery(id) {
    if (!Number.isInteger(id) || id < 1)
        throw Error('Ungültige OSM-Relation');
    return `[out:json][timeout:25];relation(${id});way(r);out body geom;node(w)["highway"="traffic_signals"];out body;`;
}
export function bboxQuery(from, to) {
    const minLat = Math.max(50.25, Math.min(from[0], to[0]) - .038), maxLat = Math.min(50.8, Math.max(from[0], to[0]) + .038);
    const minLon = Math.max(7.17, Math.min(from[1], to[1]) - .052), maxLon = Math.min(8.23, Math.max(from[1], to[1]) + .052);
    return `[out:json][timeout:25];way["highway"~"^(primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|trunk|trunk_link|residential|unclassified|living_street|service)$"](${minLat.toFixed(5)},${minLon.toFixed(5)},${maxLat.toFixed(5)},${maxLon.toFixed(5)});out body geom;node(w)["highway"="traffic_signals"];out body;`;
}
export const OSM_OVERPASS_API = 'https://overpass.kumi.systems/api/interpreter';
export const OSM_OVERPASS_FALLBACKS = [
    OSM_OVERPASS_API, 'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
];
export async function fetchOSMNetwork(query, fetcher = fetch) {
    let lastError = 'Keine Overpass-Verbindung';
    for (const endpoint of OSM_OVERPASS_FALLBACKS) {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 28000);
        try {
            const response = await fetcher(endpoint, { method: 'POST', body: 'data=' + encodeURIComponent(query),
                headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, signal: controller.signal });
            if (!response.ok)
                throw Error('HTTP ' + response.status);
            const obj = await response.json();
            const ways = parseOSMWays(obj);
            if (!ways.length)
                throw Error('Keine befahrbaren OSM-Straßendaten gefunden');
            return { ways, trafficSignals: parseTrafficSignalNodes(obj) };
        }
        catch (e) {
            lastError = e instanceof Error ? e.message : 'OSM-Netzwerkfehler';
        }
        finally {
            clearTimeout(timer);
        }
    }
    throw Error('OSM-Straßen derzeit nicht abrufbar (' + lastError + '). Keine simulierte Verbindung aktiviert.');
}
export async function fetchOSMWays(query, fetcher = fetch) {
    return (await fetchOSMNetwork(query, fetcher)).ways;
}
function roadClassCapacity(ways) {
    // Conservative 1-lane-equivalent discharge on mixed local roads.
    const share = ways.filter(w => validCarWay(w));
    const primary = share.filter(w => ['primary', 'trunk'].includes(w.tags.highway)).length;
    return primary > share.length * .65 ? 1100 : 700;
}
export async function loadDetourGeometry(link, from, to, fetcher = fetch) {
    if (from.road !== link.fromRoad || from.ref !== link.fromRef || !to || link.toRoad && to.road !== link.toRoad)
        throw Error('U-Route und Ausfahrten passen nicht');
    if (link.toRef !== null && link.toRef !== to.ref)
        throw Error('U-Route endet an einer anderen Anschlussstelle');
    const relationId = OFFICIAL_OSM_RELATION_IDS[link.id] ?? null;
    let official = null;
    if (relationId !== null) {
        try {
            const network = await fetchOSMNetwork(relationQuery(relationId), fetcher);
            const route = shortestOSMRoute(graphFromWays(network.ways, network.trafficSignals), from.position, to.position);
            if (route && route.startGapM < 1300 && route.endGapM < 1300)
                official = { route, network };
        }
        catch { /* fallback on genuinely mapped local-road graph only */ }
    }
    let route = official?.route ?? null, network = official?.network, source = 'osm-official-relation';
    if (!route) {
        network = await fetchOSMNetwork(bboxQuery(from.position, to.position), fetcher);
        route = shortestOSMRoute(graphFromWays(network.ways, network.trafficSignals), from.position, to.position);
        source = 'osm-routed-infill';
    }
    if (!route || route.startGapM > 1900 || route.endGapM > 1900)
        throw Error('OSM-Straßennetz nicht durchgehend verbunden: Route nicht freigegeben');
    if (!Number.isFinite(route.lengthM) || !Number.isFinite(route.freeMinutes) || route.freeMinutes <= 0)
        throw Error('Ungültige Umleitungsstrecke');
    // A few seconds per mapped junction plus additional delay for a tagged
    // traffic light. This is static calibration, NOT fabricated signal phasing.
    const countedJunctions = Math.min(25, route.junctionCount), signalCount = Math.min(10, route.trafficLightCount);
    const capacityFactor = Math.max(.72, 1 - .016 * countedJunctions - .025 * signalCount);
    const estimatedCapacity = Math.round(roadClassCapacity(network.ways) * capacityFactor);
    const extraMinutes = .035 * countedJunctions + .12 * signalCount;
    return { id: link.id, path: link.path, sourceExitRef: from.ref, targetExitRef: to.ref, points: route.points,
        lengthKm: route.lengthM / 1000, freeMinutes: route.freeMinutes + extraMinutes,
        roadCapacityVph: estimatedCapacity, junctionCount: route.junctionCount, trafficLightCount: route.trafficLightCount,
        source, relationId: source === 'osm-official-relation' ? relationId : null,
        label: source === 'osm-official-relation' ? link.code + ' · OSM-U-Relation' : link.code + ' · simulierte OSM-Verbindung' };
}
