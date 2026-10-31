import { siegburgContext } from './siegburg-context.js?build=9296d788994cefba';
import { announcedClosureDemands } from './calendar-traffic.js?build=9296d788994cefba';
import { bindMapGestures } from './map-gestures.js?build=9296d788994cefba';
import { PATHS, pathBottleneck, defaultDemands, demandAtMinute, demandAtClock } from './traffic.js?build=9296d788994cefba';
import { networkData } from './geodata.js?build=9296d788994cefba';
import { routeReport } from './network-report.js?build=9296d788994cefba';
import { makeCorridors, routeSlice, positionM, closureGate, advanceSpatial, emptySpatial, jamsAt } from './spatial.js?build=9296d788994cefba';
import { initialiseCells } from './traffic-cells.js?build=9296d788994cefba';
import { speedDelayLabel } from './speed-delay.js?build=9296d788994cefba';
import { trafficView } from './traffic-view.js?build=9296d788994cefba';
import { resolveSpeedBands } from './traffic-physics.js?build=9296d788994cefba';
import { advanceRoutedNetwork, remainingInterchangeDemands } from './routed-traffic.js?build=9296d788994cefba';
import { routedDiversionChoice, requiredDiversionGate } from './diversion-policy.js?build=9296d788994cefba';
import { automaticDiversions } from './auto-diversions.js?build=9296d788994cefba';
import { buildRampConnections, rampSpillbacks, interchangeDelays, interchangeTrafficShare } from './interchange.js?build=9296d788994cefba';
import { journeyRampCapacity, journeyRampJams, rampCapacity } from './interchange-journeys.js?build=9296d788994cefba';
import { diversionJunctions, planDiversion } from './diversions.js?build=9296d788994cefba';
import { junctionMovements, junctionMovementHint } from './junction-movements.js?build=9296d788994cefba';
import { bundledDetourGeometry, bundledExitRoutes, bundledTargets, isNetworkDestination } from './bundled-detours.js?build=9296d788994cefba';
import { emptyDetour, detourVehicles } from './detour-flow.js?build=9296d788994cefba';
import { decodeEvents, eventFromHit, updatedEvent, eventNames, eventSymbols, eventSummary, flowPolicy, defaultLengthM, maxLengthM, suggestedSpeed, DEFAULT_CLEARANCE_MIN, STORAGE_KEY, isEventKind, validEvent, effectiveEventsAt, eventScheduleStatus } from './events.js?build=9296d788994cefba';
import { roadLaneInfo, rampLaneInfo } from './lane-info.js?build=9296d788994cefba';
import { mapCandidates, chooseMapHits, closestJunction, lanePositions, hitLabel } from './selection.js?build=9296d788994cefba';
import { buildContinuousRoads, lineWidths, rampBadges, layoutJunctionLabels } from './cartography.js?build=9296d788994cefba';
import { placeJamCallout } from './map-callouts.js?build=9296d788994cefba';
import { installScheduleForm } from './schedule-form.js?build=9296d788994cefba';
import { roadSections, physicalEvents } from './road-controls.js?build=9296d788994cefba';
import { DIRECTIONS, validateMap, names, mercator, inverse, nearestPolyline, exitPosition } from './core.js?build=9296d788994cefba';
const $ = (id) => { const element = document.getElementById(id); if (!element)
    throw Error(`Element fehlt: ${id}`); return element; };
const canvas = $('map'), wrapper = canvas.parentElement;
const context = canvas.getContext('2d');
if (!context)
    throw Error('Canvas 2D wird nicht unterstützt');
const status = $('status'), hint = $('hint');
let focus = [50.507, 7.63], zoom = 10, needsDraw = true;
const roadColors = { 'A3-koeln': '#26bb7c', 'A3-frankfurt': '#26bb7c', 'A48-dernbach': '#26bb7c', 'A48-koblenz': '#26bb7c' };
const mapReady = validateMap(networkData);
const allRoads = networkData.roads, ramps = networkData.ramps, exits = networkData.exits;
const drawnRoads = buildContinuousRoads(allRoads);
const spatialCorridors = makeCorridors(allRoads, ramps);
const rampConnections = buildRampConnections(ramps, spatialCorridors);
let badges = [];
let junctionLabels = [];
let trafficLabelRects = [];
let selected = null;
let events = readStoredEvents();
let activeEventId = null;
let editingEventId = null;
let speedManuallyChanged = false;
let storageWarning = '';
function readStoredEvents() {
    try {
        return decodeEvents(window.localStorage.getItem(STORAGE_KEY)).map(event => {
            if (event.pathKey.startsWith('ramp-'))
                return event;
            const project = (p) => [p[1] * 111195 * Math.cos(event.point[0] * Math.PI / 180), p[0] * 111195];
            const road = allRoads.filter(r => r.road === event.pathKey).map(road => ({ road, hit: nearestPolyline(road.points, project(event.point), project) }))
                .sort((a, b) => a.hit.distance - b.hit.distance)[0];
            if (!road || road.hit.distance > 50)
                return event;
            const laneCount = roadLaneInfo(road.road).count;
            if (laneCount === event.laneCount)
                return event;
            return { ...event, laneCount, closedLanes: event.kind === 'closure' ? Array.from({ length: laneCount }, (_, i) => i) : event.closedLanes.filter(i => i < laneCount),
                ...(event.schedule ? { schedule: { ...event.schedule, phases: event.schedule.phases.map(phase => ({ ...phase, closedLanes: phase.kind === 'closure' ? Array.from({ length: laneCount }, (_, i) => i) : phase.closedLanes.filter(i => i < laneCount) })) } } : {}) };
        });
    }
    catch {
        return [];
    }
}
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
function activeEvents() { return effectiveEventsAt(events, simulatedClock().getTime()); }
function scheduleSummary(event) {
    if (!event.schedule)
        return 'Ohne Enddatum';
    const repeated = event.schedule.recurrence;
    if (repeated) {
        const date = (value) => new Date(value + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const days = repeated.weekdays.length === 7 ? 'täglich' : [1, 2, 3, 4, 5, 6, 0].filter(day => repeated.weekdays.includes(day))
            .map(day => ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][day]).join(', ');
        return `Starttage ${date(repeated.firstDate)} – ${date(repeated.lastDate)} · ${days} ${repeated.startTime}–${repeated.endTime}` +
            (repeated.endTime < repeated.startTime ? ' (Folgetag)' : '');
    }
    const fmt = (iso) => new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
    return fmt(event.schedule.startAt) + ' – ' + fmt(event.schedule.endAt) +
        (event.schedule.phases.length ? ' · ' + (event.schedule.phases.length + 1) + ' Bauphasen' : '');
}
function eventStatus(event) {
    const state = eventScheduleStatus(event, simulatedClock().getTime());
    return state === 'planned' ? 'Geplant' : state === 'finished' ? 'Beendet' : state === 'active' ? 'Aktiv' : state === 'between' ? 'Außerhalb des Zeitfensters' : 'Dauerhaft aktiv';
}
const scheduleForm = installScheduleForm({
    clock: () => simulatedClock(), format: (date) => dateTimeInputValue(date), laneCount: () => formLaneCount()
});
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
        meta.textContent = eventSummary(effectiveEventsAt([event], simulatedClock().getTime())[0] ?? event);
        jump.type = 'button';
        jump.textContent = 'Auf Karte ansehen';
        jump.onclick = () => { focus = event.point; zoom = Math.max(zoom, 14.4); showExistingEvent(event); refresh(); };
        const schedule = document.createElement('small');
        schedule.textContent = eventStatus(event) + ' · ' + scheduleSummary(event);
        const state = document.createElement('span');
        state.className = 'schedule-state ' + eventScheduleStatus(event, simulatedClock().getTime());
        state.textContent = eventStatus(event);
        item.append(title, meta, state, schedule, jump);
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
    $('existing-event-desc').textContent = `${eventStatus(e)} · ${scheduleSummary(e)} · ${eventSummary(effectiveEventsAt([e], simulatedClock().getTime())[0] ?? e)} · ${e.point[0].toFixed(6)}° N, ${e.point[1].toFixed(6)}° E`;
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
    for (const event of activeEvents()) {
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
let formJunctionClosures = {};
function renderEventJunctionChoices() {
    const container = $('event-junctions'), kind = $('event-kind').value;
    container.replaceChildren();
    $('event-junction-row').hidden = kind !== 'roadworks' || formPathKey().startsWith('ramp-');
    if ($('event-junction-row').hidden)
        return;
    const path = formPathKey(), route = spatialCorridors[path];
    const point = editingEventId ? events.find(e => e.id === editingEventId)?.point : selected?.point;
    const at = point ? positionM(route, point) : null;
    if (at === null)
        return;
    const end = at + Number($('event-length').value);
    const junctions = diversionJunctions(path, exits, route).filter(j => !j.isInterchange && j.metre >= at - 1 && j.metre <= end + 1);
    if (!junctions.length) {
        container.textContent = 'Keine reguläre Anschlussstelle im gewählten Baustellenabschnitt.';
        return;
    }
    for (const j of junctions) {
        const label = document.createElement('label');
        label.className = 'row-label';
        label.textContent = j.name;
        const select = document.createElement('select');
        select.dataset.junctionRef = j.ref;
        for (const [value, text] of [['open', 'Auf- und Abfahrt offen'], ['entry', 'Nur Auffahrt gesperrt'], ['exit', 'Nur Abfahrt gesperrt'], ['both', 'Auf- und Abfahrt gesperrt']]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            select.append(option);
        }
        select.value = formJunctionClosures[j.ref] ?? 'open';
        select.onchange = () => {
            if (select.value === 'open')
                delete formJunctionClosures[j.ref];
            else
                formJunctionClosures[j.ref] = select.value;
        };
        label.append(select);
        container.append(label);
    }
}
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
    $('event-shoulder-only').hidden = isRamp;
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
        ? 'Punktuelles Ereignis: maximal 200 m.' : kind === 'roadworks' ? 'Baustellenabschnitt: bis 20 km einstellbar.' : 'Sperrabschnitt: bis 100 km einstellbar; kann mehrere Anschlussstellen umfassen.';
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
    $('event-forecast-row').hidden = kind === 'closure' || open > 0 || isRamp;
    $('event-rule-hint').textContent = kind === 'closure'
        ? 'Vollsperrung: Betroffene Fahrten verlassen die Autobahn an der letzten regulären AS davor. Ein noch vor der Sperre offener Autobahnabzweig bleibt für dessen Fahrtziel erreichbar. Auffahrten in den gesperrten Abschnitt bleiben geschlossen; vorhandene Fahrzeuge fahren heraus.'
        : open === 0 ? 'Kein freier Fahrstreifen: derzeit kein Durchfluss. Ein Unfall ist trotzdem KEIN formales Vollsperrungs-Ereignis.'
            : `${open} nutzbare Fahrstreifen (davon ${mode === 'open' ? '1 Standstreifen' : '0 Standstreifen'}). Geschwindigkeitsvorschlag ${suggested} km/h – frei anpassbar. Nur Simulationsannahme, keine StVO-Vorgabe.`;
    renderEventJunctionChoices();
    const point = editingEventId ? events.find(e => e.id === editingEventId)?.point : selected?.point;
    if (point && kind !== 'closure') {
        const candidate = { id: editingEventId ?? 'preview', kind, pathKey: formPathKey(), point, laneCount: count, closedLanes: closed,
            createdAt: new Date().toISOString(), settings: { lengthM: Number(input.value), speedKmh: Number(speed.value), shoulder: mode } };
        const effective = physicalEvents(spatialCorridors[candidate.pathKey], [...activeEvents().filter(e => e.id !== candidate.id), candidate])
            .find(e => e.id === candidate.id);
        if (flowPolicy(candidate).canEnter && !flowPolicy(effective).canEnter)
            $('event-rule-hint').textContent += ' Zusammen mit den vorhandenen Spursperren ist hier kein Fahrstreifen mehr befahrbar.';
    }
}
function beginEventForm() {
    if (!selected)
        return;
    editingEventId = null;
    speedManuallyChanged = false;
    formJunctionClosures = {};
    $('new-event-button').hidden = true;
    $('event-form').hidden = false;
    $('event-kind').value = 'roadworks';
    $('event-shoulder').value = 'normal';
    $('event-length').value = '500';
    $('event-clearance').value = String(DEFAULT_CLEARANCE_MIN);
    $('event-save').textContent = 'Ereignis setzen';
    $('event-form-error').textContent = '';
    scheduleForm.reset();
    renderEventLaneChoices([]);
    updateEventConfigPreview(true);
}
function beginEditEvent() {
    const current = events.find(x => x.id === activeEventId);
    if (!current)
        return;
    const id = current.id;
    formJunctionClosures = { ...current.settings.junctionClosures };
    clearEventUi();
    editingEventId = id;
    speedManuallyChanged = current.settings.speedKmh !== suggestedSpeed(current.kind, current.laneCount, current.closedLanes, current.settings.shoulder);
    $('existing-event').hidden = true;
    $('new-event-zone').hidden = false;
    $('new-event-button').hidden = true;
    $('event-form').hidden = false;
    $('event-save').textContent = 'Änderungen speichern';
    $('event-form-error').textContent = '';
    $('event-kind').value = current.kind;
    scheduleForm.reset(current.schedule);
    $('event-shoulder').value = current.settings.shoulder;
    $('event-length').value = String(current.settings.lengthM);
    $('event-clearance').value = String(current.settings.clearanceMin ?? DEFAULT_CLEARANCE_MIN);
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
    const settings = { lengthM: Number($('event-length').value), speedKmh: Number($('event-speed').value), shoulder: currentShoulder(),
        ...(kind === 'roadworks' ? { junctionClosures: Object.fromEntries(Array.from($('event-junctions').querySelectorAll('select'))
                .filter(s => s.value !== 'open').map(s => [s.dataset.junctionRef, s.value])) } : {}),
        ...(!$('event-forecast-row').hidden ? { clearanceMin: Number($('event-clearance').value) } : {}) };
    try {
        let entry;
        const schedule = scheduleForm.read();
        if (editingEventId) {
            const current = events.find(e => e.id === editingEventId);
            if (!current)
                throw Error('Zu bearbeitendes Ereignis nicht gefunden.');
            entry = { ...updatedEvent(current, kind, closed, settings), schedule };
            if (!validEvent(entry))
                throw Error('Zeitplan ungültig: Beginn vor Ende und jede Bauphase innerhalb des Zeitraums.');
            events = events.map(e => e.id === entry.id ? entry : e);
        }
        else {
            if (!selected)
                throw Error('Wähle zuerst eine Fahrbahn.');
            const id = `ev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
            entry = { ...eventFromHit(selected, kind, count, closed, id, new Date().toISOString(), settings), schedule };
            if (!validEvent(entry))
                throw Error('Zeitplan ungültig: Beginn vor Ende und jede Bauphase innerhalb des Zeitraums.');
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
// Mainline and verified local detours share their cell vehicle inventory.
// AD ramp turn-demand dynamics still use the separate spatial solver.
let spatialState = emptySpatial();
const CELL_PATHS = PATHS.filter(key => !key.startsWith('ramp-'));
let cellNetwork = {};
const trafficDemands = defaultDemands();
const mappedDetours = new Map(readCachedDetours().map(c => [c.id, c]));
const activeDetours = new Map();
const suppressedDetours = new Set();
function readCachedDetours() {
    try {
        const list = JSON.parse(localStorage.getItem('traffic-sinulator-detours-regional-v2') ?? '[]');
        if (!Array.isArray(list))
            return [];
        return list.slice(0, 100).filter((item) => {
            if (!item || typeof item !== 'object')
                return false;
            const c = item, target = c.targetPath ?? c.path, g = c.geometry;
            return DIRECTIONS.includes(c.path) && DIRECTIONS.includes(target) && typeof c.id === 'string' &&
                typeof c.eventId === 'string' && Number.isFinite(c.fromM) && Number.isFinite(c.toM) &&
                c.fromM >= 0 && c.fromM < spatialCorridors[c.path].lengthM && c.toM >= 0 && c.toM <= spatialCorridors[target].lengthM &&
                (target !== c.path || c.toM > c.fromM) && g?.id === c.id && g.path === c.path &&
                ['osm-official-relation', 'osm-routed-infill', 'simulated-bundled', 'osm-motorway-ramp'].includes(g.source) &&
                Number.isFinite(g.freeMinutes) && g.freeMinutes > 0 && Number.isFinite(g.lengthKm) && g.lengthKm > 0 &&
                Number.isFinite(g.roadCapacityVph) && g.roadCapacityVph > 0 && g.roadCapacityVph <= 3000 &&
                (c.movementId === undefined || PATHS.includes(c.movementId) && c.movementId.startsWith('ramp-')) &&
                (g.sections === undefined || Array.isArray(g.sections) && g.sections.length <= 100 && g.sections.every(s => typeof s.id === 'string' && Number.isFinite(s.capacityVph) && s.capacityVph > 0 && s.capacityVph <= 3000)) &&
                Array.isArray(g.points) && g.points.length >= 2 && g.points.length <= 30000 &&
                g.points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
        });
    }
    catch {
        return [];
    }
}
function resetDetourFlow() {
    for (const [key, route] of activeDetours)
        activeDetours.set(key, { ...route, state: emptyDetour(route.config), desiredPercent: 0 });
}
function detourKey(link, targetRef) { return link.id + ':' + targetRef; }
function simulatedLink(path, from, to) {
    return { id: path + '-BUNDLED-' + from.ref, code: 'SIM', path, fromRoad: from.road, fromRef: from.ref,
        toRoad: to.road, toRef: to.ref, evidence: 'partial', description: 'Enthaltene simulierte Umleitung mit angenähertem Verlauf' };
}
let demandMode = 'clock';
let simulationStartMs = Math.floor(Date.now() / 60000) * 60000;
function dateTimeInputValue(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function simulatedClock() { return new Date(simulationStartMs + spatialState.minute * 60000); }
function trafficJams(timeline = activeEvents()) {
    return [...jamsAt(spatialState, timeline, spatialCorridors),
        ...journeyRampJams([...activeDetours.values()], spatialCorridors, timeline, currentDemands())];
}
function currentDemands() {
    const base = demandMode === 'clock' ? demandAtClock(trafficDemands, simulatedClock()) : demandAtMinute(trafficDemands, spatialState.minute, demandMode);
    return announcedClosureDemands(base, events, simulatedClock());
}
let trafficTimer = null;
const trafficRouteLabel = (key) => ramps.find(r => r.id === key)?.name ?? (names[key] ?? key);
const trafficNumber = (n, digits = 0) => n.toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const trafficColorName = { free: 'Frei', slow: 'Stockend', jam: 'Stau / Stop-and-Go', standstill: 'Stillstand / extrem langsam (≤ 10 km/h)' };
/** Find a motorway re-entry AFTER the incident, always in the correct
 * driving direction. An AD/AK is not a local off- or on-ramp.
 */
function findDetourTarget(path, event, exit, link) {
    const route = spatialCorridors[path], where = positionM(route, event.point);
    if (where === null)
        return null;
    const section = closureGate(route, event, exits);
    const downstream = bundledTargets(path, exits, route).filter(x => x.ref !== exit.ref
        && (isNetworkDestination(x) || (section ? x.metre >= section.endM - 1 : x.metre > where + event.settings.lengthM + 50)) && x.metre > exit.metre + 50);
    if (link?.toRef) {
        const documented = downstream.find(x => x.ref === link.toRef);
        // Prefer its documented destination when it is beyond the entire event.
        if (documented)
            return documented;
    }
    return downstream[0] ?? null;
}
function activateDetour(config) {
    for (const [id, other] of activeDetours) {
        if (id !== config.id && other.config.path === config.path && Math.abs(other.config.fromM - config.fromM) < 25 &&
            other.config.movementId === config.movementId)
            activeDetours.set(id, { ...other, enabled: false });
    }
    const old = activeDetours.get(config.id);
    activeDetours.set(config.id, { config, state: old?.state ?? emptyDetour(config), enabled: true });
}
/** All simulator routes are prepared synchronously from the bundled graph.
 * A failed or missing online service cannot block an off-ramp. */
function prepareAutomaticDetour(option, enable = true) {
    const k = option.key, cached = mappedDetours.get(k);
    const geometry = option.geometry ?? (cached && cached.geometry.source !== 'simulated-bundled' ? cached.geometry :
        bundledDetourGeometry(k, option.path, option.from, option.to, exits));
    const config = { id: k, path: option.path, fromM: option.from.metre,
        toM: isNetworkDestination(option.to) ? option.to.metre : positionM(spatialCorridors[option.targetPath ?? option.path], geometry.points.at(-1), 35) ?? option.to.metre, eventId: option.event?.id ?? option.causeId ?? k, geometry,
        targetPath: option.targetPath, sourceEndM: option.sourceEndM, targetEntryM: option.targetEntryM,
        movementId: option.movementId,
        journey: option.journey,
        exitsNetwork: isNetworkDestination(option.to) };
    mappedDetours.set(k, config);
    const running = activeDetours.get(k);
    const timeline = activeEvents(), target = config.targetPath ?? config.path;
    const candidate = { config, state: running?.state ?? emptyDetour(config), enabled: true };
    const required = requiredDiversionGate(config, spatialCorridors[option.path], timeline, exits) !== null ||
        !!config.journey?.forcedByEventId && timeline.some(e => e.id === config.journey.forcedByEventId && e.kind === 'closure') ||
        !!cellNetwork[config.path] && !!cellNetwork[target] && routedDiversionChoice(candidate, [...activeDetours.values()].filter(e => e.config.id !== config.id).concat(candidate), cellNetwork, spatialCorridors, timeline, exits, currentDemands()).mandatory;
    const changed = !running || running.config.eventId !== config.eventId || running.config.fromM !== config.fromM ||
        running.config.toM !== config.toM || running.config.targetPath !== config.targetPath ||
        running.config.movementId !== config.movementId ||
        JSON.stringify(running.config.journey) !== JSON.stringify(config.journey) ||
        running.config.exitsNetwork !== config.exitsNetwork;
    if (enable && required) {
        suppressedDetours.delete(k);
        if (changed || running?.enabled === false)
            activateDetour(config);
    }
    else if (enable && !suppressedDetours.has(k) && changed)
        activateDetour(config);
    return config;
}
function prepareAutomaticDetours() {
    const timeline = activeEvents(), turnDelays = interchangeDelays(trafficJams(timeline), timeline);
    for (const option of automaticDiversions(timeline, spatialCorridors, exits, cellNetwork, rampConnections, turnDelays)) {
        if (!suppressedDetours.has(option.key))
            prepareAutomaticDetour(option);
    }
}
/** Keep ordinary local trips and additional detour movements distinguishable.
 * Both counts come from accepted cell transfers, not requested percentages.
 */
function realJunctionFlows() {
    const demands = currentDemands(), timeline = activeEvents();
    return [...activeDetours.values()].map(entry => ({
        path: entry.config.path, fromM: entry.config.fromM, toM: entry.config.toM,
        eventId: entry.config.eventId, targetPath: entry.config.targetPath, desiredPercent: entry.desiredPercent,
        movementId: entry.config.movementId,
        openTurn: entry.enabled !== false && entry.config.journey?.kind === 'protected' && journeyRampCapacity(entry.config, timeline, demands) > 0 ?
            { gateM: entry.config.journey.gateM, percent: interchangeTrafficShare(entry.config.movementId, entry.config.path, entry.config.targetPath, demands) * 100 } : undefined,
        outVph: entry.state.lastDeparture * 60, inVph: entry.state.lastRejoined * 60,
        vehiclesOnDetour: detourVehicles(entry.state), waitingAtReentry: entry.state.waitingMerge
    }));
}
function junctionRows(path) {
    const timeline = activeEvents();
    return junctionMovements(path, spatialCorridors[path], exits, timeline, null, realJunctionFlows(), cellNetwork[path]?.junctions ?? []);
}
function renderJunctionMovements(path) {
    const host = $('junction-movements');
    host.replaceChildren();
    if (path.startsWith('ramp-')) {
        const p = document.createElement('p');
        p.className = 'junction-note';
        p.textContent = 'Die Überleitungsrampe ist keine eigene Ortsanschlussstelle. Wähle A3 Köln/Frankfurt oder A48 Dernbach/Koblenz.';
        host.append(p);
        return;
    }
    for (const row of junctionRows(path)) {
        const card = document.createElement('div');
        card.className = 'junction-movement' + (row.mandatory ? ' critical' : '');
        const header = document.createElement('div');
        header.className = 'junction-head';
        const title = document.createElement('strong');
        title.textContent = (row.exit.isInterchange ? 'AK/AD ' : 'AS ') + row.exit.ref + ' ' + row.exit.name;
        const badge = document.createElement('span');
        badge.className = 'junction-share';
        badge.textContent = row.exit.isInterchange ? 'Knoten' : ('↘ ' + trafficNumber(row.desiredPercent, 1) + ' % Soll');
        header.append(title, badge);
        const flow = document.createElement('div');
        flow.className = 'junction-flow';
        if (row.exit.isInterchange) {
            flow.textContent = 'Überleitungen A3 ↔ A48 werden separat berechnet.';
        }
        else {
            const out = document.createElement('span');
            out.textContent = 'Abfahrt ↓ ';
            const count = document.createElement('b');
            count.textContent = trafficNumber(row.outVph) + ' Fzg/h';
            const up = document.createElement('span');
            up.textContent = ' · Auffahrt ↑ ';
            const entering = document.createElement('b');
            entering.textContent = trafficNumber(row.inVph) + ' Fzg/h';
            flow.append(out, count, up, entering);
        }
        card.append(header, flow);
        if (!row.exit.isInterchange) {
            const split = document.createElement('div');
            split.className = 'junction-note';
            split.textContent = 'Regulär ↓ ' + trafficNumber(row.normalOutVph) + ' / ↑ ' + trafficNumber(row.normalInVph) +
                ' Fzg/h · Stauumfahrung ↓ ' + trafficNumber(row.diversionOutVph) +
                ' · Rückkehr ↑ ' + trafficNumber(row.returningInVph) + ' Fzg/h';
            if (row.desiredPercent > 0 || row.exitDemandVph > row.outVph + 1)
                split.textContent += ' · Abfahrtswunsch ↓ ' + trafficNumber(row.exitDemandVph) + ' Fzg/h';
            if (row.waitingToEnter > .1)
                split.textContent += ' · ' + trafficNumber(row.waitingToEnter) + ' Fzg warten auf der Auffahrt';
            if (row.exitRampVehicles > 1 || row.desiredPercent > 0)
                split.textContent += ' · Abfahrtsrampe ' + trafficNumber(row.exitRampVehicles) + ' / ' + trafficNumber(row.exitRampStorageVehicles) +
                    ' Fzg · Kreuzungsabfluss bis ' + trafficNumber(row.exitTerminalVph) + ' Fzg/h (Modellannahme)';
            if (row.entryClosed)
                split.textContent += row.exit.access?.[row.path]?.entry === false ? ' · Keine Auffahrt in dieser Richtung' : ' · ⛔ Auffahrt geschlossen';
            if (row.exitClosed)
                split.textContent += row.exit.access?.[row.path]?.exit === false ? ' · Keine Abfahrt in dieser Richtung' : ' · ⛔ Abfahrt geschlossen';
            card.append(split);
            const note = document.createElement('span');
            note.className = 'junction-note';
            note.textContent = row.mandatory ?
                row.desiredPercent < 99.99 ? '⛔ Verkehr auf dem gesperrten A3-Zweig muss hier abfahren. Verkehr zum noch offenen A48-Abzweig darf bis zum AD Dernbach weiterfahren.' :
                    '⛔ Letzte reguläre Ausfahrt vor der Vollsperrung: 100 % sollen abfahren. Die tatsächliche Abfahrt wird durch die Kapazität von Ausfahrt und Nebenstraßen begrenzt.' :
                row.vehiclesOnDetour > 0 || row.waitingAtReentry > 0 || row.desiredPercent > 0 ?
                    'Stauumfahrung · ' + trafficNumber(row.vehiclesOnDetour) + ' Fzg unterwegs/wartend · ' + trafficNumber(row.waitingAtReentry) + ' vor Wiedereinfädelung' :
                    'Keine zusätzliche Stauumfahrung an dieser AS.';
            card.append(note);
        }
        host.append(card);
    }
}
function drawJunctionMovementHints(width, height) {
    if (zoom < 12.2)
        return;
    const key = $('traffic-route').value;
    if (key.startsWith('ramp-') || !DIRECTIONS.includes(key))
        return;
    // Closed entries remain visible even when the panel shows the opposite
    // direction. Give the mandatory movement priority over ordinary traffic.
    const rows = DIRECTIONS.flatMap(path => junctionRows(path)
        .filter(row => path === key || row.entryClosed || row.exitClosed))
        .sort((a, b) => Number(b.mandatory) - Number(a.mandatory) || Number(b.entryClosed) - Number(a.entryClosed));
    const used = [
        ...trafficLabelRects,
        ...junctionLabels.flatMap(label => label.box ? [{ x: label.box.x, y: label.box.y, width: label.box.w, height: label.box.h }] : []),
        ...activeEvents().map(event => { const [x, y] = toScreen(event.point); return { x: x - 25, y: y - 25, width: 50, height: 50 }; })
    ];
    for (const row of rows) {
        if (row.exit.isInterchange || !row.entryClosed && !row.exitClosed && row.desiredPercent <= 0 && row.outVph <= 0 && row.inVph <= 0)
            continue;
        const [x, y] = toScreen(row.exit.position);
        if (x < 24 || x > width - 24 || y < 78 || y > height - 90)
            continue;
        const label = junctionMovementHint(row);
        context.font = 'bold 11px system-ui';
        const w = Math.min(width - 36, 280, Math.max(160, context.measureText(label.title).width + 12, context.measureText(label.flow).width + 12));
        const candidate = placeJamCallout({ x, y }, w, 42, { width, height }, used);
        if (!candidate)
            continue;
        context.save();
        context.fillStyle = '#091e2ce9';
        context.fillRect(candidate.x, candidate.y, candidate.width, candidate.height);
        context.strokeStyle = row.entryClosed || row.exitClosed ? '#ffcd76' : '#52bfe6';
        context.lineWidth = 1.3;
        context.strokeRect(candidate.x, candidate.y, candidate.width, candidate.height);
        context.fillStyle = row.entryClosed || row.exitClosed ? '#ffdd9c' : '#d1f1ff';
        context.fillText(label.title, candidate.x + 6, candidate.y + 15, w - 12);
        context.font = '10px system-ui';
        context.fillText(label.flow, candidate.x + 6, candidate.y + 31, w - 12);
        context.restore();
        used.push(candidate);
    }
}
function renderDiversionPlanner(key, jams, spillbacks) {
    const parent = $('traffic-diversion-plans'), catalog = $('traffic-diversion-catalog');
    parent.replaceChildren();
    catalog.replaceChildren();
    if (key.startsWith('ramp-')) {
        const p = document.createElement('p');
        p.textContent = 'Überleitungsrampen am AD Dernbach sind keine Ortsausfahrten. Wähle A3 oder A48, um geeignete Bedarfsumleitungen zu sehen.';
        parent.append(p);
        return;
    }
    const direction = key, corridor = spatialCorridors[direction];
    const timeline = activeEvents(), turnDelays = interchangeDelays(trafficJams(timeline), timeline);
    const cross = automaticDiversions(timeline, spatialCorridors, exits, cellNetwork, rampConnections, turnDelays)
        .filter(c => c.path === direction && c.targetPath && c.targetPath !== direction && (() => {
        const entry = activeDetours.get(c.key);
        return entry && (entry.desiredPercent ?? 0) > 0 || entry && detourVehicles(entry.state) > 0;
    })());
    for (const option of cross) {
        const row = document.createElement('div');
        row.className = 'diversion-option';
        const title = document.createElement('strong');
        title.textContent = option.journey?.kind === 'via' ?
            'A48 → Köln-Rampe am AD → AS Ransbach-Baumbach → A3 Frankfurt' :
            option.journey?.kind === 'protected' ? 'Offener A48-Abzweig am AD Dernbach' :
                `${option.from.isInterchange ? 'AD' : 'AS'} ${option.from.ref} ${option.from.name} → ${isNetworkDestination(option.to) ? option.to.name : trafficRouteLabel(option.targetPath) + ' · ' + (option.to.isInterchange ? 'AD ' : 'AS ') + option.to.ref + ' ' + option.to.name}`;
        const note = document.createElement('span'), entry = activeDetours.get(option.key);
        note.textContent = entry ? `Automatisch · ${entry.config.geometry.label} · ${trafficNumber(entry.state.lastDeparture * 60)} Fzg/h abgezweigt · ${entry.config.exitsNetwork ? trafficNumber((entry.state.lastExitedNetwork ?? 0) * 60) + ' Fzg/h verlassen das Netz' : trafficNumber(entry.state.lastRejoined * 60) + ' Fzg/h zurück'}` :
            'Enthaltene simulierte Umfahrung des Autobahnknotens';
        if (entry?.config.movementId)
            note.textContent += ' · freiwillig ab 45 min · Zeitverlust der verbleibenden Fahrt · nur Verkehr mit diesem Fahrtziel';
        row.append(title, note);
        parent.append(row);
    }
    const active = activeEvents().filter(e => e.pathKey === direction);
    if (!active.length) {
        const queued = cellNetwork[direction]?.cells.some(c => c.speedKmh <= 65 && c.densityVehKm > 0);
        const p = document.createElement('p');
        p.textContent = cross.length ? 'Umfahrung wegen Rückstau auf der Zielautobahn. Alle enthaltenen Routen stehen unten.' : queued ? 'Stauumfahrung an der nächsten nutzbaren AS vor dem berechneten Stauende; der Zeitverlust bestimmt den Ausweichanteil.' : 'Noch kein Rückstau in dieser Fahrtrichtung. Für jede reguläre Ausfahrt ist unten eine Simulationsroute enthalten.';
        parent.append(p);
    }
    else {
        const traffic = trafficView(jams, cellNetwork, spatialCorridors, activeEvents(), spillbacks, spatialState.minute).reports[direction];
        for (const event of active) {
            const plan = planDiversion(event, corridor, exits, traffic.delayMin);
            if (!plan)
                continue;
            const block = document.createElement('div');
            block.className = 'diversion-preview';
            const title = document.createElement('strong');
            title.textContent = `${eventSymbols[event.kind]} ${eventNames[event.kind]} · ${trafficRouteLabel(direction)}`;
            const demand = document.createElement('p');
            demand.textContent = plan.requiredDiversion ? '⛔ 100 % der Fahrzeuge zum gesperrten Zweig müssen an der letzten AS davor abfahren. Ein vor der Sperre offener Autobahnabzweig bleibt für dessen Fahrtziel nutzbar.'
                : 'Ab 45 Minuten Zeitverlust dieses Staus weichen erste Fahrzeuge an der nächsten nutzbaren AS vor dem Stauende aus. Der Anteil steigt mit dem Zeitverlust; weiter entfernte Ausfahrten davor bleiben beim normalen Verkehr.';
            block.append(title, demand);
            if (!plan.candidateExits.length) {
                const note = document.createElement('p');
                note.textContent = 'Das Ereignis liegt vor der ersten regulären Ausfahrt des Netzes. Bereits vorbeigefahrene Fahrzeuge können nicht rückwärts zur Ausfahrt wechseln.';
                block.append(note);
            }
            for (const option of plan.candidateExits) {
                const target = findDetourTarget(direction, event, option.exit, option.link);
                const line = document.createElement('div');
                line.className = 'diversion-option';
                const label = document.createElement('strong');
                label.textContent = `AS ${option.exit.ref} ${option.exit.name} · ${trafficNumber(option.upstreamKm, 1)} km vor Ereignis`;
                const secondary = document.createElement('span');
                secondary.textContent = isNetworkDestination(target ?? option.exit) ? 'Weiterfahrt über Nebenstraßen aus dem simulierten Netz' : target ? `Wiedereinfahrt AS ${target.ref} ${target.name}` : 'Enthaltene Simulationsroute';
                line.append(label, secondary);
                if (target) {
                    const link = option.link?.toRef === target.ref ? option.link : simulatedLink(direction, option.exit, target);
                    const k = detourKey(link, target.ref), loaded = prepareAutomaticDetour({ key: k, event, path: direction, from: option.exit, to: target, link, delayMin: traffic.delayMin }, false), running = activeDetours.get(k);
                    const details = document.createElement('span');
                    details.textContent = `${loaded.geometry.lengthKm.toFixed(1).replace('.', ',')} km · geschätzt ${loaded.geometry.freeMinutes.toFixed(0)} min · ${loaded.geometry.label}`;
                    line.append(details);
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'diversion-route-button';
                    const required = requiredDiversionGate(loaded, corridor, activeEvents(), exits) !== null;
                    button.textContent = required ? 'Pflichtausleitung aktiv' : running?.enabled !== false && running ? 'Umleitung pausieren' : 'Umleitung aktivieren';
                    button.disabled = required;
                    button.onclick = () => {
                        if (required)
                            return;
                        if (running && running.enabled !== false) {
                            suppressedDetours.add(k);
                            activeDetours.set(k, { ...running, enabled: false });
                        }
                        else {
                            suppressedDetours.delete(k);
                            activateDetour(loaded);
                        }
                        renderTraffic();
                    };
                    line.append(button);
                    if (running?.config.id === k) {
                        const st = running.state, report = document.createElement('span');
                        report.textContent = `${detourVehicles(st) > 0 || st.lastDeparture > 0 ? 'In Nutzung' : 'Bereit'} · ${trafficNumber(detourVehicles(st))} Fahrzeuge insgesamt · ${trafficNumber(st.waitingRoad)} warten vor Nebenstraßen-Engpass · ${trafficNumber(st.waitingMerge)} vor Wiedereinfädelung · ${trafficNumber(st.lastDeparture * 60)} Fzg/h abgezweigt · ${running.config.exitsNetwork ? trafficNumber((st.lastExitedNetwork ?? 0) * 60) + ' Fzg/h verlassen das Netz' : trafficNumber(st.lastRejoined * 60) + ' Fzg/h zurück'}`;
                        line.append(report);
                    }
                }
                else {
                    const unavailable = document.createElement('span');
                    unavailable.textContent = 'Die Ausfahrt liegt bereits hinter dem Ereignis.';
                    line.append(unavailable);
                }
                block.append(line);
            }
            const warning = document.createElement('p');
            warning.className = 'diversion-warning';
            warning.textContent = 'Alle regulären Ausfahrten haben enthaltene Simulationsrouten. Mit wachsendem Zeitverlust steigt die Ausweichbereitschaft bis 100 %. Ausfahrt, Nebenstraßen und Wiedereinfahrt begrenzen den tatsächlichen Abfluss. Bereits abgefahrene Fahrzeuge fahren auch nach Pausieren der Route zu Ende.';
            block.append(warning);
            parent.append(block);
        }
    }
    for (const option of bundledExitRoutes(direction, exits, corridor)) {
        const card = document.createElement('div');
        card.className = 'diversion-option';
        const title = document.createElement('strong'), desc = document.createElement('span');
        title.textContent = `AS ${option.from.ref} ${option.from.name} → ${isNetworkDestination(option.to) ? option.to.name : 'AS ' + option.to.ref + ' ' + option.to.name}`;
        desc.textContent = `Sofort bereit · ${trafficNumber(option.geometry.lengthKm, 1)} km · ca. ${trafficNumber(option.geometry.freeMinutes)} min · ${option.geometry.label}`;
        card.append(title, desc);
        catalog.append(card);
    }
}
/** Simulation time is displayed ABOVE the map. It is not the device's
 * continuously advancing wall clock: only simulation steps change minutes.
 * Reuse the existing local-date input formatter to keep date and time aligned.
 */
function updateMapClock() {
    const clock = simulatedClock();
    const time = $('traffic-clock');
    time.textContent = clock.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    time.dateTime = dateTimeInputValue(clock);
    $('map-clock-date').textContent = clock.toLocaleDateString('de-DE', {
        weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric'
    });
    const state = $('map-clock-status');
    const running = trafficTimer !== null;
    state.textContent = running ? '● Läuft · Minute ' + spatialState.minute :
        spatialState.minute === 0 ? 'Bereit · Minute 0' : 'Pausiert · Minute ' + spatialState.minute;
    state.className = 'map-clock-status' + (running ? ' running' : '');
}
function renderTraffic() {
    prepareAutomaticDetours();
    const timeline = activeEvents();
    const choices = [...activeDetours.values()], demands = currentDemands();
    const turnDelays = interchangeDelays(trafficJams(timeline), timeline);
    for (const entry of choices) {
        const target = entry.config.targetPath ?? entry.config.path;
        const percent = cellNetwork[entry.config.path] && cellNetwork[target] ?
            routedDiversionChoice(entry, choices, cellNetwork, spatialCorridors, timeline, exits, demands, turnDelays).percent : 0;
        activeDetours.set(entry.config.id, { ...entry, desiredPercent: percent });
    }
    const selector = $('traffic-route');
    const key = selector.value;
    if (!PATHS.includes(key))
        return;
    const jams = trafficJams(timeline);
    const spillbacks = rampSpillbacks(jams, rampConnections, spatialCorridors);
    const view = trafficView(jams, cellNetwork, spatialCorridors, timeline, spillbacks, spatialState.minute);
    const result = view.reports[key];
    const bn = pathBottleneck(key, timeline);
    $('traffic-minute').textContent = `Minute ${spatialState.minute}`;
    updateMapClock();
    const activeDemands = remainingInterchangeDemands(currentDemands(), [...activeDetours.values()], timeline);
    const extraRampFlow = new Map();
    for (const entry of activeDetours.values()) {
        const j = entry.config.journey;
        if (j?.kind !== 'via' && j?.kind !== 'protected' && j?.kind !== 'evacuation')
            continue;
        const flow = extraRampFlow.get(j.rampId) ?? { enter: 0, leave: 0 };
        flow.enter += entry.state.lastDeparture * 60;
        flow.leave += entry.state.lastRejoined * 60;
        extraRampFlow.set(j.rampId, flow);
    }
    if (key.startsWith('ramp-'))
        activeDemands[key] += extraRampFlow.get(key)?.enter ?? 0;
    $('traffic-demand').textContent = trafficNumber(activeDemands[key]);
    $('traffic-demand-hint').textContent = demandMode === 'clock'
        ? 'Automatisches Tagesprofil: Nacht, Morgen- und Abendspitze sowie Werktag/Samstag/Sonntag. Der eingegebene Zufluss ist ein Spitzenstunden-Referenzwert, kein Messwert. Feiertage und Ferien sind noch nicht berücksichtigt.'
        : demandMode === 'wave' ? 'Testmodus: Abklingende Stoßzeit ab Simulationsstart; der Zufluss sinkt über ca. 100 Minuten.'
            : 'Testmodus: Konstanter Zufluss unabhängig von Datum und Uhrzeit.';
    let shownCapacity = result.capacityVph;
    let normalOut = result.dischargeVph ?? Math.min(result.capacityVph, activeDemands[key] + result.ownVehicles * 60);
    if (key.startsWith('ramp-')) {
        const legacy = routeReport(key, jams.filter(j => !j.id.startsWith('journey-ramp:')), spillbacks, timeline);
        const link = rampConnections.find(c => c.rampId === key);
        const closed = link && timeline.some(e => {
            const gate = closureGate(spatialCorridors[link.to], e, exits, timeline);
            return gate && link.downstreamMergeM >= gate.metre - 1 && link.downstreamMergeM < gate.endM - 1;
        });
        shownCapacity = closed ? 0 : Math.min(rampCapacity(key, timeline, currentDemands(), spatialCorridors[key]), legacy.capacityVph);
        normalOut = Math.min(shownCapacity, activeDemands[key] - (extraRampFlow.get(key)?.enter ?? 0) + legacy.ownVehicles * 60);
    }
    $('traffic-capacity').textContent = trafficNumber(shownCapacity);
    $('traffic-outflow').textContent = trafficNumber(normalOut + (extraRampFlow.get(key)?.leave ?? 0));
    $('traffic-queue').textContent = trafficNumber(result.queueVehicles);
    $('traffic-shared').textContent = result.sharedRampVehicles > 0 ? `Abfahrtsstreifen betroffen (${trafficColorName[result.exitColor]}): ${trafficNumber(result.sharedRampVehicles)} Fahrzeuge der Rampenwarteschlange auf dieser Autobahn. Abbieger-Wartezeit: ${result.exitDelayMin === null ? 'nicht berechenbar' : trafficNumber(result.exitDelayMin, 1) + ' min'}. Kein zusätzlich erzeugter Stau im Durchgangsverkehr.` : 'Keine Rampenfahrzeuge auf diesem Abschnitt';
    $('traffic-queue-km').textContent = `${trafficNumber(result.queueKm, 1)} km${result.sharedRampVehicles > 0 && result.ownVehicles === 0 ? ' · Abfahrt' : ''}`;
    $('traffic-delay').textContent = speedDelayLabel(view.delays[key]) + (result.sharedRampVehicles > 0 ? ' durchgehend · Abfahrt ' + (result.exitDelayMin === null ? 'blockiert' : '+' + trafficNumber(result.exitDelayMin, 1) + ' min') : '');
    $('traffic-speed').textContent = result.sharedRampVehicles > 0 ?
        `Abfahrt Ø ${trafficNumber(result.exitMeanSpeedKmh ?? result.speedKmh, 1)} / Durchgang Ø ${trafficNumber(result.throughMeanSpeedKmh ?? result.throughSpeedKmh ?? result.speedKmh, 1)} km/h` :
        `Ø ${trafficNumber(result.meanSpeedKmh ?? result.speedKmh, 1)} km/h${result.ownVehicles > 0 ? ' (Rückstau)' : bn.count > 0 ? ' (Ereignisbereich)' : ' (freie Fahrt)'}`;
    $('traffic-events').textContent = bn.count === 0 ? 'Kein eigenes Ereignis auf dieser Richtung – mögliche Rückstauübertragung am AD wird berücksichtigt' :
        `${bn.count} eigene(s) Ereignis(se) auf dieser Richtung`;
    const stateLabel = $('traffic-state');
    stateLabel.textContent = result.sharedRampVehicles > 0 ? trafficColorName[result.exitColor].split(' / ')[0] + ' (Abfahrt) · Durchgang ' + trafficColorName[result.throughColor ?? result.color].toLowerCase() : trafficColorName[result.color];
    stateLabel.className = `traffic-state ${result.color}`;
    $('traffic-closure-note').textContent = bn.event?.kind === 'closure' ? 'Vollsperrung: Betroffene Fahrzeuge fahren an der letzten regulären Ausfahrt ab. Ein vor der Sperre offener Autobahnabzweig bleibt für dessen Fahrtziel nutzbar. Der Zeitverlust gilt für den Rückstau bis zur Ausleitung. Auffahrten im gesperrten Abschnitt bleiben geschlossen; vorhandene Fahrzeuge fahren heraus. Für die gesperrte Geradeausfahrt gibt es keine Durchfahrtsprognose.' :
        view.delays[key].forecastWaitMin !== undefined ? 'Geschätzter Zeitverlust: angenommene Restdauer bis zur Freigabe ' + trafficNumber(view.delays[key].forecastWaitMin) + ' min, anschließend zunächst ein freier Fahrstreifen mit 40 km/h. Die Restdauer lässt sich im Ereignis ändern; Fahrstreifen werden dadurch nicht automatisch geöffnet.' : '';
    const mergeQueues = jams.filter(j => j.id.startsWith('merge:') && !j.released);
    const overflowText = spillbacks.map(s => `${trafficRouteLabel(s.rampId)}: ${trafficNumber(s.lengthM / 1000, 2)} km Rückstau auf ${trafficRouteLabel(s.source)}`).join(' · ');
    const mergeText = mergeQueues.map(x => `${trafficRouteLabel(x.pathKey)}: ${trafficNumber(x.queueVehicles)} Fahrzeuge warten wegen Rückstau an der Einmündung`).join(' · ');
    $('traffic-interchange').textContent = [overflowText, mergeText].filter(Boolean).join(' · ') || 'AD Dernbach: Kein Rückstau reicht derzeit von einer Rampe auf A3/A48 oder von einer Zielautobahn in eine Rampe zurück.';
    const parent = $('traffic-summary');
    parent.replaceChildren();
    for (const item of PATHS) {
        const m = view.reports[item];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'traffic-summary-row';
        const label = document.createElement('span');
        label.textContent = trafficRouteLabel(item);
        const status = document.createElement('strong');
        status.className = `traffic-state ${m.color}`;
        status.textContent = `${trafficNumber(m.queueKm, 1)} km · ${speedDelayLabel(view.delays[item])} · Ø ${trafficNumber(m.meanSpeedKmh ?? m.speedKmh)} km/h${m.sharedRampVehicles > 0 ? ' · Abfahrt ' + trafficColorName[m.exitColor].toLowerCase() : ''}`;
        button.append(label, status);
        button.setAttribute('aria-label', `${label.textContent}, ${status.textContent}`);
        button.onclick = () => selectTrafficRoute(item);
        parent.append(button);
    }
    const container = $('traffic-jams');
    container.replaceChildren();
    $('traffic-jams-count').textContent = `(${view.jams.length})`;
    if (view.jams.length === 0) {
        const p = document.createElement('p');
        p.textContent = 'Kein Rückstau vorhanden. Stau entsteht erst, wenn der Zufluss die Kapazität übersteigt.';
        container.append(p);
    }
    for (const jam of view.jams) {
        const event = timeline.find(e => e.id === jam.eventId);
        const symbol = event ? eventSymbols[event.kind] : '🚗';
        const kind = jam.released ? 'Rückstau löst sich auf'
            : jam.queueOwnerId?.startsWith('merge:') ? 'Rückstau an der Überleitung'
                : event ? eventNames[event.kind] : 'Verkehrsstau';
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'traffic-summary-row jam-card';
        row.setAttribute('data-traffic-state', jam.color);
        const header = document.createElement('div');
        header.className = 'jam-card-header';
        const marker = document.createElement('span');
        marker.className = 'jam-card-sign';
        marker.textContent = symbol;
        marker.setAttribute('aria-hidden', 'true');
        const heading = document.createElement('div');
        heading.className = 'jam-card-heading';
        const eventName = document.createElement('strong');
        eventName.textContent = kind;
        const direction = document.createElement('span');
        direction.textContent = trafficRouteLabel(jam.pathKey);
        heading.append(eventName, direction);
        const delay = document.createElement('strong');
        delay.className = 'jam-card-delay';
        delay.textContent = speedDelayLabel(jam.delay);
        header.append(marker, heading, delay);
        const metrics = document.createElement('div');
        metrics.className = 'jam-card-metrics';
        const length = document.createElement('span');
        length.textContent = `↔ ${trafficNumber(jam.queueM / 1000, 1)} km Rückstau`;
        const speed = document.createElement('span');
        speed.className = `traffic-state ${jam.color}`;
        speed.textContent = `Ø ${trafficNumber(jam.meanSpeedKmh)} km/h · langsamster Abschnitt ${trafficNumber(jam.speedKmh)} km/h`;
        metrics.append(length, speed);
        row.append(header, metrics);
        const overflow = spillbacks.find(x => x.id === jam.queueOwnerId && x.rampId === jam.pathKey);
        if (overflow && jam.feederM > 0) {
            const extra = document.createElement('span');
            extra.className = 'jam-card-note';
            extra.textContent = `Davon ${trafficNumber(jam.visibleQueueM / 1000, 2)} km auf der Rampe und ${trafficNumber(jam.feederM / 1000, 2)} km auf ${trafficRouteLabel(overflow.source)} – Abfahrtsstreifen`;
            row.append(extra);
        }
        row.setAttribute('aria-label', `${symbol} ${kind}, ${trafficRouteLabel(jam.pathKey)}, ${delay.textContent}, ${length.textContent}, ${speed.textContent}`);
        row.onclick = () => { focus = overflow ? ramps.find(r => r.id === overflow.rampId).points[0] : jam.point; zoom = Math.max(zoom, 14); refresh(); };
        container.append(row);
    }
    redrawEventList();
    renderJunctionMovements(key);
    renderDiversionPlanner(key, jams, spillbacks);
    refresh();
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
} $('traffic-play').textContent = '▶ Start'; $('traffic-play').setAttribute('aria-pressed', 'false'); updateMapClock(); }
function stepTraffic(minutes) {
    try {
        for (let i = 0; i < minutes; i++) {
            prepareAutomaticDetours();
            const active = currentDemands();
            const timeline = activeEvents();
            const transfers = [];
            const jams = trafficJams(timeline);
            const spillbacks = rampSpillbacks(jams, rampConnections, spatialCorridors);
            // Actual departures and returns share the A3/A48 cell inventory.
            for (const key of CELL_PATHS)
                cellNetwork[key] ??= initialiseCells(spatialCorridors[key], active[key]);
            const next = advanceRoutedNetwork(cellNetwork, spatialCorridors, timeline, active, exits, [...activeDetours.values()], interchangeDelays(jams, timeline), simulatedClock());
            cellNetwork = next.cells;
            for (const entry of next.detours)
                activeDetours.set(entry.config.id, entry);
            transfers.push(...next.transfers);
            const physicalMainline = trafficView(jams, cellNetwork, spatialCorridors, timeline, spillbacks, spatialState.minute + 1)
                .physicalJams.filter(j => !j.pathKey.startsWith('ramp-'));
            const legacyActive = remainingInterchangeDemands(active, [...activeDetours.values()], timeline);
            spatialState = advanceSpatial(spatialState, timeline, legacyActive, 1, spatialCorridors, rampConnections, transfers, exits, physicalMainline);
        }
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
    const pattern = $('traffic-demand-mode');
    pattern.value = demandMode;
    pattern.addEventListener('change', () => {
        demandMode = pattern.value === 'constant' ? 'constant' : pattern.value === 'wave' ? 'wave' : 'clock';
        renderTraffic();
    });
    const startInput = $('traffic-start-datetime');
    startInput.value = dateTimeInputValue(new Date(simulationStartMs));
    startInput.addEventListener('change', () => {
        const next = new Date(startInput.value);
        if (!Number.isFinite(next.getTime()) || dateTimeInputValue(next) !== startInput.value) {
            $('traffic-issue').textContent = 'Ungültiges Datum oder ungültige Uhrzeit.';
            startInput.value = dateTimeInputValue(new Date(simulationStartMs));
            return;
        }
        stopTraffic();
        simulationStartMs = next.getTime();
        spatialState = emptySpatial();
        cellNetwork = {};
        resetDetourFlow();
        $('traffic-issue').textContent = '';
        renderTraffic();
    });
    $('traffic-now').onclick = () => {
        stopTraffic();
        simulationStartMs = Math.floor(Date.now() / 60000) * 60000;
        spatialState = emptySpatial();
        cellNetwork = {};
        resetDetourFlow();
        startInput.value = dateTimeInputValue(new Date(simulationStartMs));
        $('traffic-issue').textContent = '';
        renderTraffic();
    };
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
        $('traffic-play').setAttribute('aria-pressed', 'true');
        trafficTimer = setInterval(() => stepTraffic(1), 1000);
        updateMapClock();
    };
    $('traffic-reset').onclick = () => { stopTraffic(); spatialState = emptySpatial(); cellNetwork = {}; resetDetourFlow(); renderTraffic(); };
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
function stroke(points, width, color, offset = 0) {
    if (points.length < 2)
        return;
    context.beginPath();
    for (let i = 0; i < points.length; i++) {
        let [x, y] = toScreen(points[i]);
        if (offset) {
            const a = toScreen(points[Math.max(0, i - 1)]), b = toScreen(points[Math.min(points.length - 1, i + 1)]);
            const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy) || 1;
            x -= dy / length * offset;
            y += dx / length * offset;
        }
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
    const bounds = canvas.getBoundingClientRect();
    const obstacles = Array.from(wrapper.querySelectorAll('.map-status,.map-controls,.legend')).map(element => {
        const r = element.getBoundingClientRect();
        return { x: r.left - bounds.left, y: r.top - bounds.top, w: r.width, h: r.height };
    });
    obstacles.push(...trafficLabelRects.map(box => ({ x: box.x, y: box.y, w: box.width, h: box.height })));
    for (const event of activeEvents()) {
        const [x, y] = toScreen(event.point);
        obstacles.push({ x: x - 24, y: y - 24, w: 48, h: 48 });
    }
    context.font = '600 10px system-ui';
    const key = $('traffic-route').value;
    const mapExits = DIRECTIONS.includes(key) ? exits.map(e => ({ ...e, position: exitPosition(e, key) })) : exits;
    junctionLabels = layoutJunctionLabels(mapExits, toScreen, { width, height }, zoom, text => context.measureText(text).width, obstacles);
    for (const { point: [x, y], text, box } of junctionLabels) {
        context.beginPath();
        context.arc(x, y, 3.4, 0, 2 * Math.PI);
        context.fillStyle = '#09283d';
        context.fill();
        context.strokeStyle = '#f3f8fc';
        context.lineWidth = 1.3;
        context.stroke();
        if (!box)
            continue;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(Math.max(box.x, Math.min(box.x + box.w, x)), Math.max(box.y, Math.min(box.y + box.h, y)));
        context.strokeStyle = '#66899d';
        context.lineWidth = .8;
        context.stroke();
        context.fillStyle = '#0a2236ed';
        context.fillRect(box.x, box.y, box.w, box.h);
        context.strokeStyle = '#3d657a';
        context.strokeRect(box.x, box.y, box.w, box.h);
        context.fillStyle = '#fff';
        context.fillText(text, box.x + 6, box.y + 13);
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
const jamColors = { slow: '#f59e0b', jam: '#dc2626', standstill: '#7f1d1d' };
function drawSpatialJams() {
    trafficLabelRects = [];
    const timeline = activeEvents();
    const list = trafficJams(timeline);
    const spillbacks = rampSpillbacks(list, rampConnections, spatialCorridors);
    const view = trafficView(list, cellNetwork, spatialCorridors, timeline, spillbacks, spatialState.minute);
    const widths = lineWidths(zoom);
    // A motorway ending at an AD split has no separate straight-ahead road.
    // Show a backed-up branch across the full approach stroke, matching the
    // worst-lane route status. Keep destination flows and delays independent.
    const terminalFeeders = new Set(spillbacks.filter(s => Math.abs(s.sourceAnchorM - spatialCorridors[s.source].lengthM) < 1).map(s => s.source));
    for (const [key, bands] of view.bands) {
        const route = spatialCorridors[key], narrow = key.startsWith('ramp-');
        const count = key.startsWith('A48') ? 2 : 3;
        const restricted = narrow ? [] : roadSections(route, timeline).filter(s => s.openLanes.length < count);
        const drawOpen = (line, section, color) => {
            const lanes = [...section.openLanes, ...(section.shoulderOpen ? [-1] : [])];
            for (const lane of lanes)
                stroke(line, widths.motorway / count + .15, color, ((count - 1) / 2 - lane) * widths.motorway / count);
        };
        for (const section of restricted) {
            const line = routeSlice(route, section.fromM, section.toM);
            stroke(line, widths.motorway + .65, '#667582');
            drawOpen(line, section, '#26bb7c');
        }
        const shown = terminalFeeders.has(key)
            ? resolveSpeedBands([...bands, ...(view.spillBands.get(key) ?? [])]) : bands;
        for (const band of shown) {
            if (band.color === 'free')
                continue;
            const cuts = [band.fromM, ...restricted.flatMap(s => [s.fromM, s.toM]).filter(m => m > band.fromM && m < band.toM), band.toM].sort((a, b) => a - b);
            for (let i = 1; i < cuts.length; i++) {
                const from = cuts[i - 1], to = cuts[i], line = routeSlice(route, from, to);
                if (line.length < 2)
                    continue;
                const section = restricted.find(s => s.fromM < (from + to) / 2 && s.toM > (from + to) / 2);
                if (section && (section.openLanes.length || section.shoulderOpen))
                    drawOpen(line, section, jamColors[band.color]);
                else {
                    const width = narrow ? widths.ramp : widths.motorway;
                    stroke(line, width + 1.5, '#112537');
                    stroke(line, width + .65, jamColors[band.color]);
                }
            }
        }
    }
    // A branch off a continuing motorway keeps its separate narrow exit lane.
    // Terminal approaches were already resolved at full width above; drawing
    // them again could paint a faster ramp band over a slower mainline queue.
    for (const [key, bands] of view.spillBands) {
        if (terminalFeeders.has(key))
            continue;
        const route = spatialCorridors[key];
        for (const band of bands) {
            if (band.color === 'free')
                continue;
            const line = routeSlice(route, band.fromM, band.toM);
            if (line.length > 1)
                stroke(line, Math.max(1, widths.motorway * .46), jamColors[band.color]);
        }
    }
    if (zoom < 11.4)
        return;
    const labelObstacles = [
        ...badges.map(b => ({ x: b.bubble[0] - 23, y: b.bubble[1] - 23, width: 46, height: 46 })),
        ...timeline.map(e => { const [x, y] = toScreen(e.point); return { x: x - 25, y: y - 25, width: 50, height: 50 }; })
    ];
    for (const jam of view.jams) {
        // Never place a big overlay directly on the motorway/ramp junction:
        // choose a small detached callout or omit it entirely when map is crowded.
        const road = spatialCorridors[jam.pathKey];
        const at = Math.max(0, jam.anchorM - jam.visibleQueueM * .5);
        const mid = routeSlice(road, Math.max(0, at - 2), Math.min(road.lengthM, at + 2));
        if (!mid.length)
            continue;
        const [x, y] = toScreen(mid[0]);
        const event = timeline.find(e => e.id === jam.eventId), sign = event ? eventSymbols[event.kind] : '🚗';
        const shortDirection = jam.pathKey === 'A3-koeln' ? 'A3 Köln' : jam.pathKey === 'A3-frankfurt' ? 'A3 Frankfurt'
            : jam.pathKey === 'A48-dernbach' ? 'A48 Dernbach' : jam.pathKey === 'A48-koblenz' ? 'A48 Koblenz'
                : jam.pathKey === 'ramp-a48-to-koeln' ? 'A48→A3 Köln'
                    : jam.pathKey === 'ramp-a48-to-frankfurt' ? 'A48→A3 Ffm' : 'AD Dernbach Rampe';
        const delay = speedDelayLabel(jam.delay, 1, true);
        const first = `${sign} ${shortDirection} · ${delay}`;
        const second = `${trafficNumber(jam.queueM / 1000, 1)} km · Ø ${trafficNumber(jam.meanSpeedKmh)} km/h`;
        context.font = '600 10px system-ui';
        const width = Math.min(194, Math.max(context.measureText(first).width, context.measureText(second).width) + 15);
        const callout = placeJamCallout({ x, y }, width, 33, { width: wrapper.clientWidth, height: wrapper.clientHeight }, labelObstacles);
        if (!callout)
            continue;
        context.save();
        context.strokeStyle = '#4d91af';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(callout.x + (callout.x > x ? 0 : callout.width), callout.y + callout.height / 2);
        context.stroke();
        context.fillStyle = '#102332e5';
        context.fillRect(callout.x, callout.y, callout.width, callout.height);
        context.fillStyle = '#fff';
        context.fillText(first, callout.x + 7, callout.y + 13, callout.width - 14);
        context.fillStyle = '#bbd9e8';
        context.fillText(second, callout.x + 7, callout.y + 26);
        context.restore();
        labelObstacles.push(callout);
        trafficLabelRects.push(callout);
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
    for (const feature of siegburgContext) {
        stroke(feature.points, feature.kind === 'ramp' ? lines.rampCasing : lines.motorwayCasing, '#061927');
        stroke(feature.points, feature.kind === 'ramp' ? lines.ramp : lines.motorway, '#9baebd');
    }
    for (const road of drawnRoads)
        stroke(road.points, lines.motorway, roadColors[road.road]);
    for (const ramp of ramps)
        stroke(ramp.points, lines.rampCasing, '#273b4c');
    for (const ramp of ramps)
        stroke(ramp.points, lines.ramp, '#26bb7c');
    drawSpatialJams();
    plotLabels(width, height);
    plotRampBadges(width, height);
    drawEventMarkers(width, height);
    drawJunctionMovementHints(width, height);
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
    const timeline = activeEvents(), jams = trafficJams(timeline);
    const view = trafficView(jams, cellNetwork, spatialCorridors, timeline, rampSpillbacks(jams, rampConnections, spatialCorridors), spatialState.minute);
    const details = view.reports[hit.key];
    $('selected-traffic').textContent = `${trafficNumber(details.queueVehicles)} Fahrzeuge auf diesem Fahrweg · ${trafficNumber(details.queueKm, 2)} km Rückstau · ${speedDelayLabel(view.delays[hit.key])}${details.sharedRampVehicles > 0 ? ' Durchgang · Abfahrt ' + (details.exitDelayMin === null ? 'blockiert' : '+' + trafficNumber(details.exitDelayMin, 1) + ' min') : ''}`;
    const lane = hit.kind === 'ramp' ? rampLaneInfo(hit.ramp, hit.point) : roadLaneInfo(hit.road);
    $('selected-lanes').textContent = lane.label;
    $('selected-lane-names').textContent = lanePositions(lane.count).join(' · ') || 'Keine gesicherte Fahrstreifenaufteilung';
    if (lane.source !== 'osm' && lane.source !== 'normal')
        $('selected-note').textContent += ' · Fahrstreifenangabe nicht aktuell verifiziert.';
    const junction = closestJunction(hit, exits);
    $('selected-junction').textContent = hit.kind === 'ramp'
        ? 'AD Dernbach (A3 39 / A48 13)'
        : junction ? `${junction.exit.road} ${junction.exit.ref} ${junction.exit.name} · ca. ${junction.distanceKm.toFixed(1).replace('.', ',')} km Luftlinie` : 'Nicht zugeordnet';
    $('detail').hidden = false;
    hint.textContent = 'Fahrbahn ausgewählt. Du kannst ein Simulator-Ereignis anlegen.';
}
function selectAt(x, y) {
    const picked = [...activeEvents()].reverse().find(e => { const p = toScreen(e.point); return Math.hypot(p[0] - x, p[1] - y) <= 18; });
    if (picked) {
        showExistingEvent(picked);
        return;
    }
    const junction = junctionLabels.find(label => label.box && x >= label.box.x && x <= label.box.x + label.box.w &&
        y >= label.box.y && y <= label.box.y + label.box.h);
    if (junction) {
        focusOn(junction.exit.position, 13.8);
        hint.textContent = `${junction.exit.road} ${junction.exit.ref} ${junction.exit.name}. Tippe auf die zugehörige Fahrbahn.`;
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
        const contextual = siegburgContext.map(feature => ({ feature, hit: nearestPolyline(feature.points, [x, y], toScreen) })).sort((a, b) => a.hit.distance - b.hit.distance)[0];
        hint.textContent = contextual && contextual.hit.distance < 16 ? `${contextual.feature.name ?? 'A560 am AK Bonn/Siegburg'} · ${contextual.feature.lanes} reguläre Fahrstreifen · Kartenergänzung, ohne eigene Verkehrssimulation` : 'Keine A3-/A48-Fahrbahn oder Rampe getroffen. Zoome näher heran.';
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
    const sorted = [...exits].sort((a, b) => a.road === b.road ? (a.road === 'A3' ? Number.parseFloat(b.ref) - Number.parseFloat(a.ref) || b.ref.localeCompare(a.ref) : Number(a.ref) - Number(b.ref)) : a.road === 'A3' ? -1 : 1);
    const toolbar = document.querySelector('.toolbar');
    const oldButtons = new Map([['A3:39', $('dernbach')], ['A48:9', $('koblenz')], ['A3:41', $('diez')],
        ['A3:42', $('limburg-nord')], ['A3:43', $('limburg-sued')], ['A3:34', $('honnef')], ['A3:33', $('siebengebirge')], ['A3:32', $('bonn-siegburg')]]);
    toolbar.replaceChildren($('fit'));
    $('junction-count').textContent = String(sorted.length);
    for (const exit of sorted) {
        const button = document.createElement('button');
        const heading = document.createElement('span');
        heading.textContent = `${exit.road} · ${exit.ref}`;
        button.append(heading, document.createTextNode(exit.name));
        button.addEventListener('click', () => { focusOn(exit.position, 13.8); hint.textContent = `${exit.road} AS/Knoten ${exit.ref} – ${exit.name}. Tippe auf die zugehörige Fahrbahn.`; });
        parent.append(button);
        const key = exit.road + ':' + exit.ref, shortcut = oldButtons.get(key) ?? document.createElement('button');
        shortcut.dataset.junctionKey = key;
        shortcut.textContent = /^(AD|AK) /.test(exit.name) ? exit.name : 'AS ' + exit.name;
        shortcut.onclick = () => { focusOn(exit.position, 13.8); hint.textContent = `${exit.road} ${exit.ref} ${exit.name}`; };
        toolbar.append(shortcut);
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
    for (const [id, road, ref] of [['koblenz', 'A48', '9'], ['diez', 'A3', '41'], ['limburg-nord', 'A3', '42'], ['limburg-sued', 'A3', '43'], ['honnef', 'A3', '34'], ['siebengebirge', 'A3', '33'], ['bonn-siegburg', 'A3', '32']]) {
        $(id).onclick = () => {
            const exit = exits.find(e => e.road === road && e.ref === ref), key = $('traffic-route').value;
            if (exit)
                focusOn(DIRECTIONS.includes(key) ? exitPosition(exit, key) : exit.position, 13.8);
        };
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
    $('event-kind').addEventListener('change', () => { renderEventLaneChoices(); updateEventConfigPreview(true); scheduleForm.display(); });
    $('event-shoulder').addEventListener('change', () => updateEventConfigPreview());
    $('event-length').addEventListener('change', () => updateEventConfigPreview());
    $('event-shoulder-only').onclick = () => {
        if ($('event-kind').value === 'closure')
            $('event-kind').value = 'roadworks';
        $('event-shoulder').value = 'open';
        speedManuallyChanged = false;
        renderEventLaneChoices(Array.from({ length: formLaneCount() }, (_, i) => i));
        updateEventConfigPreview();
    };
    $('event-speed').addEventListener('change', () => { speedManuallyChanged = true; updateEventConfigPreview(); });
    $('event-edit').onclick = beginEditEvent;
    $('event-save').onclick = saveNewEvent;
    $('event-delete').onclick = removeExistingEvent;
    // iOS WebKit otherwise selects map labels and shows the native "Kopieren"
    // callout on a tap-and-hold. Keep text selection intact in input/forms.
    const mapRegion = canvas.closest('.map-shell');
    if (!mapRegion)
        throw Error('Kartenoberfläche fehlt');
    for (const type of ['contextmenu', 'selectstart', 'dragstart']) {
        mapRegion.addEventListener(type, event => event.preventDefault());
    }
    canvas.addEventListener('dblclick', event => event.preventDefault());
    bindMapGestures(canvas, {
        pan(dx, dy) { const pivot = mercator(focus, zoom); focus = inverse([pivot[0] - dx, pivot[1] - dy], zoom); refresh(); },
        zoomAt(x, y, delta) {
            const anchor = fromScreen(x, y);
            zoom = Math.max(8, Math.min(17, zoom + delta));
            const projected = mercator(anchor, zoom);
            focus = inverse([projected[0] - x + wrapper.clientWidth / 2, projected[1] - y + wrapper.clientHeight / 2], zoom);
            refresh();
        },
        select: selectAt
    });
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
    status.textContent = `✓ ${exits.length} AS/Knoten · ${allRoads.length} OSM-Fahrbahnstücke · 4 AD-Rampen · AK Bonn/Siegburg vollständig`;
    refresh();
}
start();
