/** Fachbereich 02: verständliche Tageskurven-Vorschau für die iPhone-App.
 * Änderungen am Referenzzufluss wirken auf die echte Simulation.
 * Die Grafik nutzt exakt die profileFactor-Funktion der Verkehrs-Engine.
 */
import { profileFactor, profileDescription } from '../traffic-profiles.js?build=a94d75afb60e3d28';
const NS = 'http://www.w3.org/2000/svg';
function element(tag, attributes) {
    const node = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attributes))
        node.setAttribute(name, value);
    return node;
}
const readable = (n) => Math.round(n).toLocaleString('de-DE');
/** Mo–Do is represented by Monday; Friday is a separate profile family curve. */
export function profilePreviewMoment(base, dayOfWeek, hour) {
    if (!Number.isFinite(base.getTime()) || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6
        || !Number.isFinite(hour) || hour < 0 || hour > 24)
        throw Error('Ungültige Profilauswahl');
    const d = new Date(base.getTime());
    const offset = (d.getDay() + 6) % 7, chosen = (dayOfWeek + 6) % 7;
    d.setDate(d.getDate() - offset + chosen);
    d.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
    return d;
}
export function profilePreviewValues(key, referenceVph, base, dayOfWeek) {
    if (!Number.isFinite(referenceVph) || referenceVph < 0 || referenceVph > 8000)
        throw Error('Ungültiger Referenzzufluss');
    return Array.from({ length: 49 }, (_, i) => Math.max(0, Math.min(8000, Math.round(referenceVph * profileFactor(key, profilePreviewMoment(base, dayOfWeek, i / 2))))));
}
export function mountTrafficProfileEditor(options) {
    const get = (id) => {
        const e = document.getElementById(id);
        if (!e)
            throw Error('Verkehrsprofil-Bedienelement fehlt: ' + id);
        return e;
    };
    const panel = get('traffic-profile-editor');
    const day = get('traffic-profile-day');
    const hour = get('traffic-profile-hour');
    const peak = get('traffic-profile-peak');
    const reference = get('traffic-profile-peak-value');
    const info = get('traffic-profile-info');
    const graph = get('traffic-profile-graph');
    const apply = get('traffic-profile-apply-day');
    const today = options.getMoment().getDay();
    day.value = String(today === 5 || today === 6 || today === 0 ? today : 1);
    let previewReference = options.getReference();
    function selectedDay() { return Number(day.value); }
    function draw() {
        const key = options.getRoute();
        reference.textContent = readable(previewReference) + ' Fzg/h';
        if (!panel.open)
            return;
        const samples = profilePreviewValues(key, previewReference, options.getMoment(), selectedDay());
        const left = 47, top = 14, width = 562, height = 148;
        const max = Math.max(1000, Math.ceil(Math.max(...samples) / 1000) * 1000);
        const x = (h) => left + h / 24 * width;
        const y = (value) => top + height * (1 - value / max);
        graph.replaceChildren();
        for (const fraction of [0, .5, 1]) {
            const v = max * fraction;
            graph.append(element('line', { x1: String(left), y1: String(y(v)), x2: String(left + width), y2: String(y(v)),
                stroke: '#37576c', 'stroke-dasharray': '3 5' }));
            const label = element('text', { x: '39', y: String(y(v) + 4), 'text-anchor': 'end', fill: '#b2ccdd', 'font-size': '12' });
            label.textContent = readable(v);
            graph.append(label);
        }
        for (const h of [0, 6, 12, 18, 24]) {
            const label = element('text', { x: String(x(h)), y: '184', 'text-anchor': 'middle', fill: '#c0d9e7', 'font-size': '13' });
            label.textContent = String(h).padStart(2, '0') + ' Uhr';
            graph.append(label);
        }
        const points = samples.map((v, i) => [x(i / 2), y(v)]);
        graph.append(element('path', { d: 'M ' + points.map(p => p.join(' ')).join(' L '),
            fill: 'none', stroke: '#75d5ff', 'stroke-width': '3', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
        const h = Number(hour.value), idx = h * 2, value = samples[idx] ?? 0;
        graph.append(element('line', { x1: String(x(h)), y1: String(top), x2: String(x(h)), y2: String(top + height),
            stroke: '#ffc87c', 'stroke-width': '1.5', 'stroke-dasharray': '4 4' }));
        graph.append(element('circle', { cx: String(x(h)), cy: String(y(value)), r: '5', fill: '#ffc87c', stroke: '#10283d', 'stroke-width': '2' }));
        const label = day.selectedOptions[0]?.textContent ?? 'Tag';
        graph.setAttribute('aria-label', label + ', ' + h + ' Uhr: ' + readable(value) + ' Fahrzeuge pro Stunde');
        info.textContent = label + ' · ' + String(h).padStart(2, '0') + ':00 Uhr · ' + readable(value) +
            ' Fzg/h im Profil · ' + profileDescription(key) + '. Modellannahme, keine Verkehrszählung.';
        apply.textContent = 'Diesen Tag um ' + String(h).padStart(2, '0') + ':00 Uhr simulieren';
    }
    peak.addEventListener('input', () => { previewReference = Number(peak.value); draw(); });
    peak.addEventListener('change', () => {
        previewReference = Number(peak.value);
        options.setReference(previewReference);
        draw();
    });
    day.addEventListener('change', draw);
    hour.addEventListener('input', draw);
    panel.addEventListener('toggle', draw);
    apply.addEventListener('click', () => {
        options.useMoment(profilePreviewMoment(options.getMoment(), selectedDay(), Number(hour.value)));
        draw();
    });
    const refresh = () => {
        previewReference = options.getReference();
        peak.value = String(previewReference);
        draw();
    };
    refresh();
    return { refresh };
}
