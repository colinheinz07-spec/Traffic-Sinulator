# A3/A48 Stausimulator – Kartenfundament 0.3

**Ein Repository, eine Startdatei:** `index.html` im Hauptverzeichnis direkt in SPCK öffnen. Keine Cloudflare-Konfiguration und keine externe Kartenbibliothek.

## Prüfbare Streckenabdeckung

- A3 **AS Limburg-Süd (43) ↔ AS Limburg-Nord (42) ↔ AS Diez (41) ↔ AS Bad Honnef/Linz (34)** – beide Richtungsfahrbahnen
- A48 **AK Koblenz / A61 (9) ↔ AD Dernbach (13)** – beide Richtungsfahrbahnen
- Sämtliche **15 nummerierten Anschlussstellen/Knotenpunkte** in diesem Netz
- **Vier eigenständig auswählbare Verbindungsrampen** am AD Dernbach
- Über 324 als A3/A48 gekennzeichnete OSM-Straßenstücke, mit geografischen Originalkurven. Datenstand: 18.10.2026.

Die ursprünglich berechneten Abdeckungswerte gelten nur für den alten Korridor bis Diez. Die Erweiterung über Limburg-Nord bis Limburg-Süd wird separat anhand realer OSM-Ways und Junction-Nodes geprüft. Die neue Kartenübersicht zeigt stattdessen Fahrbahnkilometer pro Richtung. Keine Live-Verkehrsdaten.

## Technische Priorität

Die erste Version ist **absichtlich ausschließlich eine Karte** – kein künstlich nachgebildeter Verkehrsfluss und noch keine Ereignis-/Sperrungsfunktion. Straßen und Rampen sind auf der Karte antippbar und liefern die Auswahlkoordinaten; daraus wird später die Ereignisposition. Beide Fahrtrichtungen sind als echte OSM-Teilstücke gezeichnet, nicht als gerade Linien zwischen Anschlussstellen. Die Straßengeometrie ist im kompilierten `geodata.js` enthalten; sie funktioniert ohne laufenden API-Datenabruf. Hintergrundkacheln verwenden OpenStreetMap online, ohne sie bleibt die Straßenzeichnung erhalten.

## Entwicklung

Quellcode TypeScript (`src/`), in SPCK ausführbares JavaScript im Repository-Hauptverzeichnis. `npm run check` prüft Typen, statische OSM-Daten und Karte. Bei Änderungen nur nach grüner GitHub Actions CI auf `main` übernehmen. Die Karte muss zusätzlich auf echten Mobilgeräten überprüft werden, bevor eine Freigabe als produktiv erfolgt.

Straßenverläufe: © OpenStreetMap-Mitwirkende, ODbL, https://www.openstreetmap.org/copyright. Ausgangsmaterial: öffentlich verfügbare OSM-Fahrbahndaten, exportiert und überprüft am 18.10.2026. Keine Live-Verkehrsdaten.

## Karten-Feinschliff 0.3

- OSM-Fahrbahnstücke werden bei identischen OSM-Endknoten zu durchgehenden Zeichenlinien verbunden. Keine zusätzlichen kartografischen Routen zwischen nicht verbundenen Straßen.
- Zoomabhängige dünnere A3-/A48-Farbstriche und Rampen, damit Richtungsfahrbahnen auf dem Smartphone sichtbar bleiben.
- AD Dernbach: die vier realen Rampen erhalten bei hoher Zoomstufe nummerierte Auswahlmarker, die direkt zur entsprechenden Rampe führen.
- Anschlussstellenlabels werden ohne gegenseitige Überlagerung platziert; kein Label ersetzt die eigentliche geografische Position.
- Zeichnung auf Anforderung (statt dauerhaftem 60-FPS-Loop), um die Karte auf Mobilgeräten effizienter zu halten.
- Kartenelemente und Navigation bleiben im einzigen Hauptverzeichnis. Keine Verkehrs-/Ereignislogik hinzugefügt.

## Durchgehende Fahrbahngeometrie (0.4)

Die vorhandene OSM-Datei enthielt trotz der Verbindung identischer Way-Endpunkte
kleine echte Lücken zwischen benachbarten Autobahn-Teilstücken. Das Script
`scripts/fill_motorway_gaps.py` lädt zur Reparatur echte, als Autobahn A3/A48
klassifizierte OSM-Ways und übernimmt **nur** Wege, die über ihre tatsächlichen
OSM-Endpunkte zwei bisher getrennte Komponenten derselben Richtungsfahrbahn
verbinden. Es erzeugt keine künstlichen Geraden durch Orte.

`audit.gapRepair` im Datensatz dokumentiert pro Richtung die Zahl offener
Endpunkte vor und nach dem Import. Restlücken werden offen und überprüfbar
ausgewiesen; ein grüner CI-Test bedeutet nicht automatisch 100 % nahtlose
Kartengrafik auf jedem Mobilgerät.

## Fahrstreifen-Audit 0.5 (OSM 18.10.2026)

Die 528 gespeicherten A3/A48-Hauptfahrbahnstücke wurden anhand ihrer **aktuellen OSM-Weg-Tags** abgeglichen. 523 Quellen stimmen mit dem vorliegenden Fahrstreifenwert überein; fünf frühere OSM-Way-IDs bei Koblenz-Nord waren nicht mehr abrufbar und bleiben als **ungeprüfte Altangaben** markiert.

WICHTIG: Am Autobahndreieck Dernbach ist die Fahrstreifenanzahl **pro motorway_link-Weg** gespeichert, statt jede komplette Rampe pauschal einspurig zu nennen:

- A3 → A48 aus Richtung Frankfurt: zwei Fahrstreifen, alle sieben OSM-Teilstücke.
- A48 → A3 Köln: ein bis zwei Fahrstreifen, abhängig vom genauen Teilstück.
- A3 → A48 aus Richtung Köln: ein bis zwei Fahrstreifen, abhängig vom genauen Teilstück.
- A48 → A3 Frankfurt: ein bis zwei Fahrstreifen, abhängig vom genauen Teilstück.

Wenn auf die Karte getippt wird, ermittelt die App den nächsten **echten** OSM-Weg innerhalb der betreffenden Überleitung und zeigt dessen Spuranzahl mit Quellweg-ID. Wo die Geometrie nicht eindeutig zugeordnet werden kann, ist die Anzahl explizit als ungeklärt markiert. Dies ist ein OSM-Datenaudit und keine 2026-Vor-Ort-Vermessung; Bauphasen und vorübergehende Markierungen sind damit nicht vollständig erfasst.
