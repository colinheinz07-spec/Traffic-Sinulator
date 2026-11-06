# Verkehr

**Was hier hineingehört:** Tagesprofile, Stundenwerte, Zufluss, regionale Verkehrsnachfrage.

**Zentrale Hauptdatei:** [../02_Verkehr.ts](../02_Verkehr.ts).

**Tatsächlich einsortierte Fachmodule:** `calendar-traffic.ts`, `junction-traffic.ts`, `regional-traffic.ts`, `traffic.ts`.

**Praxisregel:** Werte zur Verkehrsnachfrage in 02_Verkehr.ts ändern. Kapazitäten gehören zur Stauphysik.

**Warum liegen die früheren Dateinamen noch in `src/`?** Die alten Dateien sind nur kurze Weiterleitungen. Bestehende Imports und die bisherigen Tests funktionieren deshalb weiter. Für Änderungen öffne die Dateien in **diesem Ordner**, nicht die Weiterleitungen.

Die aufwendigen, automatisch generierten Geometriedaten bleiben bewusst separat, siehe [Daten-Anleitung](../GENERIERTE_DATEN.md).
