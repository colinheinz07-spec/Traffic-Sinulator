/** Interactive schedule form: single time window plus up to six lane phases.
 * Only planned roadworks/closures; existing unscheduled events remain valid.
 */
import { suggestedSpeed } from './events.js';
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
    const start = get('event-start'), end = get('event-end');
    function display() {
        const supported = ['roadworks', 'closure'].includes(get('event-kind').value);
        get('event-schedule-section').hidden = !supported;
        if (!supported)
            enable.checked = false;
        container.hidden = !enable.checked;
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
        const initial = Date.parse(start.value);
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
        start.value = schedule ? config.format(new Date(schedule.startAt)) : config.format(now);
        end.value = schedule ? config.format(new Date(schedule.endAt)) :
            config.format(new Date(now.getTime() + 4 * 3600000));
        for (const phase of schedule?.phases ?? [])
            add(phase);
        display();
    }
    function read() {
        if (!enable.checked)
            return undefined;
        if (!start.value || !end.value || !Number.isFinite(Date.parse(start.value)) || !Number.isFinite(Date.parse(end.value)))
            throw Error('Bitte einen gültigen Beginn und ein Ende auswählen.');
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
        return { startAt: new Date(start.value).toISOString(), endAt: new Date(end.value).toISOString(), phases };
    }
    enable.onchange = display;
    get('event-add-phase').onclick = () => add();
    return { reset, read, display };
}
