# Universelle Autobahn-Engine – Migrationsplan

Die Stauphysik soll nicht mehr auf einzelne Autobahnnummern zugeschnitten werden. Strecken sind Daten, Berechnung und Darstellung sind allgemeine Funktionen.

## Bereits umgesetzt in diesem Entwicklungszweig

- `network-catalog.ts` vereinheitlicht bestehende A3/A48-Fahrbahnen und Rampen sowie sämtliche generierten Erweiterungsfahrwege. Autobahnnummern, Richtungseinträge, Basisfahrstreifen, Geschwindigkeiten und Verkehrsannahmen stammen aus Metadaten.
- `traffic.ts`, `traffic-physics.ts`, `network-road.ts` und `network-presentation.ts` lesen dieses Verzeichnis statt paralleler fest verdrahteter Autobahnlisten.
- `network-topology.ts` ermittelt gemeinsame OSM-Punkte über einen räumlichen Index. `extension-connections.ts` und `network-receiving.ts` erkennen Querverbindungen damit unabhängig von einzelnen Autobahnnummern.
- Neue Autobahnen gelangen durch den bestehenden Generator der `ExtensionRoute`-Daten in die Registry. Keine per-Autobahn-Sonderzweige in den genannten Modulen erforderlich.
- Bestehende kalibrierte A3/A48-Nachfrage ist als **Datensatz** erhalten. Keine erfundenen Verkehrsbelastungen aus Fahrstreifenanzahl.

## Voraussetzungen für den deutschlandweiten Ausbau

1. Jede neue Autobahn benötigt gerichtete OSM-Linien mit durchgehender Topologie, realen Fahrstreifen und Kreuzungsverbindungen. Aus Kartendaten allein entstehen keine belastbaren Verkehrszählungen.
2. Auffahrts-/Abfahrtsknoten, lokale Ausfahrten und OD-Verteilung müssen einen einheitlichen Importvertrag erhalten; bestehende Spezialrouten bleiben bis dahin funktionsfähig.
3. Bei einem vollständigen Bundesnetz müssen räumlich getrennte Kacheln oder Simulationsregionen eingesetzt werden, um CPU- und Speicherverbrauch auf Mobilgeräten zu begrenzen.
4. Alte gespeicherte Ereignisse müssen beim Migrationsschritt stabile Fahrweg-IDs behalten oder gezielt migriert werden.
5. Erst dann werden neue Autobahnen freigeschaltet. Unvollständige Rampen dürfen nicht automatisch als reale Verbindungen ausgegeben werden.

## Regressionsprüfungen

`npm run check` (TypeScript-Build und alle Node-Tests) muss bestehen. Die neue `generic-network-catalog.test.mjs` kontrolliert Metadaten, Kapazitäten, Bestandserhalt und beliebige Autobahnnummern.

**Hinweis:** Dieser Commit ist die grundlegende Entkopplung der Kernmodule, noch keine vollständige Deutschlandkarte.