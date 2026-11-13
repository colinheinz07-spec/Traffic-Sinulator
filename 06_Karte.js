const key = (p) => `${p[0].toFixed(7)}|${p[1].toFixed(7)}`;
export function buildContinuousRoads(roads) {
    const output = [];
    // Network geometry is data: A61, A7 or any other imported motorway
    // goes through the identical stitching algorithm without new branches.
    const byDirection = new Map();
    for (const piece of roads) {
        const group = byDirection.get(piece.road) ?? [];
        group.push(piece);
        byDirection.set(piece.road, group);
    }
    for (const [road, entries] of byDirection) {
        const ends = new Map();
        entries.forEach((entry, i) => {
            for (const p of [entry.points[0], entry.points[entry.points.length - 1]]) {
                const k = key(p), list = ends.get(k) ?? [];
                list.push(i);
                ends.set(k, list);
            }
        });
        const used = new Set();
        for (let i = 0; i < entries.length; i++) {
            if (used.has(i))
                continue;
            const base = entries[i];
            used.add(i);
            let points = base.points.slice(), wayIds = [base.wayId];
            for (const end of ['back', 'front']) {
                while (true) {
                    const anchor = end === 'back' ? points[points.length - 1] : points[0];
                    const candidate = (ends.get(key(anchor)) ?? []).find(j => !used.has(j));
                    if (candidate === undefined)
                        break;
                    const next = entries[candidate], first = next.points[0], last = next.points[next.points.length - 1];
                    const forward = key(first) === key(anchor), reverse = key(last) === key(anchor);
                    if (!forward && !reverse)
                        break;
                    used.add(candidate);
                    if (end === 'back') {
                        const path = forward ? next.points : next.points.slice().reverse();
                        points = points.concat(path.slice(1));
                        wayIds.push(next.wayId);
                    }
                    else {
                        const path = reverse ? next.points : next.points.slice().reverse();
                        points = path.slice(0, -1).concat(points);
                        wayIds.unshift(next.wayId);
                    }
                }
            }
            output.push({ road, points, wayIds });
        }
    }
    return output;
}
/** Draw the *physical* motorway_link lane over the OSM tile, not a thin
 * centreline inside a much wider pink motorway ribbon. Keep the overview
 * narrow: at close zoom the green/traffic-coloured lane has enough width to
 * cover the raster tile's pink motorway stroke, without recolouring streets.
 * The same widths also apply to red queues and closures. */
export function lineWidths(zoom) {
    const z = Math.max(8, Math.min(17, zoom));
    const t = Math.max(0, Math.min(1, (z - 10.8) / 4.5));
    const detail = Math.max(0, Math.min(1, (z - 13.4) / 3.6)) ** 1.35;
    // At close zoom OSM raster paints broad pink motorway_link ribbons.
    // Our physical OSM ramp strokes must fully cover that backing, including
    // narrow merges. Only ramp/motorway shapes are widened – never local roads.
    const base = 1.65 + t * 2.1 + detail * 10.65;
    const ramp = 1.7 + t * 1.9 + detail * 10.45;
    return { motorway: base, motorwayCasing: base + 1.25, ramp, rampCasing: ramp + 1.25 };
}
function dist(a, b) {
    const meanLat = (a[0] + b[0]) * Math.PI / 360;
    return Math.hypot((a[0] - b[0]) * 111195, (a[1] - b[1]) * 111195 * Math.cos(meanLat));
}
export function along(points, fraction) {
    if (points.length === 0)
        throw Error('Empty path');
    if (points.length === 1)
        return points[0];
    const lens = points.slice(1).map((p, i) => dist(points[i], p));
    const whole = lens.reduce((a, b) => a + b, 0), requested = whole * Math.max(0, Math.min(1, fraction));
    let spent = 0;
    for (let i = 0; i < lens.length; i++) {
        const n = lens[i];
        if (spent + n >= requested || i === lens.length - 1) {
            const t = n ? Math.max(0, Math.min(1, (requested - spent) / n)) : 0, a = points[i], b = points[i + 1];
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        }
        spent += n;
    }
    return points[points.length - 1];
}
export function rampBadges(ramps, project, size) {
    const chosen = [];
    const presets = [[15, -20], [-17, -20], [16, 21], [-16, 21], [31, 3], [-31, 3], [0, -34], [0, 34]];
    ramps.forEach((ramp, i) => {
        let best = null;
        for (const f of [.4, .57, .72, .27, .85, .15]) {
            const point = along(ramp.points, f), screen = project(point);
            for (const [dx, dy] of presets) {
                const bubble = [screen[0] + dx, screen[1] + dy];
                if (bubble[0] < 17 || bubble[0] > size.width - 17 || bubble[1] < 42 || bubble[1] > size.height - 48)
                    continue;
                const sep = chosen.length ? Math.min(...chosen.map(c => Math.hypot(c.bubble[0] - bubble[0], c.bubble[1] - bubble[1]))) : 100;
                const score = Math.min(90, sep) - Math.hypot(dx, dy) * .12;
                if (!best || score > best.score)
                    best = { point, screen, bubble, score };
            }
        }
        if (best)
            chosen.push({ ramp, point: best.point, screen: best.screen, bubble: best.bubble, number: i + 1 });
    });
    return chosen;
}
export function overlaps(a, b, margin = 3) { return a.x < b.x + b.w + margin && a.x + a.w + margin > b.x && a.y < b.y + b.h + margin && a.y + a.h + margin > b.y; }
/** The base label point may be only a rough importer search seed.
 * Prefer each junction's actual, direction-specific OSM motorway vertices,
 * regardless of the motorway currently selected in the traffic overview.
 * This changes only the map pin: cell transfers keep their own directional
 * exitPosition() anchors. */
export function junctionLabelPosition(exit) {
    const directions = Object.values(exit.directional ?? {}).filter((value) => !!value && Array.isArray(value.position) && value.position.length === 2 &&
        value.position.every(Number.isFinite));
    if (!directions.length)
        return exit.position;
    const verified = directions.filter(value => value.nodeId > 0);
    const anchors = verified.length ? verified : directions;
    const unique = [...new Map(anchors.map(a => [key(a.position), a.position])).values()];
    // Some complexes (Montabaur, large motorway crosses) have off-ramp
    // departure vertices more than a kilometre apart. Their arithmetic
    // midpoint can land on an unrelated stretch. In that case pin an
    // actually surveyed anchor nearest the existing named junction instead.
    const distanceM = (a, b) => Math.hypot((a[0] - b[0]) * 111195, (a[1] - b[1]) * 111195 * Math.cos((a[0] + b[0]) * Math.PI / 360));
    const spread = Math.max(0, ...unique.flatMap(a => unique.map(b => distanceM(a, b))));
    if (spread > 450)
        return [...unique].sort((a, b) => distanceM(a, exit.position) - distanceM(b, exit.position))[0];
    return [
        unique.reduce((sum, p) => sum + p[0], 0) / unique.length,
        unique.reduce((sum, p) => sum + p[1], 0) / unique.length
    ];
}
export function layoutStreetTerminalMarkers(boundaries, project, viewport, zoom) {
    if (zoom < 13.5)
        return [];
    const markers = [];
    for (const point of boundaries) {
        const screen = project(point), [x, y] = screen;
        if (x < 5 || y < 5 || x > viewport.width - 5 || y > viewport.height - 5)
            continue;
        if (markers.some(m => Math.hypot(m.screen[0] - x, m.screen[1] - y) < 14))
            continue;
        markers.push({ point, screen });
    }
    return markers;
}
/** Junction names appear only in the detailed view; overview prioritises events. */
export function layoutJunctionLabels(exits, project, viewport, zoom, measure, obstacles = []) {
    if (zoom < 12.2)
        return [];
    const result = [];
    const inView = exits.map(exit => ({ exit, point: project(exit.position) })).filter(({ point: [x, y] }) => x >= 0 && x <= viewport.width && y >= 0 && y <= viewport.height).sort((a, b) => a.point[1] - b.point[1] || a.exit.road.localeCompare(b.exit.road) || a.exit.ref.localeCompare(b.exit.ref));
    // OSM describes AK Köln-Süd as A4 12 and A555 2, and Köln-West
    // as A4 10 and A1 104. Both are valid numbers for ONE physical
    // motorway cross. Do not draw two competing pins/labels at one place.
    const clusters = [];
    for (const item of inView) {
        const existing = clusters.find(c => c.exit.name === item.exit.name &&
            c.exit.name.startsWith('AK ') && c.exit.road !== item.exit.road &&
            Math.hypot(c.point[0] - item.point[0], c.point[1] - item.point[1]) < 20);
        if (existing) {
            existing.members.push(item.exit);
            if (item.exit.road === 'A4' && existing.exit.road !== 'A4') {
                existing.exit = item.exit;
                existing.point = item.point;
            }
        }
        else
            clusters.push({ ...item, members: [item.exit] });
    }
    const used = [...obstacles, ...clusters.map(({ point: [x, y] }) => ({ x: x - 5, y: y - 5, w: 10, h: 10 }))];
    for (const { exit, point: [x, y], members } of clusters) {
        const kind = exit.name.startsWith('AD ') ? 'AD' : exit.name.startsWith('AK ') ? 'AK' : 'AS';
        const duplicated = members.length > 1;
        const numbering = members.slice().sort((a, b) => a.road.localeCompare(b.road))
            .map(e => e.road + ' ' + e.ref).join(' / ');
        const compact = duplicated ? kind + ' ' + numbering : kind + ' ' + exit.ref;
        const full = duplicated ? kind + ' ' + exit.name.replace(/^(AD|AK) /, '') + ' (' + numbering + ')' :
            compact + ' ' + exit.name.replace(/^(AD|AK) /, '');
        const variants = zoom >= 11.4 ? [full, compact] : [compact];
        let box = null, text = compact;
        for (const candidate of variants) {
            const w = Math.min(viewport.width - 16, Math.ceil(measure(candidate)) + 12), h = 19;
            const locations = [];
            for (const gap of [9, 28, 48, 72]) {
                for (const [left, top] of [[x + 9, y - gap - h], [x - w - 9, y - gap - h], [x + 9, y + gap],
                    [x - w - 9, y + gap], [x - w / 2, y - gap - h], [x - w / 2, y + gap]])
                    locations.push({ x: left, y: top, w, h });
            }
            box = locations.find(r => r.x >= 5 && r.y >= 5 && r.x + r.w <= viewport.width - 5 && r.y + r.h <= viewport.height - 5 &&
                !used.some(other => overlaps(r, other, 3))) ?? null;
            if (box) {
                text = candidate;
                break;
            }
        }
        if (box)
            used.push(box);
        result.push({ exit, point: [x, y], text, box });
    }
    return result;
}
