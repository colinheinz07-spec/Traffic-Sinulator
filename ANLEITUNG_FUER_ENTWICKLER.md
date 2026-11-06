# 📘 Stausimulator – deine Entwickler-Anleitung

## Die sechs Abteilungen
1. **[Straßennetz](src/01_Strassennetz/)**: Strecken, Autobahnen, Richtungen, Fahrstreifen, Ausfahrten und Rampen. Der zentrale Katalog steht in `src/01_Strassennetz.ts`. Die riesigen Geometrien werden automatisch aus OSM-Quellen erzeugt.
2. **[Verkehr](src/02_Verkehr/)**: Nachfrage pro Fahrweg und Uhrzeit. In `src/02_Verkehr.ts` stehen `REFERENCE_PEAKS` und die Wochentagsprofile. `src/02_Verkehr/regional-traffic.ts` berechnet zusätzliche regionale Auf-/Abfahrtsströme.
3. **[Stauphysik](src/03_Stauphysik/)**: Stauentwicklung, Zellmodell, Aufnahmekapazität an Einmündungen, Geschwindigkeiten. `src/03_Stauphysik/traffic-cells.ts` ist das Zellmodell.
4. **[Ereignisse](src/04_Ereignisse/)**: Unfall, Baustelle, Vollsperrung und wiederkehrende Ereignisse. Eingriffe in belegte Fahrstreifen müssen auch den Rückstau beeinflussen.
5. **[Umleitungen](src/05_Umleitungen/)**: Routing, Rampenbelastung und Umleitungsvorschläge. Beispielsweise `src/05_Umleitungen/detour-routing.ts`.
6. **[Karte & Anzeige](src/06_Karte/)**: Farben, Meldungen, Kartengeometrien und Bedienung. `src/06_Karte/traffic-view.ts` bereitet das berechnete Verkehrsgeschehen für die Anzeige auf.

## Warum sehe ich einige Dateien zweimal?

Wenn du `src/traffic-cells.ts` öffnest, siehst du nur eine Weiterleitung zur **eigentlichen Datei** `src/03_Stauphysik/traffic-cells.ts`. Die alte Adresse wurde bewusst nicht gelöscht: Sonst könnten ältere Importe und Tests abbrechen. Die Weiterleitungen enthalten **keine zweite Kopie der Logik**.

## Diese Dateien sollst du NICHT direkt bearbeiten

Die großen Datenmodule `src/geodata.ts`, `src/network-extensions.ts`, `src/extension-detours-data.ts`, `src/regional-detours.ts` und `src/ring-detours-data.ts` werden aus Geo-Daten generiert. Dazu gibt es [eine gesonderte Erklärung](src/GENERIERTE_DATEN.md).

## Beispiele
- **Freitag 16 Uhr zu wenige Fahrzeuge auf der A3?** `src/02_Verkehr.ts` und `src/02_Verkehr/regional-traffic.ts`.
- **Rückstau aus A59 auf A3 fehlt?** `src/03_Stauphysik/network-receiving.ts` und `src/03_Stauphysik/interchange.ts`; danach Umleitungsmodell prüfen.
- **Vollsperrung blockiert falsche Ausfahrt?** `src/04_Ereignisse/closure-network.ts` und `src/04_Ereignisse/road-controls.ts`.
- **Eine Überleitung fehlt?** Datenquelle/Geometrie und `src/01_Strassennetz/` prüfen.
- **Karte färbt grün mit rotem Strich?** `src/06_Karte/traffic-view.ts` und `src/06_Karte/README.md`.

## Bevor eine Änderung veröffentlicht wird
1. Die richtige Abteilung auswählen.
2. Nur das betroffene Modul bearbeiten; keine Rampen erfinden oder Fahrzeuge löschen.
3. `npm run check` ausführen.
4. Bei Netzänderungen außerdem die Python-OSM-Tests und tatsächliche Streckenfälle testen.
5. Änderung nach erfolgreicher Prüfung in `main` übernehmen.

**SPCK/iPhone:** Die TypeScript-Dateien sind die Quellen. `scripts/build.mjs` veröffentlicht daraus zusammenhängende JavaScript-Dateien in Unterordnern. Bearbeite nicht die generierten JS-Dateien.
