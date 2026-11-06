# Straßennetz

**Was hier hineingehört:** Autobahnen, Fahrtrichtungen, Anschlussstellen, Rampen und Fahrstreifen.

**Zentrale Hauptdatei:** [../01_Strassennetz.ts](../01_Strassennetz.ts).

**Tatsächlich einsortierte Fachmodule:** `core.ts`, `extension-connections.ts`, `junction-movements.ts`, `junction-ramp-bindings.ts`, `lane-info.ts`, `lane-profiles.ts`, `network-road.ts`, `network-topology.ts`, `normal-lanes.ts`, `physical-paths.ts`, `siegburg-context.ts`.

**Praxisregel:** Neue reale Straßen und Rampen zuerst mit OSM-Quelldaten importieren, anschließend Netztests ausführen.

**Warum liegen die früheren Dateinamen noch in `src/`?** Die alten Dateien sind nur kurze Weiterleitungen. Bestehende Imports und die bisherigen Tests funktionieren deshalb weiter. Für Änderungen öffne die Dateien in **diesem Ordner**, nicht die Weiterleitungen.

Die aufwendigen, automatisch generierten Geometriedaten bleiben bewusst separat, siehe [Daten-Anleitung](../GENERIERTE_DATEN.md).

## Neu: Netzdiagnose

In der App unter **🛣️ Straßennetz-Diagnose** werden die lokalen Ein-/Ausfahrts-Rampenzuordnungen einer gewählten Fahrtrichtung anhand der real importierten Geometrie kontrolliert. Der Prüfkern liegt in [netzdiagnose.ts](netzdiagnose.ts), die UI in [netzdiagnose-anzeige.ts](netzdiagnose-anzeige.ts). Alle offenen Zuordnungen werden transparent gemeldet statt stillschweigend als vollständig bezeichnet. [Dokumentation](../../docs/NETZDIAGNOSE.md).

## Neu: OSM-Autobahnzugehörigkeit farblich prüfen

Mit dem Schalter **„Autobahnzugehörigkeit auf der Karte hervorheben“** kannst du im Simulator die Linien aus dem **tatsächlich importierten** Netz zusätzlich umrandet sehen. Dunkelblau kennzeichnet Autobahn-Hauptfahrbahnen, Hellblau Rampen und Überleitungen. Die normalen Verkehrsfarben (grün/orange/rot) bleiben unverändert.

Das Netzwerk-Modell ordnet den grundlegenden OSM-Klassen `highway=motorway` (Hauptfahrbahn) und `highway=motorway_link` (Autobahn-Zubringer/Verbindungsrampe) die generierten Fahrwegarten `motorway` und `ramp` zu. Bei gemischten, zusammengefassten Routen ist die Umrandung eine **Modellklassifizierung für den gesamten Fahrweg**, nicht der Nachweis der Klasse jedes einzelnen OSM-Segments.

**Wichtig:** Gleiche Farbe allein ist **kein** Nachweis einer tatsächlichen Verbindung, rechtlichen Widmung oder befahrbaren Fahrtrichtung. Erst die OSM-Knoten und der gerichtete Graph belegen eine Verbindung. Außerdem werden nicht jede `motorway_link`-Zufahrt (z. B. Rastplätze) automatisch als normale Anschlussstelle behandelt. Für fehlende, noch nicht importierte Rampen ist weiterhin der OSM-Vollständigkeitsabgleich erforderlich.
