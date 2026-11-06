# 🚗 STAU-SIMULATOR – START HIER

Der TypeScript-Quellcode ist fachlich organisiert. **Sechs Hauptdateien** bilden den Einstieg; die **39 weiteren handgeschriebenen Module** liegen in sechs eigenen Ordnern.

| Fachbereich | Hauptdatei | Zugeordnete Module |
| --- | --- | --- |
| 🛣️ Straßennetz | [01_Strassennetz.ts](src/01_Strassennetz.ts) | [01_Strassennetz/](src/01_Strassennetz/) |
| 🚘 Verkehr | [02_Verkehr.ts](src/02_Verkehr.ts) | [02_Verkehr/](src/02_Verkehr/) |
| 📈 Stauphysik | [03_Stauphysik.ts](src/03_Stauphysik.ts) | [03_Stauphysik/](src/03_Stauphysik/) |
| 🚧 Ereignisse | [04_Ereignisse.ts](src/04_Ereignisse.ts) | [04_Ereignisse/](src/04_Ereignisse/) |
| ↪️ Umleitungen | [05_Umleitungen.ts](src/05_Umleitungen.ts) | [05_Umleitungen/](src/05_Umleitungen/) |
| 🗺️ Karte & Anzeige | [06_Karte.ts](src/06_Karte.ts) | [06_Karte/](src/06_Karte/) |

**Wo ändere ich was?** Siehe [ANLEITUNG_FUER_ENTWICKLER.md](ANLEITUNG_FUER_ENTWICKLER.md).

## Welche Dateien sind noch außerhalb der Ordner?

- `src/app.ts`: zentraler Startpunkt der Benutzeroberfläche, der alle Bereiche verbindet.
- `src/geodata.ts`, `src/network-extensions.ts`, `src/extension-detours-data.ts`, `src/regional-detours.ts`, `src/ring-detours-data.ts`: automatisch erzeugte Netz-/Geometriedaten – **nicht** als handgeschriebener Quellcode behandeln. Mehr dazu: [src/GENERIERTE_DATEN.md](src/GENERIERTE_DATEN.md).
- Alte Dateinamen wie `src/traffic-cells.ts`: winzige **Kompatibilitätsweiterleitungen** zu den Fachordnern, damit der vorhandene Code weiterläuft.
- `data/`: OSM-Quellen. `scripts/`: Netzimporte und Build. `tests/`: Testfälle.
- `index.html` und alle `.js` im Hauptverzeichnis bzw. in den sechs öffentlichen Fachordnern: automatisch erzeugte Browserdateien für SPCK, nicht handbearbeiten.

## Änderungen prüfen und als iPhone-Version bereitstellen

Mit Node.js 22+: `npm ci`, dann `npm run check`. Das baut und prüft **alle** Unterordner. Nach erfolgreicher Übernahme in `main` veröffentlicht der GitHub-Workflow die JS-Dateien für SPCK, inklusive der sechs Fachordner.

Das Projekt enthält keine neuen frei erfundenen Straßen: Die bisher vorhandenen Netzdaten bleiben unverändert. Historische technische Dokumentation: [docs/README_ARCHIV.md](docs/README_ARCHIV.md).
