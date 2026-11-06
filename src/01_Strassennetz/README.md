# Straßennetz

**Was hier hineingehört:** Autobahnen, Fahrtrichtungen, Anschlussstellen, Rampen und Fahrstreifen.

**Zentrale Hauptdatei:** [../01_Strassennetz.ts](../01_Strassennetz.ts).

**Tatsächlich einsortierte Fachmodule:** `core.ts`, `extension-connections.ts`, `junction-movements.ts`, `junction-ramp-bindings.ts`, `lane-info.ts`, `lane-profiles.ts`, `network-road.ts`, `network-topology.ts`, `normal-lanes.ts`, `physical-paths.ts`, `siegburg-context.ts`.

**Praxisregel:** Neue reale Straßen und Rampen zuerst mit OSM-Quelldaten importieren, anschließend Netztests ausführen.

**Warum liegen die früheren Dateinamen noch in `src/`?** Die alten Dateien sind nur kurze Weiterleitungen. Bestehende Imports und die bisherigen Tests funktionieren deshalb weiter. Für Änderungen öffne die Dateien in **diesem Ordner**, nicht die Weiterleitungen.

Die aufwendigen, automatisch generierten Geometriedaten bleiben bewusst separat, siehe [Daten-Anleitung](../GENERIERTE_DATEN.md).

## Neu: Netzdiagnose

In der App unter **🛣️ Straßennetz-Diagnose** werden die lokalen Ein-/Ausfahrts-Rampenzuordnungen einer gewählten Fahrtrichtung anhand der real importierten Geometrie kontrolliert. Der Prüfkern liegt in [netzdiagnose.ts](netzdiagnose.ts), die UI in [netzdiagnose-anzeige.ts](netzdiagnose-anzeige.ts). Alle offenen Zuordnungen werden transparent gemeldet statt stillschweigend als vollständig bezeichnet. [Dokumentation](../../docs/NETZDIAGNOSE.md).
