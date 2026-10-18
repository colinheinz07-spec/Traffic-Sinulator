# A3/A48 Stausimulator – Kartenfundament 0.2

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
