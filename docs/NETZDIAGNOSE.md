# 🛣️ Straßennetz-Diagnose: So findest du fehlende Rampenzuordnungen

Die App prüft jetzt beim Öffnen der **Straßennetz-Diagnose** die unter *Verkehrsfluss* gewählte Fahrtrichtung.

Sie vergleicht dabei drei **tatsächlich vorhandene Datenquellen**:

1. Den gerichteten OSM-Fahrweg aus `makeCorridors()`.
2. Die zugehörigen real importierten Anschlussstellen aus `diversionJunctions()`.
3. Die physisch hinterlegten Rampensegmente aus `junctionRampBindings()` und die exakten Hauptbahn-Verbindungen aus `buildExtensionConnections()`.

Die Anzeige unterscheidet **zugeordnet**, **laut Daten nicht vorhanden** (Teilanschluss) und **Zuordnung prüfen**.

**Wichtig:** Eine offene Prüfstelle ist kein Beweis, dass eine Rampe in Wirklichkeit fehlt. Manche vorhandenen OSM-Rampen sind nur noch nicht an den örtlichen Simulationsknoten gebunden. AK/AD sind nicht normale Abfahrten – ihre Autobahn-Überleitungen haben eine eigene Verkehrslösung.

### Wie du damit arbeitest
- In der App unter **Verkehrsfluss** z. B. „A3 Richtung Köln“ auswählen.
- **🛣️ Straßennetz-Diagnose** öffnen.
- Bei einer auffälligen AS auf **Rampen-IDs** tippen und die konkreten OSM-Strecken prüfen.
- Fehlende oder unvollständige Geometrie später nur anhand tatsächlich verifizierter OSM-Quellen in `data/` und den Import-Skripten ergänzen.

### Grenzen
- Die Prüfung ist **rein diagnostisch und lesend**: keine Änderung an Fahrtrichtung, Fahrstreifen, Netzgraph, Stau oder Fahrzeugbestand.
- Sie zählt Verknüpfungen des bereits importierten Netzes, aber kann nicht beweisen, dass in der realen Welt jede vorhandene Rampe importiert wurde.
- Für die komplette Nachvollziehbarkeit braucht man zusätzlich einen Außenabgleich mit einer aktuellen amtlichen/OSM-Quelle und eine Prüfung aller Autobahnkreuze in beiden Richtungen.
- Bestehende Tests für Strecken-Ereignisse, Lanes, Topologie, Rampenstau und Fahrzeugbilanz bleiben erhalten.

**Quellcode:** `src/01_Strassennetz/netzdiagnose.ts` (Prüfregeln) und `src/01_Strassennetz/netzdiagnose-anzeige.ts` (nur Anzeige).
