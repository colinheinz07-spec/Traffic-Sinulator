import { PATHS, advanceTraffic, defaultDemands, emptyTraffic, trafficEstimate } from './traffic.js';
import { networkData } from './geodata.js';
import { decodeEvents, eventFromHit, updatedEvent, eventNames, eventSymbols, eventSummary, defaultLengthM, maxLengthM, suggestedSpeed, STORAGE_KEY, isEventKind } from './events.js';
import { roadLaneInfo, rampLaneInfo } from './lane-info.js';
import { mapCandidates, chooseMapHits, closestJunction, lanePositions, hitLabel } from './selection.js';
import { buildContinuousRoads, lineWidths, rampBadges, overlaps } from './cartography.js';
import { DIRECTIONS, validateMap, names, mercator, inverse } from './core.js';
const $ = (id) => { const element = document.getElementById(id); if (!element)
    throw Error(`Element fehlt: ${id}`); return element; };
const canvas = $('map'), wrapper = canvas.parentElement;
const context = canvas.getContext('2d');
if (!context)
    throw Error('Canvas 2D wird nicht unterstützt');
const status = $('status'), hint = $('hint');
let focus = [50.507, 7.63], zoom = 10, needsDraw = true;
const roadColors = { 'A3-koeln': '#26bb7c', 'A3-frankfurt': '#26bb7c', 'A48-dernbach': '#2bc9c5', 'A48-koblenz': '#2bc9c5' };
const mapReady = validateMap(networkData);
const allRoads = networkData.roads, ramps = networkData.ramps, exits = networkData.exits;
const drawnRoads = buildContinuousRoads(allRoads);
let badges = [];
const pointerPositions = new Map();
let pointerDown = null;
let selected = null;
let events = readStoredEvents();
let activeEventId = null;
let editingEventId = null;
let speedManuallyChanged = false;
let storageWarning = '';
function readStoredEvents() { try {
    return decodeEvents(window.localStorage.getItem(STORAGE_KEY));
}
catch {
    return [];
} }
function persistEvents() { try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    storageWarning = '';
}
catch {
    storageWarning = 'Achtung: Dieser Browser speichert Ereignisse nicht dauerhaft.';
} renderTraffic(); }
function eventPathLabel(e) {
    const ramp = ramps.find(r => r.id === e.pathKey);
    return ramp?.name ?? (names[e.pathKey] || 'Unbekannter Fahrweg');
}
function redrawEventList() {
    const parent = $('events-list');
    parent.replaceChildren();
    $('event-counter').textContent = `(${events.length})`;
    if (!events.length) {
        const p = document.createElement('p');
        p.textContent = 'Noch keine Ereignisse gesetzt. Wähle einen Fahrbahnabschnitt auf der Karte.';
        parent.append(p);
        return;
    }
    for (const event of [...events].reverse()) {
        const item = document.createElement('div');
        item.className = 'event-row';
        const title = document.createElement('strong'), meta = document.createElement('small'), jump = document.createElement('button');
        title.textContent = `${eventSymbols[event.kind]} ${eventNames[event.kind]} · ${eventPathLabel(event)}`;
        meta.textContent = eventSummary(event);
        jump.type = 'button';
        jump.textContent = 'Auf Karte ansehen';
        jump.onclick = () => { focus = event.point; zoom = Math.max(zoom, 14.4); showExistingEvent(event); refresh(); };
        item.append(title, meta, jump);
        parent.append(item);
    }
}
function clearEventUi() {
    $('new-event-zone').hidden = true;
    $('event-form').hidden = true;
    $('existing-event').hidden = true;
    $('event-delete').textContent = 'Ereignis entfernen';
    $('event-delete').dataset.confirm = '';
    $('event-form-error').textContent = '';
    editingEventId = null;
}
function showExistingEvent(e) {
    selected = null;
    activeEventId = e.id;
    clearEventUi();
    selectTrafficRoute(e.pathKey);
    $('selection-chooser').hidden = true;
    $('selected-fields').hidden = true;
    $('selection-help').hidden = true;
    $('selected-title').textContent = `${eventSymbols[e.kind]} ${eventNames[e.kind]}`;
    $('selected-note').textContent = eventPathLabel(e);
    $('existing-event-desc').textContent = `${eventSummary(e)} · ${e.point[0].toFixed(6)}° N, ${e.point[1].toFixed(6)}° E · ${new Date(e.createdAt).toLocaleString('de-DE')}`;
    $('existing-event').hidden = false;
    $('detail').hidden = false;
    hint.textContent = `${eventNames[e.kind]} ausgewählt – du kannst die Verkehrsführung bearbeiten oder das Ereignis entfernen.`;
    refresh();
}
function laneCountFor(hit) {
    const info = hit.kind === 'ramp' ? rampLaneInfo(hit.ramp, hit.point) : roadLaneInfo(hit.road);
    return info.source === 'unknown' ? 0 : info.count;
}
function drawEventMarkers(width, height) {
    for (const event of events) {
        const [x, y] = toScreen(event.point);
        if (x < -20 || y < -20 || x > width + 20 || y > height + 20)
            continue;
        const active = event.id === activeEventId;
        context.beginPath();
        context.arc(x, y, active ? 18 : 15, 0, 2 * Math.PI);
        context.fillStyle = active ? '#0b4760' : '#112638';
        context.fill();
        context.strokeStyle = active ? '#39ddff' : '#ffcb79';
        context.lineWidth = active ? 3 : 2;
        context.stroke();
        context.font = '18px system-ui,"Apple Color Emoji"';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(eventSymbols[event.kind], x, y + 1);
        context.textAlign = 'start';
        context.textBaseline = 'alphabetic';
    }
}
function formLaneCount() {
    if (editingEventId)
        return events.find(e => e.id === editingEventId)?.laneCount ?? 0;
    return selected ? laneCountFor(selected) : 0;
}
function formPathKey() {
    if (editingEventId)
        return events.find(e => e.id === editingEventId)?.pathKey ?? '';
    return selected?.key ?? '';
}
function chosenLanes() { return Array.from(document.querySelectorAll('#event-lanes input:checked')).map(x => Number(x.value)); }
function currentShoulder() { return $('event-shoulder').value; }
function renderEventLaneChoices(preset) {
    const help = $('event-lane-help'), parent = $('event-lanes');
    const selectedBefore = preset ?? chosenLanes();
    parent.replaceChildren();
    const count = formLaneCount(), kind = $('event-kind').value;
    if (!count) {
        help.textContent = 'Fahrstreifenangabe ungeklärt – Ereignis hier vorerst nicht anlegbar.';
        return;
    }
    if (kind === 'closure') {
        help.textContent = `Eigenständige Vollsperrung: alle ${count} regulären Fahrstreifen gesperrt.`;
        return;
    }
    help.textContent = `Reguläre Fahrstreifen sperren (${count} laut OSM; Standstreifen separat):`;
    lanePositions(count).forEach((name, i) => {
        const row = document.createElement('label'), input = document.createElement('input'), label = document.createElement('span');
        input.type = 'checkbox';
        input.value = String(i);
        input.name = 'closed-lane';
        input.checked = selectedBefore.includes(i);
        label.textContent = name;
        input.addEventListener('change', () => updateEventConfigPreview());
        row.append(input, label);
        parent.append(row);
    });
}
function updateEventConfigPreview(resetSpeed = false) {
    const kind = $('event-kind').value;
    if (!isEventKind(kind))
        return;
    const count = formLaneCount(), closed = kind === 'closure' ? Array.from({ length: count }, (_, i) => i) : chosenLanes();
    const shoulder = $('event-shoulder'), shoulderRow = $('event-shoulder-row');
    const isRamp = formPathKey().startsWith('ramp-');
    shoulderRow.hidden = isRamp;
    $('event-shoulder-note').hidden = isRamp;
    if (isRamp)
        shoulder.value = 'normal';
    if (kind === 'closure') {
        shoulder.value = 'blocked';
        shoulder.disabled = true;
    }
    else
        shoulder.disabled = false;
    const mode = currentShoulder();
    const input = $('event-length');
    input.max = String(maxLengthM(kind));
    input.min = '1';
    const length = Number(input.value);
    if (resetSpeed || !(length >= 1 && length <= maxLengthM(kind)))
        input.value = String(defaultLengthM(kind));
    $('event-length-note').textContent = kind === 'accident' || kind === 'breakdown'
        ? 'Punktuelles Ereignis: maximal 200 m.' : kind === 'roadworks' ? 'Baustellenabschnitt: bis 20 km einstellbar.' : 'Sperrabschnitt: bis 10 km einstellbar.';
    const speed = $('event-speed');
    const suggested = suggestedSpeed(kind, count, closed, mode);
    if (resetSpeed || !speedManuallyChanged || suggested === 0) {
        speed.value = String(suggested);
        speedManuallyChanged = false;
    }
    speed.disabled = suggested === 0;
    const zero = speed.querySelector('option[value="0"]');
    if (zero)
        zero.disabled = suggested !== 0;
    const open = Math.max(0, count - closed.length) + (mode === 'open' ? 1 : 0);
    $('event-rule-hint').textContent = kind === 'closure'
        ? 'Vollsperrung: keine neuen Fahrzeuge in den Sperrabschnitt; bereits darin befindliche Fahrzeuge dürfen später ausfahren. Nachfolgender Verkehr wird künftig über zulässige Ausfahrten/Umleitungen geleitet. Noch keine Verkehrsberechnung.'
        : open === 0 ? 'Kein freier Fahrstreifen: derzeit kein Durchfluss. Ein Unfall ist trotzdem KEIN formales Vollsperrungs-Ereignis.'
            : `${open} nutzbare Fahrstreifen (davon ${mode === 'open' ? '1 Standstreifen' : '0 Standstreifen'}). Geschwindigkeitsvorschlag ${suggested} km/h – frei anpassbar. Nur Simulationsannahme, keine StVO-Vorgabe.`;
}
function beginEventForm() {
    if (!selected)
        return;
    editingEventId = null;
    speedManuallyChanged = false;
    $('new-event-button').hidden = true;
    $('event-form').hidden = false;
    $('event-kind').value = 'roadworks';
    $('event-shoulder').value = 'normal';
    $('event-length').value = '500';
    $('event-save').textContent = 'Ereignis setzen';
    $('event-form-error').textContent = '';
    renderEventLaneChoices([]);
    updateEventConfigPreview(true);
}
function beginEditEvent() {
    const current = events.find(x => x.id === activeEventId);
    if (!current)
        return;
    const id = current.id;
    clearEventUi();
    editingEventId = id;
    speedManuallyChanged = true;
    $('existing-event').hidden = true;
    $('new-event-zone').hidden = false;
    $('new-event-button').hidden = true;
    $('event-form').hidden = false;
    $('event-save').textContent = 'Änderungen speichern';
    $('event-form-error').textContent = '';
    $('event-kind').value = current.kind;
    $('event-shoulder').value = current.settings.shoulder;
    $('event-length').value = String(current.settings.lengthM);
    renderEventLaneChoices(current.closedLanes);
    updateEventConfigPreview(false);
    $('event-speed').value = String(current.settings.speedKmh);
}
function saveNewEvent() {
    const kind = $('event-kind').value;
    if (!isEventKind(kind))
        return;
    const count = formLaneCount();
    const closed = chosenLanes();
    const settings = { lengthM: Number($('event-length').value), speedKmh: Number($('event-speed').value), shoulder: currentShoulder() };
    try {
        let entry;
        if (editingEventId) {
            const current = events.find(e => e.id === editingEventId);
            if (!current)
                throw Error('Zu bearbeitendes Ereignis nicht gefunden.');
            entry = updatedEvent(current, kind, closed, settings);
            events = events.map(e => e.id === entry.id ? entry : e);
        }
        else {
            if (!selected)
                throw Error('Wähle zuerst eine Fahrbahn.');
            const id = `ev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
            entry = eventFromHit(selected, kind, count, closed, id, new Date().toISOString(), settings);
            if (events.length >= 150)
                throw Error('Maximal 150 Ereignisse gleichzeitig möglich.');
            events = [...events, entry];
        }
        persistEvents();
        redrawEventList();
        showExistingEvent(entry);
        if (storageWarning)
            hint.textContent = storageWarning;
    }
    catch (e) {
        $('event-form-error').textContent = e instanceof Error ? e.message : 'Ereignis konnte nicht gespeichert werden.';
    }
}
function removeExistingEvent() {
    const e = events.find(e => e.id === activeEventId);
    if (!e)
        return;
    const button = $('event-delete');
    if (button.dataset.confirm !== e.id) {
        button.dataset.confirm = e.id;
        button.textContent = 'Wirklich entfernen?';
        return;
    }
    events = events.filter(x => x.id !== e.id);
    activeEventId = null;
    button.dataset.confirm = '';
    persistEvents();
    redrawEventList();
    $('detail').hidden = true;
    hint.textContent = storageWarning || 'Ereignis aus der Simulation entfernt.';
    refresh();
}
// Version 0.9: standalone macroscopic estimates, not live traffic measurements.
// No fabricated traffic transfers between A3, A48, and AD Dernbach ramps.
let trafficState = emptyTraffic();
const trafficDemands = defaultDemands();
let trafficTimer = null;
const trafficRouteLabel = (key) => ramps.find(r => r.id === key)?.name ?? (names[key] ?? key);
const trafficNumber = (n, digits = 0) => n.toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const trafficColorName = { free: 'Frei', slow: 'Stockend', jam: 'Stau / Stop-and-Go', standstill: 'Stillstand / gesperrt' };
function renderTraffic() {
    const selector = $('traffic-route');
    const key = selector.value;
    if (!PATHS.includes(key))
        return;
    const result = trafficEstimate(trafficState, key, events, trafficDemands[key]);
    $('traffic-minute').textContent = `Minute ${trafficState.minute}`;
    $('traffic-demand').textContent = trafficNumber(trafficDemands[key]);
    $('traffic-capacity').textContent = trafficNumber(result.capacityVph);
    $('traffic-outflow').textContent = trafficNumber(result.dischargedVph);
    $('traffic-queue').textContent = trafficNumber(result.queueVehicles);
    $('traffic-queue-km').textContent = `${trafficNumber(result.queueKm, 2)} km`;
    $('traffic-delay').textContent = result.delayMin === null ? 'Bei Sperrung nicht berechenbar' : `${trafficNumber(result.delayMin, 1)} min`;
    $('traffic-speed').textContent = `${result.speedKmh} km/h`;
    $('traffic-events').textContent = result.eventCount === 0 ? 'Kein Ereignis – Standardkapazität' :
        `${result.eventCount} Ereignis(se), maßgeblich: ${events.find(e => e.id === result.bottleneckId)?.kind === 'closure' ? 'Vollsperrung' : result.bottleneckId ? 'Engpass' : 'kein Engpass'}`;
    const stateLabel = $('traffic-state');
    stateLabel.textContent = trafficColorName[result.color];
    stateLabel.className = `traffic-state ${result.color}`;
    $('traffic-closure-note').textContent = result.officiallyClosed ? 'Vollsperrung: kein neuer Zufluss in den Sperrabschnitt. Offizielle Umleitung und Ausfahrt bereits eingeschlossener Fahrzeuge werden noch NICHT simuliert. Die hier gezeigte Warteschlange ist vorläufiger, auflaufender Verkehr vor der Sperrung.' : '';
    const parent = $('traffic-summary');
    parent.replaceChildren();
    for (const item of PATHS) {
        const m = trafficEstimate(trafficState, item, events, trafficDemands[item]);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'traffic-summary-row';
        const label = document.createElement('span');
        label.textContent = trafficRouteLabel(item);
        const status = document.createElement('strong');
        status.className = `traffic-state ${m.color}`;
        status.textContent = `${trafficNumber(m.queueKm, 1)} km · ${m.delayMin === null ? 'gesperrt' : trafficNumber(m.delayMin, 1) + ' min'}`;
        button.append(label, status);
        button.setAttribute('aria-label', `${label.textContent}, ${status.textContent}`);
        button.onclick = () => selectTrafficRoute(item);
        parent.append(button);
    }
}
function selectTrafficRoute(path) {
    if (!PATHS.includes(path))
        return;
    const key = path;
    $('traffic-route').value = key;
    $('traffic-inflow').value = String(trafficDemands[key]);
    renderTraffic();
}
function stopTraffic() { if (trafficTimer !== null) {
    clearInterval(trafficTimer);
    trafficTimer = null;
} $('traffic-play').textContent = '▶ Start'; }
function stepTraffic(minutes) {
    try {
        trafficState = advanceTraffic(trafficState, events, trafficDemands, minutes);
        renderTraffic();
    }
    catch (e) {
        stopTraffic();
        $('traffic-issue').textContent = e instanceof Error ? e.message : 'Simulationsfehler';
    }
}
function initializeTraffic() {
    const select = $('traffic-route');
    select.replaceChildren();
    for (const key of PATHS) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = trafficRouteLabel(key);
        select.append(option);
    }
    select.value = 'A3-koeln';
    selectTrafficRoute(select.value);
    select.addEventListener('change', () => selectTrafficRoute(select.value));
    const input = $('traffic-inflow');
    input.addEventListener('change', () => {
        const val = Number(input.value), key = select.value;
        if (!Number.isInteger(val) || val < 0 || val > 8000) {
            $('traffic-issue').textContent = 'Zufluss: nur ganze Zahlen zwischen 0 und 8.000 Fahrzeugen/h.';
            input.value = String(trafficDemands[key]);
            return;
        }
        $('traffic-issue').textContent = '';
        trafficDemands[key] = val;
        renderTraffic();
    });
    $('traffic-play').onclick = () => {
        if (trafficTimer !== null) {
            stopTraffic();
            return;
        }
        $('traffic-play').textContent = '⏸ Pause';
        trafficTimer = setInterval(() => stepTraffic(1), 1000);
    };
    $('traffic-step').onclick = () => stepTraffic(5);
    $('traffic-reset').onclick = () => { stopTraffic(); trafficState = emptyTraffic(); renderTraffic(); };
    document.addEventListener('visibilitychange', () => { if (document.hidden)
        stopTraffic(); });
}
const imageCache = new Map();
const size = () => { const width = wrapper.clientWidth, height = wrapper.clientHeight, scale = Math.min(2, window.devicePixelRatio || 1); if (canvas.width !== Math.floor(width * scale) || canvas.height !== Math.floor(height * scale)) {
    canvas.width = Math.floor(width * scale);
    canvas.height = Math.floor(height * scale);
} return { width, height, scale }; };
function toScreen(p) { const mid = mercator(focus, zoom), v = mercator(p, zoom); return [wrapper.clientWidth / 2 + v[0] - mid[0], wrapper.clientHeight / 2 + v[1] - mid[1]]; }
function fromScreen(x, y) { const mid = mercator(focus, zoom); return inverse([mid[0] + x - wrapper.clientWidth / 2, mid[1] + y - wrapper.clientHeight / 2], zoom); }
let frame = 0;
const refresh = () => { needsDraw = true; if (!frame)
    frame = requestAnimationFrame(() => { frame = 0; if (needsDraw) {
        needsDraw = false;
        draw();
    } }); };
function fit() {
    activeEventId = null;
    selected = null;
    $('detail').hidden = true;
    const all = [...allRoads.flatMap(r => r.points), ...ramps.flatMap(r => r.points)];
    const latMin = Math.min(...all.map(p => p[0])), latMax = Math.max(...all.map(p => p[0]));
    const lonMin = Math.min(...all.map(p => p[1])), lonMax = Math.max(...all.map(p => p[1]));
    const center = [(latMin + latMax) / 2, (lonMin + lonMax) / 2];
    const { width, height } = size();
    zoom = 8;
    for (let z = 13; z >= 8; z -= .08) {
        let p1 = mercator([latMin, lonMin], z), p2 = mercator([latMax, lonMax], z);
        if (Math.abs(p1[0] - p2[0]) < width * .86 && Math.abs(p1[1] - p2[1]) < height * .79) {
            zoom = z;
            break;
        }
    }
    focus = center;
    refresh();
}
function drawTiles(width, height) {
    const tileZoom = Math.floor(zoom), factor = 2 ** (zoom - tileZoom), dim = 256 * factor;
    const center = mercator(focus, zoom), left = center[0] - width / 2, top = center[1] - height / 2;
    const firstX = Math.floor(left / dim), lastX = Math.floor((left + width) / dim), firstY = Math.max(0, Math.floor(top / dim)), lastY = Math.floor((top + height) / dim);
    for (let y = firstY; y <= lastY; y++)
        for (let x = firstX; x <= lastX; x++) {
            const n = 2 ** tileZoom;
            if (y >= n)
                continue;
            const xt = ((x % n) + n) % n, key = `${tileZoom}/${xt}/${y}`;
            let rec = imageCache.get(key);
            if (!rec) {
                const img = new Image();
                rec = { image: img, ready: false, failed: false };
                const local = rec;
                img.onload = () => { local.ready = true; refresh(); };
                img.onerror = () => { local.failed = true; refresh(); };
                img.referrerPolicy = 'no-referrer';
                img.src = `https://tile.openstreetmap.org/${key}.png`;
                imageCache.set(key, rec);
            }
            if (rec.ready)
                context.drawImage(rec.image, x * dim - left, y * dim - top, dim + .6, dim + .6);
        }
    if (imageCache.size > 320) {
        for (const key of [...imageCache.keys()].slice(0, 90))
            imageCache.delete(key);
    }
}
function stroke(points, width, color) {
    if (points.length < 2)
        return;
    context.beginPath();
    for (let i = 0; i < points.length; i++) {
        const [x, y] = toScreen(points[i]);
        if (i === 0)
            context.moveTo(x, y);
        else
            context.lineTo(x, y);
    }
    context.strokeStyle = color;
    context.lineWidth = width;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.stroke();
}
function plotLabels(width, height) {
    if (zoom < 11)
        return;
    const labels = [];
    const sorted = [...exits].sort((a, b) => {
        const pa = toScreen(a.position), pb = toScreen(b.position);
        return Math.hypot(pa[0] - width / 2, pa[1] - height / 2) - Math.hypot(pb[0] - width / 2, pb[1] - height / 2);
    });
    for (const exit of sorted) {
        const [x, y] = toScreen(exit.position);
        if (x < 14 || x > width - 14 || y < 55 || y > height - 44)
            continue;
        context.beginPath();
        context.arc(x, y, 3.4, 0, 2 * Math.PI);
        context.fillStyle = '#09283d';
        context.fill();
        context.strokeStyle = '#f3f8fc';
        context.lineWidth = 1.3;
        context.stroke();
        if (zoom < 12.1)
            continue;
        const label = `${exit.road} ${exit.ref} · ${exit.name}`;
        context.font = '600 11px system-ui';
        const wide = context.measureText(label).width;
        const choices = [
            { x: x + 8, y: y - 23, w: wide + 10, h: 17 }, { x: x + 8, y: y + 7, w: wide + 10, h: 17 },
            { x: x - wide - 18, y: y - 23, w: wide + 10, h: 17 }, { x: x - wide - 18, y: y + 7, w: wide + 10, h: 17 }
        ];
        const box = choices.find(b => b.x >= 6 && b.x + b.w <= width - 6 && b.y >= 56 && b.y + b.h <= height - 46 && !labels.some(used => overlaps(b, used)));
        if (!box)
            continue;
        labels.push(box);
        context.fillStyle = '#0a2236e8';
        context.fillRect(box.x, box.y, box.w, box.h);
        context.strokeStyle = '#3d657a';
        context.strokeRect(box.x, box.y, box.w, box.h);
        context.fillStyle = '#fff';
        context.fillText(label, box.x + 5, box.y + 12);
    }
}
function plotRampBadges(width, height) {
    badges = zoom >= 13.2 ? rampBadges(ramps, toScreen, { width, height }) : [];
    for (const badge of badges) {
        const [x, y] = badge.screen, [bx, by] = badge.bubble;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(bx, by);
        context.strokeStyle = '#e8b065';
        context.lineWidth = 1.5;
        context.stroke();
        context.beginPath();
        context.arc(bx, by, 12.5, 0, 2 * Math.PI);
        context.fillStyle = '#674115';
        context.fill();
        context.strokeStyle = '#ffcd7e';
        context.lineWidth = 1.6;
        context.stroke();
        context.fillStyle = '#fff';
        context.font = 'bold 12px system-ui';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(String(badge.number), bx, by + 1);
        context.textAlign = 'start';
        context.textBaseline = 'alphabetic';
    }
}
function draw() {
    const { width, height, scale } = size();
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.fillStyle = '#132b3d';
    context.fillRect(0, 0, width, height);
    drawTiles(width, height);
    // Exact OSM node-connected chains eliminate thick end caps at ordinary way boundaries.
    // Zoom-adaptive outlines keep both carriageways visually distinct on narrow screens.
    const lines = lineWidths(zoom);
    for (const road of drawnRoads)
        stroke(road.points, lines.motorwayCasing, '#083348');
    for (const road of drawnRoads)
        stroke(road.points, lines.motorway, roadColors[road.road]);
    for (const ramp of ramps)
        stroke(ramp.points, lines.rampCasing, '#273b4c');
    for (const ramp of ramps)
        stroke(ramp.points, lines.ramp, '#ffb455');
    plotLabels(width, height);
    plotRampBadges(width, height);
    drawEventMarkers(width, height);
    if (selected) {
        const [x, y] = toScreen(selected.point);
        context.beginPath();
        context.arc(x, y, 9, 0, 2 * Math.PI);
        context.fillStyle = '#39d7ff';
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = '#fff';
        context.stroke();
    }
}
function focusOn(place, z = 13) { activeEventId = null; selected = null; $('detail').hidden = true; focus = place; zoom = z; refresh(); }
function showSelected(hit) {
    activeEventId = null;
    clearEventUi();
    selected = hit;
    selectTrafficRoute(hit.key);
    refresh();
    $('selection-chooser').hidden = true;
    $('new-event-zone').hidden = false;
    $('new-event-button').hidden = false;
    $('selected-fields').hidden = false;
    $('selection-help').hidden = false;
    $('selected-title').textContent = hitLabel(hit);
    $('selected-note').textContent = hit.kind === 'ramp'
        ? 'Überleitung am AD Dernbach – vom OSM-Fahrbahnverlauf ausgewählt.'
        : `Fahrtrichtung eindeutig zugeordnet · OSM-Way ${hit.road.wayId}`;
    $('selected-direction').textContent = hitLabel(hit);
    $('selected-coords').textContent = `${hit.point[0].toFixed(6)}° N · ${hit.point[1].toFixed(6)}° E`;
    const lane = hit.kind === 'ramp' ? rampLaneInfo(hit.ramp, hit.point) : roadLaneInfo(hit.road);
    $('selected-lanes').textContent = lane.label;
    $('selected-lane-names').textContent = lanePositions(lane.count).join(' · ') || 'Keine gesicherte Fahrstreifenaufteilung';
    if (lane.source !== 'osm')
        $('selected-note').textContent += ' · Fahrstreifenangabe nicht aktuell verifiziert.';
    const junction = closestJunction(hit, exits);
    $('selected-junction').textContent = hit.kind === 'ramp'
        ? 'AD Dernbach (A3 39 / A48 13)'
        : junction ? `${junction.exit.road} ${junction.exit.ref} ${junction.exit.name} · ca. ${junction.distanceKm.toFixed(1).replace('.', ',')} km Luftlinie` : 'Nicht zugeordnet';
    $('detail').hidden = false;
    hint.textContent = 'Fahrbahn ausgewählt. Du kannst ein Simulator-Ereignis anlegen.';
}
function selectAt(x, y) {
    const picked = [...events].reverse().find(e => { const p = toScreen(e.point); return Math.hypot(p[0] - x, p[1] - y) <= 18; });
    if (picked) {
        showExistingEvent(picked);
        return;
    }
    // Ramp badges are independent explicit controls, not generic near-road guesses.
    const badge = badges.find(b => Math.hypot(b.bubble[0] - x, b.bubble[1] - y) <= 17);
    if (badge) {
        const snapped = mapCandidates([], [badge.ramp], toScreen(badge.point), toScreen, 2)[0];
        if (snapped)
            showSelected(snapped);
        return;
    }
    const nearby = mapCandidates(allRoads, ramps, [x, y], toScreen, zoom < 10.5 ? 12 : 18);
    const options = chooseMapHits(nearby);
    if (!options.length) {
        hint.textContent = 'Keine A3-/A48-Fahrbahn oder Rampe getroffen. Zoome näher heran.';
        return;
    }
    if (options.length === 1) {
        showSelected(options[0]);
        return;
    }
    selected = null;
    activeEventId = null;
    clearEventUi();
    refresh();
    $('selected-title').textContent = 'Fahrtrichtung auswählen';
    $('selected-note').textContent = 'Mehrere Fahrbahnen oder Rampen liegen hier dicht beieinander. Wähle den richtigen Verkehrsweg:';
    $('selected-fields').hidden = true;
    $('selection-help').hidden = true;
    const parent = $('selection-options');
    parent.replaceChildren();
    for (const option of options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'direction-choice';
        button.textContent = hitLabel(option);
        button.onclick = () => showSelected(option);
        parent.append(button);
    }
    $('selection-chooser').hidden = false;
    $('detail').hidden = false;
    hint.textContent = 'Mehrere Fahrtrichtungen am Fingertipp: bitte unten eindeutig auswählen.';
}
function makeExitButtons() {
    const parent = $('junctions');
    parent.replaceChildren();
    const sorted = [...exits].sort((a, b) => a.road === b.road ? (a.road === 'A3' ? Number(b.ref) - Number(a.ref) : Number(a.ref) - Number(b.ref)) : a.road === 'A3' ? -1 : 1);
    for (const exit of sorted) {
        const button = document.createElement('button');
        const heading = document.createElement('span');
        heading.textContent = `${exit.road} · ${exit.ref}`;
        button.append(heading, document.createTextNode(exit.name));
        button.addEventListener('click', () => { focusOn(exit.position, 13.8); hint.textContent = `${exit.road} AS/Knoten ${exit.ref} – ${exit.name}. Tippe auf die zugehörige Fahrbahn.`; });
        parent.append(button);
    }
}
function fillMetrics() {
    const parent = $('metrics');
    parent.replaceChildren();
    for (const dir of DIRECTIONS) {
        const card = document.createElement('div');
        card.className = 'metric';
        const title = document.createElement('small'), amount = document.createElement('strong');
        title.textContent = names[dir];
        amount.textContent = `${allRoads.filter(r => r.road === dir).reduce((sum, r) => sum + r.km, 0).toFixed(1)} km Fahrbahn`;
        card.append(title, amount);
        parent.append(card);
    }
}
function bind() {
    $('fit').onclick = () => fit();
    $('dernbach').onclick = () => focusOn([50.460264, 7.767549], 14.2);
    for (const [id, road, ref] of [['koblenz', 'A48', '9'], ['diez', 'A3', '41'], ['limburg-nord', 'A3', '42'], ['limburg-sued', 'A3', '43'], ['honnef', 'A3', '34']]) {
        $(id).onclick = () => { const exit = exits.find(e => e.road === road && e.ref === ref); if (exit)
            focusOn(exit.position, 13.8); };
    }
    $('plus').onclick = () => { zoom = Math.min(17, zoom + 1); refresh(); };
    $('minus').onclick = () => { zoom = Math.max(8, zoom - 1); refresh(); };
    $('close').onclick = () => { $('detail').hidden = true; $('event-delete').dataset.confirm = ''; };
    $('new-event-button').onclick = beginEventForm;
    $('event-cancel').onclick = () => { const current = events.find(e => e.id === editingEventId); if (current) {
        showExistingEvent(current);
    }
    else {
        $('event-form').hidden = true;
        $('new-event-button').hidden = false;
    } };
    $('event-kind').addEventListener('change', () => { renderEventLaneChoices(); updateEventConfigPreview(true); });
    $('event-shoulder').addEventListener('change', () => updateEventConfigPreview());
    $('event-speed').addEventListener('change', () => { speedManuallyChanged = true; updateEventConfigPreview(); });
    $('event-edit').onclick = beginEditEvent;
    $('event-save').onclick = saveNewEvent;
    $('event-delete').onclick = removeExistingEvent;
    canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pointerPositions.set(e.pointerId, [e.clientX, e.clientY]); if (pointerPositions.size === 1)
        pointerDown = { x: e.clientX, y: e.clientY, at: performance.now() };
    else
        pointerDown = null; });
    canvas.addEventListener('pointermove', e => {
        const last = pointerPositions.get(e.pointerId);
        if (!last)
            return;
        const current = [e.clientX, e.clientY];
        pointerPositions.set(e.pointerId, current);
        if (pointerPositions.size === 1) {
            const pivot = mercator(focus, zoom);
            focus = inverse([pivot[0] - (current[0] - last[0]), pivot[1] - (current[1] - last[1])], zoom);
            refresh();
        }
        else if (pointerPositions.size === 2) {
            const other = [...pointerPositions.entries()].find(([id]) => id !== e.pointerId)?.[1];
            if (!other)
                return;
            const old = Math.hypot(last[0] - other[0], last[1] - other[1]), next = Math.hypot(current[0] - other[0], current[1] - other[1]);
            if (old > 2) {
                zoom = Math.max(8, Math.min(17, zoom + Math.log2(next / old)));
                refresh();
            }
        }
    });
    canvas.addEventListener('pointerup', e => { pointerPositions.delete(e.pointerId); if (pointerDown && pointerPositions.size === 0 && performance.now() - pointerDown.at < 650 && Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) < 8) {
        const bound = canvas.getBoundingClientRect();
        selectAt(e.clientX - bound.left, e.clientY - bound.top);
    } if (pointerPositions.size === 0)
        pointerDown = null; });
    canvas.addEventListener('pointercancel', e => { pointerPositions.delete(e.pointerId); pointerDown = null; });
    canvas.addEventListener('wheel', e => { e.preventDefault(); zoom = Math.max(8, Math.min(17, zoom + (e.deltaY < 0 ? .4 : -.4))); refresh(); }, { passive: false });
    window.addEventListener('resize', refresh);
}
function start() {
    if (!mapReady.valid) {
        status.classList.add('error');
        status.textContent = 'Geodatenprüfung fehlgeschlagen';
        hint.textContent = mapReady.errors.join(' · ');
        return;
    }
    fillMetrics();
    makeExitButtons();
    bind();
    initializeTraffic();
    redrawEventList();
    fit();
    status.textContent = `✓ ${allRoads.length} OSM-Fahrbahnstücke · ${drawnRoads.length} durchgehende Zeichenlinien · 4 AD-Rampen · ${exits.length} Anschlussstellen`;
    refresh();
}
start();
