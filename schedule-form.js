/** Interactive schedule form: one-off phases or repeated local-time windows.
 * Only planned roadworks/closures; existing unscheduled events remain valid.
 */
import { suggestedSpeed } from './events.js?build=8a0e0515db091459';
import { validCalendarDate, validClockTime, validDailyRecurrence, dailyRecurrenceBounds, shiftCalendarDate } from './recurring-events.js?build=8a0e0515db091459';
const get = (id) => document.getElementById(id);
const options = (values, selected) => {
    const select = document.createElement('select');
    for (const [value, label] of values) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        select.append(opt);
    }
    select.value = selected;
    return select;
};
export function installScheduleForm(config) {
    const enable = get('event-scheduled');
    const container = get('event-schedule-fields');
    const host = get('event-phases');
    const mode = get('event-schedule-mode');
    const startDate = get('event-start-date'), startTime = get('event-start-time');
    const endDate = get('event-end-date'), endTime = get('event-end-time');
    const repeatFrom = get('event-repeat-from'), repeatThrough = get('event-repeat-through');
    const repeatStart = get('event-repeat-start-time'), repeatEnd = get('event-repeat-end-time');
    const weekdays = get('event-repeat-weekdays');
    let timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
    const startValue = () => startDate.value + 'T' + startTime.value;
    function display() {
        const supported = ['roadworks', 'closure'].includes(get('event-kind').value);
        get('event-schedule-section').hidden = !supported;
        if (!supported)
            enable.checked = false;
        container.hidden = !enable.checked;
        const repeating = mode.value === 'daily';
        get('event-once-fields').hidden = repeating;
        get('event-daily-fields').hidden = !repeating;
        get('event-phase-program').hidden = repeating;
        get('event-repeat-zone').textContent = timeZone === 'Europe/Berlin' ?
            'Deutsche Ortszeit; die Zeitumstellung wird berücksichtigt.' : 'Uhrzeiten in der beim Anlegen gewählten Ortszeit: ' + timeZone;
    }
    function numbering() {
        Array.from(host.children).forEach((node, i) => { const title = node.querySelector('strong'); if (title)
            title.textContent = 'Phase ' + (i + 2); });
    }
    function add(phase) {
        if (host.children.length >= 6)
            return;
        const count = config.laneCount();
        const row = document.createElement('section');
        row.className = 'schedule-phase';
        const header = document.createElement('div');
        header.className = 'schedule-phase-head';
        const heading = document.createElement('strong');
        heading.textContent = 'Phase ' + (host.children.length + 2);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Entfernen';
        remove.onclick = () => { row.remove(); numbering(); };
        header.append(heading, remove);
        const grid = document.createElement('div');
        grid.className = 'schedule-phase-grid';
        const label = (name, child) => {
            const lbl = document.createElement('label');
            lbl.textContent = name;
            lbl.append(child);
            grid.append(lbl);
            return child;
        };
        const date = document.createElement('input');
        date.type = 'datetime-local';
        date.step = '60';
        date.dataset.field = 'start';
        const initial = Date.parse(startValue());
        date.value = phase ? config.format(new Date(phase.startAt)) :
            config.format(new Date((Number.isFinite(initial) ? initial : config.clock().getTime()) + 3600000));
        label('Beginn dieser Phase', date);
        const kind = options([['roadworks', 'Teilweise Sperrung'], ['closure', 'Vollsperrung']], phase?.kind ?? 'roadworks');
        kind.dataset.field = 'kind';
        label('Verkehrsführung', kind);
        const shoulder = options([['normal', 'Normal'], ['blocked', 'Gesperrt'], ['open', 'Freigegeben']], phase?.shoulder ?? 'normal');
        shoulder.dataset.field = 'shoulder';
        label('Standstreifen', shoulder);
        const speeds = Array.from({ length: 14 }, (_, i) => [String(i * 10), i * 10 + ' km/h']);
        const speed = options(speeds, String(phase?.speedKmh ?? 60));
        speed.dataset.field = 'speed';
        label('Geschwindigkeit', speed);
        const lanes = document.createElement('div');
        lanes.className = 'schedule-phase-lanes';
        for (let i = 0; i < count; i++) {
            const lbl = document.createElement('label'), input = document.createElement('input');
            input.type = 'checkbox';
            input.value = String(i);
            input.checked = phase ? phase.closedLanes.includes(i) : i === 0;
            lbl.append(input, document.createTextNode(i === 0 ? 'Rechts' : i === count - 1 ? 'Links' : 'Mitte ' + i));
            lanes.append(lbl);
        }
        function refreshSpeed(reset = true) {
            const closing = kind.value === 'closure';
            lanes.hidden = closing;
            shoulder.disabled = closing;
            if (closing)
                shoulder.value = 'blocked';
            else if (shoulder.value === 'blocked' && phase?.kind === 'closure')
                shoulder.value = 'normal';
            const closed = closing ? Array.from({ length: count }, (_, i) => i) :
                Array.from(lanes.querySelectorAll('input:checked')).map(x => Number(x.value));
            const suggested = suggestedSpeed(closing ? 'closure' : 'roadworks', count, closed, shoulder.value);
            if (reset)
                speed.value = String(suggested);
            const zero = speed.querySelector('option[value="0"]');
            if (zero)
                zero.disabled = suggested !== 0;
        }
        kind.onchange = () => refreshSpeed();
        shoulder.onchange = () => refreshSpeed();
        lanes.onchange = () => refreshSpeed();
        row.append(header, grid, lanes);
        host.append(row);
        refreshSpeed(!phase);
        if (phase)
            speed.value = String(phase.speedKmh);
    }
    function reset(schedule) {
        host.replaceChildren();
        enable.checked = !!schedule;
        const now = config.clock();
        const from = schedule ? config.format(new Date(schedule.startAt)) : config.format(now);
        const until = schedule ? config.format(new Date(schedule.endAt)) : config.format(new Date(now.getTime() + 4 * 3600000));
        startDate.value = from.slice(0, 10);
        startTime.value = from.slice(11, 16);
        endDate.value = until.slice(0, 10);
        endTime.value = until.slice(11, 16);
        const repeating = schedule?.recurrence;
        mode.value = repeating ? 'daily' : 'once';
        timeZone = repeating?.timeZone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin');
        repeatFrom.value = repeating?.firstDate ?? config.format(now).slice(0, 10);
        repeatThrough.value = repeating?.lastDate ?? shiftCalendarDate(repeatFrom.value, 13);
        repeatStart.value = repeating?.startTime ?? '19:00';
        repeatEnd.value = repeating?.endTime ?? '05:00';
        for (const input of Array.from(weekdays.querySelectorAll('input')))
            input.checked = repeating ? repeating.weekdays.includes(Number(input.value)) : true;
        for (const phase of schedule?.phases ?? [])
            add(phase);
        display();
    }
    function read() {
        if (!enable.checked)
            return undefined;
        if (mode.value === 'daily') {
            const recurrence = { kind: 'daily', firstDate: repeatFrom.value, lastDate: repeatThrough.value,
                startTime: repeatStart.value, endTime: repeatEnd.value, timeZone,
                weekdays: Array.from(weekdays.querySelectorAll('input:checked')).map(input => Number(input.value)) };
            if (!validDailyRecurrence(recurrence))
                throw Error('Bitte gültige Starttage, unterschiedliche Beginn-/Enduhrzeiten und mindestens einen Wochentag auswählen.');
            const bounds = dailyRecurrenceBounds(recurrence);
            if (!bounds)
                throw Error('Im gewählten Zeitraum liegt kein ausgewählter Start-Wochentag.');
            return { ...bounds, phases: [], recurrence };
        }
        function once(date, time) {
            if (!validCalendarDate(date) || !validClockTime(time))
                throw Error('Bitte Datum und Uhrzeit für Beginn und Ende auswählen.');
            const value = date + 'T' + time, result = new Date(value);
            if (!Number.isFinite(result.getTime()) || config.format(result) !== value)
                throw Error('Datum oder Uhrzeit ist in der Ortszeit nicht gültig.');
            return result;
        }
        const start = once(startDate.value, startTime.value), end = once(endDate.value, endTime.value);
        if (end.getTime() <= start.getTime())
            throw Error('Das Ende muss nach dem Beginn liegen.');
        const phases = [];
        for (const item of Array.from(host.children)) {
            const field = (key) => item.querySelector('[data-field="' + key + '"]');
            const at = field('start').value;
            if (!at || !Number.isFinite(Date.parse(at)))
                throw Error('Jede Phase braucht einen gültigen Beginn.');
            const kind = field('kind').value;
            const closedLanes = kind === 'closure' ? Array.from({ length: config.laneCount() }, (_, i) => i) :
                Array.from(item.querySelectorAll('.schedule-phase-lanes input:checked')).map(x => Number(x.value));
            phases.push({ startAt: new Date(at).toISOString(), kind, closedLanes,
                speedKmh: Number(field('speed').value), shoulder: kind === 'closure' ? 'blocked' : field('shoulder').value });
        }
        phases.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
        return { startAt: start.toISOString(), endAt: end.toISOString(), phases };
    }
    enable.onchange = display;
    mode.onchange = display;
    get('event-add-phase').onclick = () => add();
    return { reset, read, display };
}
