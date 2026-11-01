# Traffic 1.20.0 – Stauoptimierung

Geltungsbereich: alle im Kartenfundament enthaltenen Fahrtrichtungen, Ein- und Ausfahrten sowie alle direkt geometrisch verifizierten Autobahn-Überleitungen.

- Der Kartenstatus basiert auf simulierten lokalen Fahrzeuggeschwindigkeiten und real vorhandenen Fahrzeugbeständen. Ein eingestelltes Tempolimit oder eine unbesetzte Sperrung erzeugt keinen dauerhaft roten Streifen.
- Die Rückstau-Länge berücksichtigt nur tatsächliche, farbig eingestufte Stauzellen und physisch gestauten Rampenbestand; keine künstliche Maximallänge und keine zusätzliche erfundene Rückstau-Fahrzeugmenge.
- Die CTM-Fahrzeugbewegung und die Stop-and-Go-Entladung bleiben unangetastet. Zeitlich echte Unterschiede zwischen orange, rot und dunkelrot werden nicht einfach übermalt.
- Die Verkehrsstatus-Anzeige deckt auch besetzte gesperrte Querschnitte mit geringem Fahrzeugbestand ab. Ein leeres Fahrbahnstück erzeugt keinen fiktiven Stau.
- Jede verifizierte, an beiden Enden mit dem Autobahnnetz verbundene Überleitungsrampe kann Rückstau aus einer tatsächlich überstauten Ziel-Fahrbahn übernehmen; lokale Anschlussstellen verwenden ihre bereits bestehende konservative Rampen-Fahrzeugbilanz.
- Anschlussstellen, die zu langes Warten haben, bleiben im lokalen CTM und färben nur reale Warteschlangen. Das Rückstauen auf die Autobahn entsteht aus tatsächlicher Kapazitätsüberlastung und belegten Autobahnzellen.

Modellgrenze: Die OSM-Geometrie des Netzes ist verbindlich. Ein graphisch nicht eindeutig angebundener Rampenabschnitt wird nicht auf eine erfundene Gegenrichtung gelegt. Die Verkehrsmengen sind weiterhin Simulationsannahmen, keine Live-Messungen. Die direkte Kopplung sämtlicher Mehrarm-Verteilerrampen als eigenständige Zielort-Fahrzeuge ist noch nicht vollständig.
