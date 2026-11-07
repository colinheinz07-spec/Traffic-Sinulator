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

## Fehlende OSM-Verbindungsrampen (November 2026)

Der Import ergänzt **136 bislang nicht als eigene Fahrwege im Simulator vorhandene, anhand gleicher OSM-Knoten angeschlossene `motorway_link`-Ways**. Bei sieben ausdrücklich als zweirichtungsfähig ausgewiesenen OSM-Wegen erzeugt er je Richtung einen Fahrweg auf derselben realen Mittellinie: zusammen **143 gerichtete Ergänzungen**.

- Im Raum **Siebengebirge**: u. a. OSM-Ways 407505963–407505966.
- Am **Kreuz Köln-Süd** und benachbarten AS: u. a. OSM-Ways 4400131/4400133/4400126/4400135.
- Am **Kreuz Bonn-Nord / A555–A565**: u. a. OSM-Ways 4356485/4356494/5939833/8016754.

Die generierten Daten liegen in [osm-zusatzrampen.ts](osm-zusatzrampen.ts). Das reproduzierbare Generatorskript ist `scripts/build_osm_additional_ramps.py`; nach einem erneuten vollständigen OSM-Import wird es im letzten Importschritt automatisch ausgeführt.

**Sichtbarkeit und Simulation:** Die zusätzlichen Wege gehören zum gleichen `extensionRoutes`-Katalog wie bisherige Rampen, erscheinen daher grün bei freier Fahrt, sind anklickbar, können Ereignisse tragen und werden durch die normalen Komponenten auf direkte Autobahnverbindungen und lokale Rampen-Ketten geprüft. Eine reine OSM-Verbindungsrampe erhält **keinen künstlichen eigenständigen Fahrzeugzufluss** (`demandVph=0`). Nur verifizierte Knoten-/Fahrbeziehungen bekommen Fahrzeugströme durch die bestehenden Modelle.

**Grenzen:** Nicht jeder OSM-Weg wurde eingefügt. Bewusst ausgeschlossen sind `access=no/private`, an Rastplätze gebundene Wege sowie nicht an das bereits modellierte Netz angeschlossene Wege. Der Hinweis auf der Hintergrundkarte allein beweist keine echte Knotenverbindung. Der Import verwendet gespeicherte OSM-Snapshots, keinen vollständigen Live-Abgleich. Nicht modellierte Fremdautobahnen und OSM-Wege mit abweichendem Zugang brauchen noch eigene Prüfungen. Auch durch einen verbundenen Way entsteht nicht automatisch ein durchgängig korrektes Routing über mehrere Rampen-Zweige; solche Fälle bleiben im Netzdiagnose-Audit zu prüfen.

## Ergänzung Idstein / Niedernhausen / Wiesbaden

Der gespeicherte OSM-Stand `data/a3-wiesbaden-osm.json` war beim Rampenimport bisher nicht enthalten. Das erweitert die Geometrie um **10 echte gerichtete `motorway_link`-Segmente**: Idstein (2), Niedernhausen (4) und Wiesbadener Kreuzungsbereiche (4). Die Linie endet weiterhin dort, wo OSM in eine Nicht-Autobahn-Straße übergeht. Kein erfundener Anschluss und kein zusätzlicher Fahrzeugzufluss.
