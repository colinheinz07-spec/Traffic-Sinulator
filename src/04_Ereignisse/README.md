# Ereignisse

**Was hier hineingehört:** Sperrungen, Baustellen, Unfall- und Anschlussstellenregeln.

**Zentrale Hauptdatei:** [../04_Ereignisse.ts](../04_Ereignisse.ts).

**Tatsächlich einsortierte Fachmodule:** `closure-network.ts`, `recurring-events.ts`, `road-controls.ts`.

**Praxisregel:** Sperrungen betreffen gerichtete Abschnitte. Fahrzeuge im Netz bleiben bilanziert.

**Warum liegen die früheren Dateinamen noch in `src/`?** Die alten Dateien sind nur kurze Weiterleitungen. Bestehende Imports und die bisherigen Tests funktionieren deshalb weiter. Für Änderungen öffne die Dateien in **diesem Ordner**, nicht die Weiterleitungen.

Die aufwendigen, automatisch generierten Geometriedaten bleiben bewusst separat, siehe [Daten-Anleitung](../GENERIERTE_DATEN.md).
