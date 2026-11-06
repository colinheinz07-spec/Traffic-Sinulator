# Verkehr

**Was hier hineingehört:** Tagesprofile, Stundenwerte, Zufluss, regionale Verkehrsnachfrage.

**Zentrale Hauptdatei:** [../02_Verkehr.ts](../02_Verkehr.ts).

**Tatsächlich einsortierte Fachmodule:** `calendar-traffic.ts`, `junction-traffic.ts`, `regional-traffic.ts`, `traffic.ts`.

**Praxisregel:** Werte zur Verkehrsnachfrage in 02_Verkehr.ts ändern. Kapazitäten gehören zur Stauphysik.

**Warum liegen die früheren Dateinamen noch in `src/`?** Die alten Dateien sind nur kurze Weiterleitungen. Bestehende Imports und die bisherigen Tests funktionieren deshalb weiter. Für Änderungen öffne die Dateien in **diesem Ordner**, nicht die Weiterleitungen.

Die aufwendigen, automatisch generierten Geometriedaten bleiben bewusst separat, siehe [Daten-Anleitung](../GENERIERTE_DATEN.md).

## Neu: Eigenes Freitagsprofil und Vorschau

In [../02_Verkehr.ts](../02_Verkehr.ts) sind sechs **Freitagskurven** (`friday`) getrennt von den Werktagskurven (`weekday`) hinterlegt. Für Freitag liegt die modellierte Nachmittagsspitze je nach Streckenfamilie etwa zwischen **13 und 15 Uhr** statt hauptsächlich zwischen 16 und 17 Uhr. **Es handelt sich um Modellannahmen, nicht um automatische Zählstellendaten.**

### Bedienung in der App auf dem iPhone
1. Im Abschnitt **Verkehrsfluss** die Fahrtrichtung auswählen.
2. **„📊 Verkehrsprofil ansehen und anpassen“** öffnen.
3. Zwischen Mo–Do, Freitag, Samstag und Sonntag wechseln.
4. Mit dem Stundenregler den erwarteten Zufluss zur gewählten Uhrzeit betrachten.
5. Den Referenzzufluss der gewählten Richtung mit dem Mengenregler einstellen. Beim Loslassen wird die tatsächliche Simulation aktualisiert.
6. **„Diesen Tag simulieren“** übernehmen, um Datum und Uhrzeit mit einem Klick zu setzen. Dabei werden die bisher vorhandenen Rückstaus zurückgesetzt.

Die Grafik [verkehrsprofil-editor.ts](verkehrsprofil-editor.ts) verwendet dieselbe Rechenfunktion `profileFactor()` wie die Simulation. Eine Vorschau allein verändert die Simulation nicht. In den Testmodi `constant` und `wave` gelten bewusst andere Zuflussregeln.

Nach dem Aktualisieren kann man weiterhin den genauen Zufluss über das Zahlenfeld `traffic-inflow` einstellen. Die Standardwerte werden beim Neuladen der App derzeit wiederhergestellt (keine dauerhafte Speicherung der individuellen Referenzwerte).
