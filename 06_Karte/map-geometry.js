/** 06_Karte: Zugeordnetes Fachmodul map-geometry. */
import { mercator } from '../core.js?build=1cc68e0b949f5571';
const cache = new WeakMap();
/** Reuse exact road paths during pan/zoom. Store relative coordinates to
 * avoid magnifying large-coordinate rounding at street-level zoom. */
export function worldGeometry(points) {
    const previous = cache.get(points);
    if (previous)
        return previous;
    const world = points.map(p => mercator(p, 0)), anchor = world[0] ?? [0, 0];
    const path = typeof Path2D === 'undefined' ? null : new Path2D();
    if (path)
        world.forEach((p, i) => { if (i)
            path.lineTo(p[0] - anchor[0], p[1] - anchor[1]);
        else
            path.moveTo(0, 0); });
    const result = { minX: Math.min(...world.map(p => p[0])), maxX: Math.max(...world.map(p => p[0])),
        minY: Math.min(...world.map(p => p[1])), maxY: Math.max(...world.map(p => p[1])), anchor, path };
    cache.set(points, result);
    return result;
}
