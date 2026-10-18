export const EVENT_KINDS = ['roadworks', 'accident', 'breakdown', 'closure'];
export const eventNames = { roadworks: 'Baustelle', accident: 'Unfall', breakdown: 'Lkw-Panne', closure: 'Vollsperrung' };
export const eventSymbols = { roadworks: '🚧', accident: '💥', breakdown: '🚛', closure: '⛔' };
export const STORAGE_KEY = 'traffic-sinulator-events-v1';
const directions = new Set(['A3-koeln', 'A3-frankfurt', 'A48-koblenz', 'A48-dernbach']);
const knownRampIds = new Set(['ramp-a3-to-a48-from-frankfurt', 'ramp-a3-to-a48-from-koeln', 'ramp-a48-to-koeln', 'ramp-a48-to-frankfurt']);
export function isKnownPath(key) { return directions.has(key) || knownRampIds.has(key); }
export function isEventKind(v) { return typeof v === 'string' && EVENT_KINDS.includes(v); }
function isPoint(p) { return Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && Number.isFinite(n)) && p[0] >= 50.32 && p[0] <= 50.73 && p[1] >= 7.27 && p[1] <= 8.16; }
export function validEvent(v) {
    if (!v || typeof v !== 'object')
        return false;
    const x = v;
    const laneCount = x.laneCount;
    return typeof x.id === 'string' && x.id.length > 0 && x.id.length <= 100 && isEventKind(x.kind)
        && typeof x.pathKey === 'string' && isKnownPath(x.pathKey) && isPoint(x.point)
        && typeof laneCount === 'number' && Number.isInteger(laneCount) && laneCount >= 1 && laneCount <= 7
        && Array.isArray(x.closedLanes) && x.closedLanes.length <= laneCount && new Set(x.closedLanes).size === x.closedLanes.length
        && x.closedLanes.every(n => Number.isInteger(n) && n >= 0 && n < laneCount)
        && (x.kind !== 'closure' || x.closedLanes.length === laneCount)
        && typeof x.createdAt === 'string' && Number.isFinite(Date.parse(x.createdAt));
}
/** Corrupt or obsolete local saved entries must never crash the map. */
export function decodeEvents(raw) {
    if (!raw)
        return [];
    try {
        const v = JSON.parse(raw);
        if (!Array.isArray(v))
            return [];
        const ids = new Set();
        return v.filter((entry) => {
            if (!validEvent(entry) || ids.has(entry.id))
                return false;
            ids.add(entry.id);
            return true;
        }).slice(0, 150);
    }
    catch {
        return [];
    }
}
export function eventFromHit(hit, kind, laneCount, lanes, id, createdAt) {
    if (!isEventKind(kind) || !isKnownPath(hit.key))
        throw Error('Unbekannter Ereignistyp oder Fahrweg');
    if (!Number.isInteger(laneCount) || laneCount < 1 || laneCount > 7)
        throw Error('Fahrstreifenanzahl nicht gesichert');
    const closedLanes = kind === 'closure' ? Array.from({ length: laneCount }, (_, i) => i) : [...new Set(lanes)].sort((a, b) => a - b);
    const result = { id, kind, pathKey: hit.key, point: [...hit.point], closedLanes, laneCount, createdAt };
    if (!validEvent(result))
        throw Error('Ungültige Fahrstreifensperrung');
    return result;
}
export function eventSummary(e) {
    if (e.kind === 'closure')
        return 'Vollsperrungs-Ereignis · alle Fahrstreifen';
    if (!e.closedLanes.length)
        return 'Kein Fahrstreifen gesperrt';
    return e.closedLanes.length === e.laneCount ? 'Alle Fahrstreifen betroffen (ohne Vollsperrungs-Ereignis)'
        : `${e.closedLanes.length} von ${e.laneCount} Fahrstreifen betroffen`;
}
