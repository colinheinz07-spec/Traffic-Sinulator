const formatters = new Map();
function formatter(zone) {
    let fmt = formatters.get(zone);
    if (!fmt) {
        fmt = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
        formatters.set(zone, fmt);
    }
    return fmt;
}
function parts(at, zone) {
    const values = {};
    for (const p of formatter(zone).formatToParts(new Date(at)))
        if (p.type !== 'literal')
            values[p.type] = Number(p.value);
    return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute, second: values.second };
}
function wallStamp(p) { return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second); }
const pad = (n) => String(n).padStart(2, '0');
function dateOf(p) { return String(p.year).padStart(4, '0') + '-' + pad(p.month) + '-' + pad(p.day); }
export function validCalendarDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const at = Date.parse(value + 'T12:00:00Z');
    return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value;
}
export function validClockTime(value) {
    return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}
export function shiftCalendarDate(date, days) {
    return new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
export function validDailyRecurrence(value) {
    if (!value || typeof value !== 'object')
        return false;
    const r = value;
    if (r.kind !== 'daily' || !validCalendarDate(r.firstDate) || !validCalendarDate(r.lastDate) || r.firstDate > r.lastDate ||
        !validClockTime(r.startTime) || !validClockTime(r.endTime) || r.startTime === r.endTime ||
        !Array.isArray(r.weekdays) || !r.weekdays.length || r.weekdays.length > 7 || new Set(r.weekdays).size !== r.weekdays.length ||
        !r.weekdays.every(n => Number.isInteger(n) && n >= 0 && n <= 6) || typeof r.timeZone !== 'string' || r.timeZone.length > 100)
        return false;
    try {
        formatter(r.timeZone).format(0);
        return true;
    }
    catch {
        return false;
    }
}
/** Resolve an ambiguous wall time to the first start / last end. In a
 * spring clock gap shift by the gap to the next corresponding wall time. */
function zonedTime(date, time, zone, end = false) {
    const target = Date.parse(date + 'T' + time + ':00Z'), offsets = new Set();
    for (const hours of [-36, -12, 0, 12, 36]) {
        const sample = target + hours * 3600000;
        offsets.add(wallStamp(parts(sample, zone)) - sample);
    }
    const possible = [...offsets].map(offset => target - offset);
    const exact = possible.filter(at => wallStamp(parts(at, zone)) === target).sort((a, b) => a - b);
    if (exact.length)
        return end ? exact.at(-1) : exact[0];
    const later = possible.map(at => ({ at, wall: wallStamp(parts(at, zone)) })).filter(x => x.wall > target).sort((a, b) => a.wall - b.wall);
    return later[0]?.at ?? NaN;
}
const windows = new Map();
function occurrence(r, date) {
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
    if (date < r.firstDate || date > r.lastDate || !r.weekdays.includes(weekday))
        return null;
    const key = [r.timeZone, date, r.startTime, r.endTime].join('|');
    const stored = windows.get(key);
    if (stored)
        return stored;
    const endDate = r.endTime < r.startTime ? shiftCalendarDate(date, 1) : date;
    const startMs = zonedTime(date, r.startTime, r.timeZone), endMs = zonedTime(endDate, r.endTime, r.timeZone, true);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs)
        return null;
    const result = { startMs, endMs, startDate: date };
    windows.set(key, result);
    if (windows.size > 2048)
        windows.delete(windows.keys().next().value);
    return result;
}
export function dailyRecurrenceBounds(r) {
    let first = null, last = null;
    for (let i = 0; i < 7 && !first; i++)
        first = occurrence(r, shiftCalendarDate(r.firstDate, i));
    for (let i = 0; i < 7 && !last; i++)
        last = occurrence(r, shiftCalendarDate(r.lastDate, -i));
    return first && last ? { startAt: new Date(first.startMs).toISOString(), endAt: new Date(last.endMs).toISOString() } : null;
}
export function dailyOccurrenceAt(r, at) {
    if (!Number.isFinite(at))
        return null;
    const today = dateOf(parts(at, r.timeZone));
    for (const date of [today, shiftCalendarDate(today, -1)]) {
        const window = occurrence(r, date);
        if (window && at >= window.startMs && at < window.endMs)
            return window;
    }
    return null;
}
