# Automatisch erzeugte Netzdaten

Diese Dateien bleiben zunächst in `src/`, weil bestehende Netzimporte, Generatoren und Tests genau diese Dateipfade benötigen:

- `geodata.ts`: Basisnetz samt gerichteten Straßengeometrien
- `network-extensions.ts`: erweiterte Autobahnstrecken und Rampen
- `extension-detours-data.ts`: generierte Umleitungsgeometrien
- `regional-detours.ts`: regionale Ausweichstrecken
- `ring-detours-data.ts`: ergänzende Kölner Ringverbindungen

Sie sind **nicht** unsortierter handgeschriebener Code, sondern generierte Datenbestände. Anpassungen werden in `data/` und den zugehörigen Skripten in `scripts/` vorbereitet. Nicht unüberlegt die riesigen JSON-/Koordinatenlisten umschreiben oder in die sechs Hauptdateien kopieren.

Der zentrale Straßennetz-Katalog in `src/01_Strassennetz.ts` bietet direkten Zugriff auf die Netzdaten. Die Verbindungen/Umleitungen werden unter `05_Umleitungen/` verarbeitet.
