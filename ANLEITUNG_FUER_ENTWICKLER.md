# 📘 Entwickler-Anleitung für deinen Stausimulator

## 1. Straßennetz – wo ist welche Autobahn?
**Hauptdatei:** [src/01_Strassennetz.ts](src/01_Strassennetz.ts).
Hier wird der Katalog aller simulierten Fahrwege aufgebaut. Vollständige Straßengeometrie und Rampen werden über `src/geodata.ts` (A3/A48) und `src/network-extensions.ts` (Erweiterungen) geladen. Die Ursprungsdaten liegen in `data/`, die Rechen-/Import-Skripte in `scripts/`. Die Hauptdatei exportiert auch die Netzdatensätze, sodass du einen gemeinsamen Zugriffspunkt hast.

**Neue Autobahn hinzufügen:** Beide Richtungen und alle realen Rampen als gerichtetes Netz importieren, anschließend Anschlussstellen und Verbindungen testen. Nicht nur einen Namen oder eine gerade Linie einfügen.

## 2. Verkehr – wie viele Fahrzeuge kommen wann?
**Hauptdatei:** [src/02_Verkehr.ts](src/02_Verkehr.ts).
- `REFERENCE_PEAKS` = angenommener Spitzen-Zufluss pro Fahrweg (Kfz/h).
- `weekday`, `saturday`, `sunday` = zeitabhängige Faktoren.
- `profileFamily` = welche Tageskurve gilt für welchen Fahrweg?
- `profileFactor` = Berechnung des Faktors zur aktuellen Simulationszeit.
- Örtliche Auf-/Abfahrten: `src/regional-traffic.ts`, `src/junction-traffic.ts`.

**Beispiel:** Den Berufsverkehr auf der A48 ändern, ohne die Fahrstreifenanzahl zu manipulieren. Verkehrsnachfrage und Kapazität sind verschiedene Größen.

## 3. Stauphysik – warum staut es sich?
**Hauptdatei:** [src/03_Stauphysik.ts](src/03_Stauphysik.ts).
Hier liegen allgemeine Annahmen zu Fahrstreifenkapazität, Dichte, Geschwindigkeit und Farbstufen. Wichtigste Hilfsmodule: `src/traffic-cells.ts` für Zell- und Fahrzeugbestände, `src/spatial.ts` für Lage und Rückstauwellen, `src/network-receiving.ts` für den gemeinsamen Zufluss an Einmündungen.

**Wichtig:** Eine rot gezeichnete Rampe ohne tatsächlich wartende Fahrzeuge ist ein Darstellungsfehler, kein Stau.

## 4. Ereignisse – was passiert bei Unfall und Vollsperrung?
**Hauptdatei:** [src/04_Ereignisse.ts](src/04_Ereignisse.ts).
Hilfsmodule: `src/closure-network.ts`, `src/road-controls.ts`, `src/recurring-events.ts`. Gesperrte Teile müssen für neuen Verkehr unerreichbar sein; vorhandene Fahrzeuge dürfen nicht einfach gelöscht werden.

## 5. Umleitungen – wohin kann der Verkehr ausweichen?
**Hauptdatei:** [src/05_Umleitungen.ts](src/05_Umleitungen.ts).
Diese Datei entscheidet, ob ein Ausweichweg sinnvoll ist. Die tatsächlichen Fahrwege und Verknüpfungen werden unter anderem von `src/detour-routing.ts`, `src/auto-diversions.ts`, `src/extension-detours.ts` bestimmt. Nur reale, gerichtete und befahrbare Rampen nutzen.

## 6. Karte – was wird angezeigt?
**Hauptdatei:** [src/06_Karte.ts](src/06_Karte.ts).
Kartengeometrien sind von der Verkehrssimulation getrennt. Für Stauausgabe: `src/traffic-view.ts`, für Symbole `src/map-callouts.ts`, für Auswahl/Gesten `src/selection.ts` und `src/map-gestures.ts`. Die gesamte Bedienoberfläche liegt weiterhin in `src/app.ts` und `index.html`.

## Was ist eine Weiterleitungsdatei?
Zum Beispiel enthält `src/traffic-profiles.ts` jetzt nur einen Import/Export auf `src/02_Verkehr.ts`. Dadurch bleibt der bisherige Programmcode kompatibel. **Immer die nummerierte Hauptdatei öffnen**, wenn du die entsprechenden Regeln ändern möchtest.

## Sicherer Ablauf
1. Erst eine konkrete Änderung festlegen (z. B. „A3 Richtung Köln, Freitag 16 Uhr, Ausfahrt läuft voll“).
2. Zuständigen Hauptbereich und ggf. Hilfsmodul finden.
3. Nur notwendige Werte/Funktionen bearbeiten.
4. `npm run check` ausführen und auch die Karte kontrollieren.
5. Erst danach in `main` übernehmen.

Bei fehlenden Rampen nicht einfach plausible Verbindungen erfinden: OSM-Quelle und gerichteten Netzgraph prüfen. Verkehrsprofile sind Modellannahmen, keine Live-Zählungen.