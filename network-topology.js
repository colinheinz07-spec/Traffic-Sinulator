const cache = new WeakMap();
const SCALE = 1e6;
function bucket(p) {
    return [Math.round(p[0] * SCALE), Math.round(p[1] * SCALE)];
}
function distance(a, b) {
    const x = (a[1] - b[1]) * 111195 * Math.cos((a[0] + b[0]) * Math.PI / 360);
    return Math.hypot(x, (a[0] - b[0]) * 111195);
}
export function motorwayEndpointIndex(routes, mainlines) {
    const cached = cache.get(routes)?.get(mainlines);
    if (cached)
        return cached;
    const buckets = new Map();
    for (const key of mainlines) {
        const route = routes[key];
        if (!route)
            continue;
        for (let i = 0; i < route.points.length; i++) {
            const point = route.points[i], metre = route.metres[i], b = bucket(point), k = b.join(',');
            const list = buckets.get(k) ?? [];
            list.push({ key, metre, point });
            buckets.set(k, list);
        }
    }
    const index = {
        at(point) {
            const [x, y] = bucket(point), matched = [];
            for (let dx = -1; dx <= 1; dx++)
                for (let dy = -1; dy <= 1; dy++) {
                    for (const hit of buckets.get((x + dx) + ',' + (y + dy)) ?? [])
                        if (distance(hit.point, point) < .05)
                            matched.push(hit);
                }
            return matched;
        }
    };
    let perRoute = cache.get(routes);
    if (!perRoute) {
        perRoute = new WeakMap();
        cache.set(routes, perRoute);
    }
    perRoute.set(mainlines, index);
    return index;
}
