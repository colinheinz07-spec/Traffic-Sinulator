# Umleitungen

**Was hier hineingehört:** Wegenetz, Ausweichverkehr, Umleitungsentscheidung.

**Zentrale Hauptdatei:** [../05_Umleitungen.ts](../05_Umleitungen.ts).

**Tatsächlich einsortierte Fachmodule:** `auto-diversions.ts`, `bundled-detours.ts`, `detour-flow.ts`, `detour-routing.ts`, `diversions.ts`, `extension-detours.ts`, `interchange-journeys.ts`, `routed-traffic.ts`.

**Praxisregel:** Nur erreichbare gerichtete Wege verwenden; Kapazitäten aller Knoten begrenzen den Abfluss.

**Warum liegen die früheren Dateinamen noch in `src/`?** Die alten Dateien sind nur kurze Weiterleitungen. Bestehende Imports und die bisherigen Tests funktionieren deshalb weiter. Für Änderungen öffne die Dateien in **diesem Ordner**, nicht die Weiterleitungen.

Die aufwendigen, automatisch generierten Geometriedaten bleiben bewusst separat, siehe [Daten-Anleitung](../GENERIERTE_DATEN.md).
