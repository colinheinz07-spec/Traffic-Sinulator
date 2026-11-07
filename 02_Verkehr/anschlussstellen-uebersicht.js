/** Zeigt modellierte Zuflüsse und Ausfahrtsanteile pro vorhandener AS. */
import { networkRoad } from '../network-road.js?build=3b44a696873cb354';
import { normalJunctionTraffic } from '../junction-traffic.js?build=3b44a696873cb354';
import { localJunctionShares } from './anschlussstellen-nachfrage.js?build=3b44a696873cb354';
const fmt = (n) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 });
export function renderLocalDemandProfiles(route, exits, demandVph, moment, calendar, events) {
    const panel = document.getElementById('traffic-local-demand-panel');
    if (!(panel instanceof HTMLDetailsElement) || !panel.open)
        return;
    const list = document.getElementById('traffic-local-demand-list');
    const mode = document.getElementById('traffic-local-demand-mode');
    if (!list || !mode)
        return;
    list.replaceChildren();
    const road = networkRoad(route.key);
    if (!road) {
        list.textContent = 'Für Überleitungen gibt es keine regulären AS-Nachfrageprofile.';
        return;
    }
    const rows = normalJunctionTraffic(route, exits, demandVph, moment, calendar, events)
        .filter(j => j.id.includes(':local:')).sort((a, b) => a.metre - b.metre);
    mode.textContent = calendar ? 'Zeitabhängige örtliche Nachfrage' :
        'Testmodus: ausgewogene Standardanteile';
    if (!rows.length) {
        list.textContent = 'Keine regulären Anschlussstellen auf dieser Fahrtrichtung.';
        return;
    }
    for (const j of rows) {
        const p = localJunctionShares(road, j.ref, calendar);
        const item = document.createElement('div');
        item.className = 'traffic-local-demand-row';
        const title = document.createElement('strong');
        title.textContent = road + ' AS ' + j.ref + ' · ' + p.name;
        const numbers = document.createElement('span');
        numbers.textContent = '↑ ' + fmt(j.entryVph) + ' Fzg/h Auffahrtswunsch · ↓ ' +
            fmt(j.exitPercent) + ' % Abfahrtsanteil';
        const note = document.createElement('small');
        note.textContent = p.reason;
        item.append(title, numbers, note);
        list.append(item);
    }
}
