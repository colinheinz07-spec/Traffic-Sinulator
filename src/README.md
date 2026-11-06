# 🚗 Wo finde ich welche Datei?

**Du möchtest die App selbst bearbeiten? Öffne einen der sechs farblich/nummeriert benannten Ordner und lies dort die README-Datei.**

| Was du verändern willst | Öffne |
| --- | --- |
| 🛣️ Strecken, Rampen, Anschlussstellen | [01_Strassennetz/](01_Strassennetz/) |
| 🚘 Verkehrsaufkommen, Uhrzeiten | [02_Verkehr/](02_Verkehr/) |
| 📈 Stauphysik, Rückstaus | [03_Stauphysik/](03_Stauphysik/) |
| 🚧 Unfälle, Baustellen, Sperrungen | [04_Ereignisse/](04_Ereignisse/) |
| ↪️ Ausweichrouten und Umleitungen | [05_Umleitungen/](05_Umleitungen/) |
| 🗺️ Karte, Staufarben, Bedienung | [06_Karte/](06_Karte/) |

Die sechs gleichnamigen Dateien `01_Strassennetz.ts` bis `06_Karte.ts` direkt hier sind die **zentralen Hauptdateien**. Die anderen kurzen `.ts`-Dateien in diesem Verzeichnis sind nur **Weiterleitungen** (für alte Imports), nicht zusätzliche Kopien.

**Ausnahmen:** `app.ts` startet die gesamte Benutzeroberfläche. Fünf besonders große Dateien mit Netzgeometrien sind automatisch generiert; siehe [GENERIERTE_DATEN.md](GENERIERTE_DATEN.md). Andere Module sollen hier nicht mehr von Hand neu angelegt werden.

Eine ausführliche Übersicht steht auch in der [Anleitung im Hauptverzeichnis](../ANLEITUNG_FUER_ENTWICKLER.md).
