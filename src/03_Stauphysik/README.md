# Stauphysik

**Was hier hineingehört:** Zellmodell, Dichte, Rückstaus, Geschwindigkeit und Einmündungen.

**Zentrale Hauptdatei:** [../03_Stauphysik.ts](../03_Stauphysik.ts).

**Tatsächlich einsortierte Fachmodule:** `interchange.ts`, `network-receiving.ts`, `spatial.ts`, `speed-delay.ts`, `traffic-cells.ts`.

**Praxisregel:** Keine Fahrzeuge erzeugen oder löschen; Farben müssen reale modellierte Geschwindigkeiten abbilden.

**Warum liegen die früheren Dateinamen noch in `src/`?** Die alten Dateien sind nur kurze Weiterleitungen. Bestehende Imports und die bisherigen Tests funktionieren deshalb weiter. Für Änderungen öffne die Dateien in **diesem Ordner**, nicht die Weiterleitungen.

Die aufwendigen, automatisch generierten Geometriedaten bleiben bewusst separat, siehe [Daten-Anleitung](../GENERIERTE_DATEN.md).
