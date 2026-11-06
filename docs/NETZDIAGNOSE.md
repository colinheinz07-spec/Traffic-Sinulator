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

## Gezielter OSM-Abgleich – A565, Anschluss Bonn-Beuel-Nord (AS 2)

Beim Vergleich der geladenen OSM-Weggeometrien mit der Rampenbindung zeigte sich eine echte Zuordnungslücke:

- Der gerichtete OSM-Anschlussstellenknoten der **A565 Richtung Siegburg** liegt exakt am Beginn des vorhandenen Rampenstücks `extra-bonn-ramp-4394292`.
- Sein Weg gehört laut Generator-Zonenbezeichnung zum benachbarten **AD Bonn-Nordost**; die vorherige Regel hat darum *alle* solchen Rampen pauschal von der lokalen Anschlussstellenverknüpfung ausgeschlossen.
- Die nachfolgenden Rampenstücke schließen an weitere exakt verzeichnete OSM-Knoten an und erreichen eine im vorhandenen Datensatz bekannte Straßenanbindung.
- Die Bindungsregel erlaubt deshalb einen zuvor als AD bezeichneten Rampen-*Seed* nur dann, wenn sein Anfang exakt der **gerichtete, importierte AS-Knoten** ist und die bestehende Topologie anschließend tatsächlich eine Verbindung zur örtlichen Straße findet.
- Straßen, OSM-Koordinaten, Fahrstreifen und Zuflusswerte sind dadurch **nicht erfunden oder verändert**.

**Nicht automatisch geheilt:** Andere Stellen, die im Audit mit „Zuordnung prüfen“ erscheinen – beispielsweise A3 Diez/Neuwied, A4 Köln-Poll, A555 Rodenkirchen oder weitere A565-Verbindungen – brauchen einen eigenen geprüften OSM-Pfad. Manche führen im gespeicherten Netz bisher nur auf eine andere Autobahnfahrbahn zurück oder enden am Ausschnitt. Eine automatische Zuweisung aufgrund bloßer Nähe wäre verkehrstechnisch falsch.

Der Abgleich bezieht sich auf die im Repository gespeicherten OSM-Snapshots (Basisdatensatz Oktober 2026), nicht auf eine unbestätigte Live-OSM-Abfrage. Vor einer Veröffentlichung als realweltlich vollständiges Netz wäre ein neuer OSM-Import mit Abgleich aller Richtungsknoten erforderlich.
