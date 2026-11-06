# 🚗 STAUSIMULATOR – START HIER

Hier findest du die **sechs klar benannten Hauptbereiche** der App. Du musst nicht mehr in einer riesigen Datei nach den Grundlagen suchen.

| Bereich | Hauptdatei | Deine Aufgabe |
| --- | --- | --- |
| 🛣️ 1. Straßennetz | [01_Strassennetz.ts](src/01_Strassennetz.ts) | Autobahnen, Richtungen, Rampen, Streckenkatalog |
| 🚘 2. Verkehr | [02_Verkehr.ts](src/02_Verkehr.ts) | Verkehrsmengen, Tageszeiten und Wochentage |
| 📈 3. Stauphysik | [03_Stauphysik.ts](src/03_Stauphysik.ts) | Kapazitäten, Geschwindigkeiten, Staudichte |
| 🚧 4. Ereignisse | [04_Ereignisse.ts](src/04_Ereignisse.ts) | Unfälle, Baustellen und Sperrungen |
| ↪️ 5. Umleitungen | [05_Umleitungen.ts](src/05_Umleitungen.ts) | Alternative Wege, Umleitungsentscheidungen |
| 🗺️ 6. Karte | [06_Karte.ts](src/06_Karte.ts) | Kartengeometrie und Darstellung |

**Ausführliche Erklärung in einfacher Sprache:** [ANLEITUNG_FUER_ENTWICKLER.md](ANLEITUNG_FUER_ENTWICKLER.md).

## Was liegt wo?

- **`src/01_...` bis `src/06_...`**: Die sechs aktiven Einstiegsmodule. Hier steht die zentrale Logik jedes Bereichs.
- **Weitere `src/*.ts`**: Spezialisierte Hilfsfunktionen (z. B. Rückstau über mehrere Rampen). Sie sind nach den Bereichen in der Anleitung zugeordnet.
- **`data/*.json`**: Originale Straßennetz- und OSM-Daten. Die vollständige Netzgeometrie bleibt hier bzw. in den automatisch erzeugten Modulen `src/geodata.ts` und `src/network-extensions.ts`. Diese tausenden Punkte *in eine einzige handbearbeitete Datei zu kopieren* wäre fehleranfällig.
- **`scripts/`**: Werkzeuge, um reale Strecken und Anschlussstellen zu importieren.
- **`tests/`**: Automatische Prüfungen für Fahrzeugbilanzen, Rampen, Netz, Sperren usw.
- **`index.html` und `*.js` im Projekt-Hauptordner**: Die aus TypeScript erzeugte SPCK-/Browser-App. Die generierten JS-Dateien nicht von Hand bearbeiten.

Bestehende Dateinamen wie `src/traffic-profiles.ts` sind jetzt kurze **Weiterleitungen**, damit alte Imports und Tests funktionieren. **Neue Änderungen gehören in die nummerierten Hauptdateien oder die genannten Hilfsmodule.**

## Prüfung

Auf einem Computer mit Node.js 22+: `npm ci`, `npm run check`, `npm run build`.

Auf dem iPhone: `index.html` in SPCK öffnen, nachdem die JavaScript-Dateien aus dem Build synchronisiert sind.

Die alten technischen Änderungsprotokolle wurden archiviert: [docs/README_ARCHIV.md](docs/README_ARCHIV.md). Es wurden keine Straßen- oder Rampendaten entfernt.
