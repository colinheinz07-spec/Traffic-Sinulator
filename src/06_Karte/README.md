# Karte und Anzeige

**Was hier hineingehört:** Stauanzeige, Kartengeometrien, Berichte, Benutzerbedienung.

**Zentrale Hauptdatei:** [../06_Karte.ts](../06_Karte.ts).

**Tatsächlich einsortierte Fachmodule:** `map-callouts.ts`, `map-geometry.ts`, `map-gestures.ts`, `network-presentation.ts`, `network-report.ts`, `schedule-form.ts`, `selection.ts`, `traffic-view.ts`.

**Praxisregel:** Die Karte zeigt die Ergebnisse der Simulation. Sie darf keine Fahrzeuge selbst berechnen.

**Warum liegen die früheren Dateinamen noch in `src/`?** Die alten Dateien sind nur kurze Weiterleitungen. Bestehende Imports und die bisherigen Tests funktionieren deshalb weiter. Für Änderungen öffne die Dateien in **diesem Ordner**, nicht die Weiterleitungen.

Die aufwendigen, automatisch generierten Geometriedaten bleiben bewusst separat, siehe [Daten-Anleitung](../GENERIERTE_DATEN.md).
