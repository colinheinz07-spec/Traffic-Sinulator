# A3/A48 Stausimulator – Stausimulation 1.0 (Punkt 4b)

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

## Punkt 2 – punktgenaue Auswahl (0.6)

- Ein Tipp auf eine A3-/A48-Fahrbahn oder eine AD-Dernbach-Rampe rastet ausschließlich auf dem vorhandenen OSM-Verlauf ein.
- Dicht nebeneinanderliegende Richtungsfahrbahnen werden **nicht** automatisch verwechselt: Sind mehrere Kandidaten innerhalb einer Fingertipp-Toleranz, erscheint eine explizite Fahrtrichtungs-Auswahl.
- Auswahl zeigt OSM-Koordinaten, Fahrtrichtung, dokumentierte Fahrstreifenanzahl mit Quellenhinweis und deren schematische Lage.
- Die nächstgelegene Anschlussstelle wird nach geografischer Entfernung ermittelt und ausdrücklich als **Luftlinie** gekennzeichnet. Sie ist keine Kilometerangabe entlang der Autobahn.
- Alle vier Rampen haben weiterhin eigene nummerierte Auswahlmarker und getrennte Fahrstreifenprofile.
- Keine Ereignisse oder Stauphysik in dieser Version; nur Kartenbedienung.

Die Geometrie- und Fahrstreifendaten wurden nicht umgebaut; nur ihre Auswahl/Anzeige wurde verbessert.


## Punkt 3b – Ereignisregeln 0.8

- Ereignisse sind lokal gespeicherte Simulationsparameter: **Länge**, **Vorbeifahrgeschwindigkeit/Tempolimit**, sperrbare **reguläre Fahrstreifen** sowie optional der **Standstreifen** (normal / temporär freigegeben / gesperrt). An den AD-Rampen wird kein zusätzlicher Standstreifen erfunden.
- Unfälle und Lkw-Pannen sind punktuelle Ereignisse mit einstellbarer Länge von **maximal 200 m**; Baustellen bis 20 km, Vollsperrungen bis 10 km. Angaben sind Simulationsabschnitte und noch keine gezogene Sperrstrecke auf der Karte.
- Geschwindigkeits**vorschläge** (keine gesetzlichen Verkehrsregeln) orientieren sich an der Restkapazität: bei einer offenen Spur 40 km/h, bei zwei offenen Spuren 60 km/h; der Nutzer kann sie ändern (10–130 km/h in 10er-Schritten). Bei null nutzbaren Spuren beträgt der vorläufige Durchfluss 0.
- Eine **Vollsperrung** ist ein eigener Ereignistyp. Die definierten Regeln für die **spätere** Verkehrsphysik: neue Fahrzeuge dürfen nicht in den gesperrten Abschnitt einfahren, nachfolgende Fahrzeuge sollen über gültige Ausfahrten/Routen umgeleitet werden, bereits im Abschnitt befindliche Fahrzeuge dürfen den Bereich verlassen. Unfälle mit allen Fahrstreifen betroffen sind keine formalen Vollsperrungen.
- Ereignisse können über ihren Kartenmarker oder Listeneintrag **bearbeitet** werden. Frühere Ereignisse aus Version 0.7 werden beim Laden auf Standardwerte migriert, statt verloren zu gehen.
- **Noch keine echte Fahrzeug- oder Stausimulation, keine ausgewiesenen offiziellen Umleitungsstrecken.** Speeds und Standstreifenfreigabe sind benutzerdefinierte Szenarien, keine Anweisungen für den realen Straßenverkehr.

## Punkt 4a – makroskopischer Verkehrsfluss (0.9)

- Acht logisch getrennte Fahrwege (beide A3- und A48-Richtungen und vier AD-Dernbach-Rampen). Eigener einstellbarer Zufluss pro Fahrweg und simulierte Minuten statt Fahrzeugsymbole.
- Kapazitätsengpässe aus vorhandenen Simulator-Ereignissen: verfügbare Fahrstreifen, Standstreifenfreigabe mit verringerter Kapazität, Tempolimit und einfädelbedingte Reibung.
- Fahrzeuge werden im rechnerischen Bestand bilanziert: Warteschlange vorher + Zufluss – Durchfluss = Warteschlange nachher. Nach Freigabe kann Rückstau kontinuierlich abgebaut werden.
- Vereinfachte geschätzte Rückstaulänge und Verzögerung; bei 0 Durchfluss wird keine künstlich endliche Wartezeit angezeigt. Vollsperrung bleibt vom Unfall mit allen Fahrspuren gesperrt unterschieden.
- **Noch nicht umgesetzt:** reale Zuflussdaten, verteilte Stauabschnitte auf tatsächlichen Geokoordinaten, Rückstauübertragung A3↔A48, automatische Abfahrten/Umleitungen, bereits innerhalb einer Vollsperrung befindliche Fahrzeuge, Kartenfärbung nach Simulationsabschnitten und dauerhafte Speicherung des Simulationszustands.
- Anfangszuflüsse und Kapazitäten sind bewusst **Simulationsannahmen**, keine amtlich bestätigten Durchschnittswerte. Keine echten Verkehrsmeldungen.


## Punkt 4b – geografische Staus auf A3, A48 und AD-Rampen (1.0)

- `src/spatial.ts`: Acht **kontinuierlich verknüpfte OSM-Fahrbahnkurven**, nach tatsächlicher Fahrtrichtung geordnet. Es werden keine Phantomstraßen, Ortsstraßen oder künstlichen Rampen erzeugt.
- Ausgewählte Ereignisse werden entlang des **richtigen Fahrwegschlüssels** auf die Geometrie projiziert. Der Rückstau wächst von der Eingriffsstelle **gegen die Fahrtrichtung**, nicht auf der anderen Richtungsfahrbahn.
- Die Simulationsschritte führen **für jedes Ereignis eine eigene Warteschlange** und leiten den jeweiligen Ausfluss zum nächsten Engpass desselben Fahrwegs weiter. Jede Staustelle kann separat mit einer beispielhaften Länge und rechnerischem Zeitverlust erscheinen.
- Kartenfarben **Grün frei / Orange stockend / Rot Stop-and-Go / Dunkelrot Stillstand**. Die eingefärbten Teilstrecken stammen aus den tatsächlichen OSM-Streckenpunkten. Nummerierte Rampenauswahl und Ereignismarker bleiben bedienbar.
- Nach Entfernen eines Engpasses wird der aufgelaufene Verkehr **nicht augenblicklich gelöscht**, sondern mit der normalen Kapazität abgebaut. Zurücksetzen setzt beide Verkehrsmodelle zurück.
- **Beschränkungen dieses Modellschritts:** Der Bereich „Alle acht Fahrwege“ benutzt weiterhin die aggregierte Engpassrechnung aus 0.9; die Einzelstaus verwenden das separate positionsbezogene Modell. Keine Stau-Rückwirkung zwischen zwei benachbarten Engpässen (Spillback), keine realen Reisezeiten zwischen Engpässen, keine automatische A3/A48-Übertragung, keine Umleitungslogik, keine fahrzeuggenaue Darstellung. Rückstau, der vor dem Rand der vorhandenen Strecke läge, wird nicht auf fiktive Straßen verlängert.
- Die Verkehrswerte sind **Annahmen für einen Simulator**, keine gemessenen Verkehrsströme oder belastbaren Vorhersagen. Die Geodaten und Fahrstreifenprofile bleiben unverändert.


## Punkt 4c.1 – AD Dernbach: geometrisch exakter Rampenrückstau (1.1)

- Verbindet alle vier echten OSM-Rampen **gerichtet** mit A3/A48. Beide Enden müssen auf dem korrekten Hauptfahrbahnverlauf liegen (25-m-Sicherheitsprüfung); sonst startet die App nicht mit geratenen Kreuzungen.
- Erst wenn die berechnete Fahrzeugwarteschlange bis zum **Anfang der Rampe** reicht, wird überschüssige Fahrzeugbelegung als Rückstau auf der zugehörigen **Zufahrtsfahrbahn** sichtbar (insbesondere A48 → A3 Köln auf die A48 Richtung Dernbach).
- Queue-Positionen werden an realen OSM-Geometrien eingefärbt; es werden **keine** Verbindungslinien, Ortsstraßen oder künstlichen Umleitungen gezeichnet.
- Die überlaufenden Fahrzeuge werden rechnerisch **nicht zusätzlich erzeugt**. Die Hauptfahrbahn-Überlagerung zeigt einen Teil der bereits in der Rampenwarteschlange gezählten Fahrzeuge.
- Noch **kein vollständiger Verkehrsaufteilungs- und Merge-Solver**: Die frei einstellbaren Rampenzuflüsse werden weiterhin unabhängig von den Hauptfahrbahnzuflüssen vorgegeben. Hauptfahrbahn-Nettokapazität, offizielle Umleitungen und die echte Verzweigungsbilanz sind Folgeschritte. Die übernommene Modell-Lagermenge (95 Fzg/km auf einer ausfädelnden Fahrspur) ist eine vereinfachende Annahme, keine Verkehrsprognose.
- Der +5-min-Testknopf bleibt vorerst bestehen; ein späterer Schritt ersetzt ihn durch automatische Zeitschaltung. Keine Fahrzeugvisualisierung.


## Punkt 4c – Engpass-Kapazität kalibrieren (1.1.1)

Bei einer dreistreifigen A3 mit zwei gesperrten Spuren, 40 km/h und 4.200 Fzg/h
war die vorläufige Kapazität nur 916 Fzg/h. Nach 15 Modellminuten wurden
2,88 km Rückstau und ungefähr 54 Minuten Zeitverlust angezeigt. Ursache war,
dass die Geschwindigkeit den Durchfluss zu stark reduzierte und danach
zusätzlich ein kräftiger Einfädelungsabschlag angewandt wurde.

Das überarbeitete *Szenariomodell* verwendet bei 40 km/h eine moderatere
Kapazitätsminderung, darunter (10–30 km/h) eine stärkere Drosselung.
Fahrstreifensperrungen und Einfädelungen bleiben relevant. Bei einer vollständigen
Blockade bleibt die Kapazität null, der Zeitverlust ist dann nicht seriös als
endliche Zahl berechenbar. Ankunftszahlen (Fzg/h) wurden **nicht** gesenkt,
damit kein Stau verdeckt wird. Die Schätzung wird **nicht** anhand realer Messwerte
kalibriert; bei anhaltendem Zufluss über Kapazität kann die Verzögerung weiter
wachsen. Das ist kein künstlicher Maximalwert und kein Versprechen einer
bestimmten Staudauer. Karte und AD-Dernbach-Verbindungen sind unverändert.


## 4c.2 – Stau von A3/A48 zurück in Überleitungen (1.2.0)

- Weiterhin Rückstau auf der Originalrampe und der korrekten zuführenden A3-/A48-Richtungsfahrbahn.
- Neu: Erreicht der Rückstau eines Engpasses **auf der Zielautobahn** die
  echte Einmündung einer Rampe, wird auch die Rampe von der Zusammenführung her
  blockiert. Bei großem Rückstau reicht die Markierung bis auf die Autobahn,
  von der die Rampe abzweigt. Beide Richtungen A3 ⇄ A48 sind berücksichtigt.
- Die projizierte Rampenlänge verwendet die Nachfrageanteile der beteiligten
  Zuläufe und deklarierte 95 Fzg/km/Fahrstreifen. Dies ist noch **keine**
  vollständige vernetzte Mikrosimulation/CTM-Mehrwegezuweisung: Vorläufige
  geografische Projektionen werden **nicht** zu den bereits berechneten
  Fahrzeugmengen oder Verzögerungen addiert. Keine falschen Doppelzählungen.
- Tests: sämtliche vier OSM-Rampen, Gegenrichtung bleibt unberührt, kein
  Rückstau bei Engpass vor der Einmündung, Freigabe wirkt ohne Restblockade.

## Version 1.3 – Numerische Rückstaus an A3/A48 und spurabhängige Durchlassfähigkeit

- Vollsperrungen auf einer Zielautobahn können nach Erreichen des AD-Merge-Knotens echte Rampen-Warteschlangen erzeugen; diese können wiederum numerisch auf der Quellautobahn Engpässe verursachen. Die färbende Karte und die Routen-Kennzahlen nutzen denselben räumlichen Zustand.
- Auf Quellautobahnen physisch stehende Rampenfahrzeuge werden als **geteilte Belegung** und nicht als zusätzliche erzeugte Fahrzeuge ausgewiesen. Routen-Fahrzeuganzeigen dürfen deshalb nicht über alle Wege summiert werden.
- Drei Fahrstreifen werden für die Simulation standardmäßig mit 45 % rechts, 34 % Mitte, 21 % links gewichtet; dies sind illustrative Annahmen und keine Verkehrszählungen. Die Wahl der gesperrten Fahrspur ändert den simulierten Spurwechselverlust.
- Vollsperrungen haben weiterhin keinen Durchfluss. Kein erfundener endlicher Zeitverlust bei vollständigem Stillstand. Ereignisse, OSM-Originalgeometrie und Gegenfahrbahnen bleiben unangetastet.
- Noch kein vollständig gekoppeltes, kalibriertes Verkehrs-OD-Routing: Die Zuflüsse je Fahrweg sind weiterhin unabhängige Simulations-Eingabewerte. Die dynamischen Bremswellen sind für einen späteren Ausbauschritt geplant.


## Dynamischer Zufluss 1.3.1

Standardmodus **Abklingende Stoßzeit**: Der eingestellte Startzufluss nimmt ab Minute 10 während der folgenden 90 Modellminuten anhand einer synthetischen Stoßzeitkurve von 100 % auf ca. 23 % ab. Dies ist **eine Szenarioannahme, keine reale Verkehrszählung**. Für jede Modellminute wird die neue ankommende Fahrzeugmenge verwendet. Stau kann wachsen, sich stabilisieren und wieder abnehmen, wenn der Zufluss unter die Engpasskapazität fällt.

Mit **Konstanter Zufluss (Dauertest)** kann eine dauerhaft überlastete Baustelle getestet werden. In diesem Fall ist weiterer Stau- und Verzögerungsaufbau physikalisch möglich. Es gibt absichtlich keine willkürliche feste Verzögerungsobergrenze. Keine Änderung der A3-/A48-OSM-Karte oder der Ereignisspeicherung.


## Version 1.4.0 – Datum, Uhrzeit und sehr langsamer Verkehr

- Startdatum und lokale Geräteuhrzeit können eingestellt werden. Das laufende Simulationsdatum ergibt sich aus Startzeit plus Modellminuten, auch über Mitternacht hinweg. Ein geänderter Startzeitpunkt setzt bestehende Rückstaus zurück, ein normaler Reset springt zur Startzeit zurück.
- Standardmodus: **synthetisches Verkehrsprofil nach Werktag, Samstag, Sonntag und Tageszeit** mit Morgen- und Abendspitzen sowie geringem Nachtverkehr. Der Spitzenstunden-Referenzwert kann für jeden Fahrweg eingestellt werden; leichte Richtungsfaktoren sind berücksichtigt. Keine realen Zähldaten, kein Feiertags-/Ferienmodell und keine Kalibrierung.
- Alte Modi **abklingende Stoßzeit** und **konstanter Zufluss** bleiben für Belastungstests erhalten.
- **Dunkelrot** bedeutet Stillstand **oder** modellierte Geschwindigkeit bis 10 km/h im Rückstau. Die Näherung verwendet Abflusskapazität geteilt durch die angenommene dichte Rückstaubelegung (95 Fahrzeuge je Kilometer und Fahrstreifen); keine gemessene Geschwindigkeit. Orange markiert Rückstauanfänge, Rot Stop-and-Go, Grün freie Abschnitte.
- Keine Änderung der OSM-Geometrie, gespeicherter Ereignisse oder A3/A48-Rampenverknüpfungen.


## 1.4.1 – Rampenverzögerung, Farbstabilität und Bedienung

- Eine dunkle Zielautobahn bedeutet nicht mehr automatisch eine gesperrte Rampe. Die bisherige starre 28-Prozent-Drosselung ist durch eine angenäherte Aufteilung entsprechend dem Verhältnis von Zielengpasskapazität und Zielzufluss ersetzt. Bei physisch null Durchfluss ist die Einmündung weiterhin blockiert. Auch ältere Rampenwarteschlangen können abfließen, wenn neue Zuflüsse zurückgehen.
- Das ist ein vereinfachtes Modell ohne kalibrierte Verflechtungsberechnung. Rampen können bei tatsächlichem Engpass mehr Wartezeit haben als die Zielautobahn; es wird keine künstliche Verzögerungsobergrenze eingeführt.
- Die Karte und die Abschnittsübersicht verwenden dieselben stabilisierten Farbzustände. Farbwechsel bestehender Warteschlangen erfordern zwei Simulationsminuten; reale Totalsperrungen wirken sofort. Orange wird bei rein stockendem Verkehr nicht künstlich rot gefärbt.
- Rückstaus einer Rampe werden auf ihrem physisch belegten Bereich der Quellautobahn mit denselben Farbübergängen gerendert. Es entstehen dadurch keine zusätzlichen Fahrzeuge.
- Die sichtbare Schaltfläche +5 min wurde entfernt. Start/Pause und Zurücksetzen bleiben erhalten.


## 1.4.2 – Korrekte A48-Durchgangszuordnung

Eine überlaufende Rampe erzeugt keine zusätzliche künstliche A48/A3-Hauptfahrbahn-Warteschlange mehr. Das bisherige `spill:`-Modell drosselte pauschal **alle** Hauptfahrbahnfahrzeuge, obwohl nur der Abfahrtsstreifen belegt war; dieser selbstverstärkende Effekt ließ den Zeitverlust ohne reale Hauptfahrbahn-Sperrung wachsen. Rampenfahrzeuge werden nur in ihrer Rampenwarteschlange geführt und als Belegung am Abfahrtsstreifen auf der A48 sichtbar. Der Durchgangsverkehr erhält seinen eigenen Farb- und Verzögerungsstatus.

Bisher fest eingezeichnete orange/rote/dunkelrote Prozentanteile eines Staus entfallen: Ohne echten abschnittsweisen Geschwindigkeitszustand wird die sichtbare Warteschlange einheitlich in ihrer berechneten Farbe dargestellt. Ein späteres segmentbasiertes Modell kann lokale Farben wieder korrekt trennen. Echte Überlastung kann weiterhin anwachsen; es wird **keine künstliche Maximalverzögerung** eingeführt. Die vollständige netzweite Abbiegestrombilanz fehlt weiterhin und sollte separat umgesetzt werden.


## TRAFFIC 1.5.0 – detailliertere, geschwindigkeitsbasierte Staufarben

- Eine zentrale, überprüfbare Farbdefinition: **Grün über 65 km/h, Orange über 30 bis 65, Rot über 10 bis 30, Dunkelrot von 0 bis 10 km/h**. Keine Farbentscheidung nach bloßer Staulänge oder Simulationstagen.
- Fließgeschwindigkeit und Staudichte beruhen auf einem **vereinfachten dreieckigen Fundamentaldiagramm** (angenommene Rückstauwellengeschwindigkeit 22 km/h, Staudichte 95 Fahrzeuge/km/Fahrstreifen). Die Warteschlangenlänge wird mit **derselben geschätzten Dichte** berechnet; dadurch sind Rückstau, Geschwindigkeit und Kapazität miteinander vereinbar. Keine GPS-Messwerte.
- Zusätzlich werden **Geschwindigkeitsübergänge VOR der Schlange** entlang echter OSM-Fahrbahnen aus einem Bremswegmodell (1,4 m/s²) in passender Farbe visualisiert. Die Übergangsgrenzen ergeben sich aus Geschwindigkeitswerten, nicht aus vorgegebenen 20-%-Streifen. Innerhalb der eigentlichen Warteschlange gilt vorerst eine einheitliche geschätzte Geschwindigkeit. Ein echtes zellenbasiertes Modell ist ein zukünftiger Schritt.
- Geschwindigkeitsbeschränkungen durch Ereignisse werden auf dem entsprechenden Streckenabschnitt sichtbar, auch wenn noch keine Warteschlange entstanden ist. Überlappende Ereignisabschnitte zeigen die ungünstigere Geschwindigkeit, statt von der Zeichenreihenfolge abzuhängen.
- Anzeigen zeigen modellierte km/h bei Rückstaus und den niedrigsten errechneten Wert auf dem ausgewählten Fahrweg. Ein Tempolimit bewirkt einen **geometrisch begründeten Fahrzeitaufschlag** (Länge und Differenz zur freien Fahrt), auch ohne Stau. Warteschlangenwartezeit folgt weiterhin der Fahrzeugzahl geteilt durch den Durchfluss und wächst nicht allein wegen vergangener Minuten.
- A48-Überlauf wird weiterhin ausschließlich als belegter Abfahrtsstreifen gerendert. Keine neu erfundene gesamte Hauptfahrbahnsperrung, keine Doppelzählung der Rampenfahrzeuge.
- Die Kapazitäts- und Nachfrageannahmen sowie die Verteilung an Ein-/Ausfädelungen sind nicht auf Messdaten kalibriert. Eine vollständige zellenbasierte Netzflussberechnung mit abbiegenden Verkehrsströmen bleibt separat geplant.


## TRAFFIC 1.5.1 – wandernde Stop-and-Go-Wellen

- Längere Rückstaus werden auf **160-Meter-Abschnitte** verteilt, in denen die modellierte Fahrgeschwindigkeit und somit die Farbe jeweils unterschiedlich sein können. Dunkelrot, Rot und phasenweise Orange können gleichzeitig auf einer Staustrecke auftreten, anstatt dass die gesamte Schlange synchron die Farbe wechselt.
- Dynamische Geschwindigkeitswellen wandern mit einer angenommenen Rate von 230 Metern pro Modellminute **gegen die Fahrtrichtung**. Wiederkehrende Stau-/Anfahrimpulse ergeben sich aus der Geschwindigkeit am Engpass und einer mehrminütigen Reaktionszeit; Schwellen stammen unverändert aus colorAtSpeed.
- Die Geschwindigkeitsentwicklung jeder Warteschlange wird bis zu 480 Modellminuten gespeichert. Änderungen einer Unfall- oder Baustellenregelung erreichen weiter entfernte Rückstaubereiche erst verzögert. Beim Editieren wird der bestehende Verkehr nicht ohne einen Simulationsschritt über die gesamte Länge umgefärbt.
- Die Wellen verändern **weder Anzahl wartender Autos, noch Zufluss, Abfluss oder aufsummierten Zeitverlust**; die eigenständige Fahrzeugbilanz bleibt unverändert. Vollsperrungen erhalten keine künstlichen fahrenden Segmente, und überfüllte Abfahrten werden weiterhin separat von A3/A48-Durchgangsfahrbahnen dargestellt.
- **Modellgrenze:** Die Wellen sind eine deterministische, entlang der räumlichen Position fortschreitende **Geschwindigkeitsnäherung**, keine vollständig gekoppelte Zellflussberechnung mit eigener Massenerhaltung und Rückwirkung jeder Welle auf die Wartezeit. Die Parameter sind nicht auf reale Schleifendetektoren kalibriert.


## TRAFFIC 1.5.2 – unregelmäßige Stop-and-Go-Folgen und aussagekräftige Staukarten

- Statt einer festen 4,8-Minuten-Farbwelle verwendet der Simulator **deterministisch unregelmäßige Anfahr-/Stillstandsepisoden**. Dauer des Anfahrens, der kurzen freien Fahrt, des erneuten Bremsens und der anschließenden Stillstandsphase variieren je Episode und Ereignis. Lang anhaltender Dunkelrot-Verkehr ist möglich; anschließend können fahrende Rot-/Orange-Pakete entstehen.
- Weiterhin breiten sich die geschätzten Geschwindigkeitsfronten räumlich mit ca. 13,8 km/h gegen die Fahrtrichtung aus. Eine Änderung am Ereignis erreicht entfernte Stauabschnitte nicht sofort. Echte Vollsperrungen bleiben durchgehend auf 0 km/h.
- Stau-Karten zeigen das **Ereignissymbol**, den **Ereignistyp**, die **Fahrtrichtung**, **Zeitverlust in Minuten**, **Staulänge in Kilometern** und eine modellierte Geschwindigkeit. Auf der Karte gibt es platzsparende zweizeilige Stau-Beschriftungen mit Ereignissymbol, Richtung, Minuten und Kilometern.
- Kein erneutes Erzeugen oder doppeltes Zählen von Fahrzeugen in den A48-Abfahrtsrampen. Die unregelmäßigen Wellen sind weiterhin räumliche **Geschwindigkeitsnäherungen**, nicht das vollständig massenerhaltende Zellenmodell, das als nächster Architekturbaustein geplant ist; sie verändern nicht eigenständig den tatsächlichen Engpassdurchfluss oder die Wartezeit.


## TRAFFIC 1.5.3 – Fahrstreifenbelegung, Schwerlastverkehr und stufenweise Freigabe

- Unterschiedliche angenommene Pkw- und Lkw-Verteilungen auf rechter, mittlerer und linker Fahrspur; rechts ist bei erhöhtem Schwerlastanteil besonders belastet. Es handelt sich um **Szenarioannahmen**, keine gemessenen A3/A48-Spurzählungen. Voreingestellt sind 23 % Schwerlastanteil für A3, 16 % für A48 und 15 % für Rampen; die Rechnung unterstützt weitere Werte.
- Kapazitätsverlust bei Fahrstreifensperrung hängt nun von der *konkret gesperrten Spur*, dem Lkw-Anteil und der aktuellen Gesamtverkehrsnachfrage ab. Eine rechte Sperrung kann unter hohem Lkw-Verkehr stärkere Verflechtungsprobleme verursachen als eine linke; bei geringem Zufluss muss dennoch kein Stau entstehen. Das sind vereinfachte, nicht kalibrierte Spurwechselverluste.
- Wird am **selben Ereignis** eine vollständige Sperrung zu einer teilweise offenen Baustelle mit zwei offenen Fahrstreifen verändert, läuft der berechnete Durchfluss nach sechs Modellminuten von zunächst 70 % auf die volle Kapazität hoch. Der Rückstau wird nur kleiner, wenn mehr Fahrzeuge abfließen als neu ankommen; bei starkem Zulauf kann er weiter wachsen. Diese Anlaufphase verändert kein Fahrzeuginventar künstlich.
- Ereignisdetails nennen zusätzlich rechts/mittig/links gesperrte Fahrstreifen, statt nur eine reine Anzahl anzugeben.
- Weitere Baustellen entlang derselben Fahrbahn, netzweit gekoppelte Abbiegeströme und ein massenerhaltendes Zellenmodell bleiben für spätere Schritte offen; **diese Version ist keine vollständig kalibrierte Spurwechsel-Mikrosimulation**.


## TRAFFIC 1.5.4 – Bedarfsumleitungen und 15 Anschlussstellen (Planungsstufe)

- Ein neuer **Umleitungsplaner** führt für A3 Köln/Frankfurt und A48 Dernbach/Koblenz den vorhandenen 15-Knoten-Bestand (A3 10, A48 5) aus dem geprüften Autobahndatensatz. Anschlussstellen werden auf die **Richtungsfahrbahn** projiziert und entlang der Fahrtrichtung sortiert.
- Bei Ereignissen schlägt der Planer bis zu drei erreichbare **reguläre Anschlussstellen vor dem Hindernis** vor; AD Dernbach und AK Koblenz werden nicht fälschlich wie gewöhnliche Ortsausfahrten behandelt. Identifizierte Bedarfsumleitungs-Nummern (z. B. U72 Limburg-Süd→Limburg-Nord, U3 Montabaur→Ransbach-Baumbach, U5 Ransbach→Dierdorf, U8 Dierdorf→Ransbach, U95 Koblenz-Nord→Bendorf/Neuwied) werden gezeigt. Unvollständig dokumentierte U-Routen sind als solche markiert; die U40 von A3 AS Ransbach-Baumbach über L307 zur A48 AS Höhr-Grenzhausen wird **nicht** als direkte A48-Ausfahrt behandelt.
- Die angezeigte **Umfahrungsbereitschaft** ist eine transparente Modellannahme (maximal 35 % bei gewöhnlichem Stau), **keine tatsächlich abgeleitete Fahrzeugmenge**. Vollsperrungen zeigen die notwendige Ableitung *oder* das Zurückhalten an der letzten erreichbaren Ausfahrt, niemals „100 % automatisch umgeleitet“.
- **Sicherheitsgrenze:** In dieser Stufe werden keinerlei Fahrzeuge von A3/A48 entfernt oder auf Ortsstraßen teleportiert. Die tatsächliche Umleitung und kapazitätsbedingte Rückstaubildung auf Ausfahrten/Nebenstraßen benötigen erst ein vollständig verbundenes, auf OSM-Geometrie basierendes Straßennetz, eine kapazitätserhaltende Fahrzeugstromaufteilung und eigene Zeitverluste des Umleitungswegs.
- Quellen: [OSM Bedarfsumleitungen Rheinland-Pfalz](https://wiki.openstreetmap.org/wiki/DE:Germany/Bedarfsumleitung/Rheinland-Pfalz), [Hessen](https://wiki.openstreetmap.org/wiki/DE:Germany/Bedarfsumleitung/Hessen); ausgewählte Beispiele bestätigt von Autobahn GmbH (U5 Jan 2025; U8 Jul 2026) und VG Höhr-Grenzhausen (U40/U97/U99, Juli 2022).


## TRAFFIC 1.5.5 – echte OSM-Umleitungsstrecken mit aktivierbarem Verkehr

- Der Nutzer kann im Bereich „Bedarfsumleitungen“ für ein Ereignis die passende lokale Verbindung **online** laden. Es wird zuerst die dokumentierte OSM-Umleitungsrelation mit echter Way/Node-Geometrie abgefragt (z. B. U1, U3, U5, U72, U95). Ist die Relation nicht vollständig verbunden, sucht der Router eine befahrbare, zusammenhängende Verbindung auf **vorhandenen, nicht autobahnartigen OSM-Straßen** im Umkreis der AS. Weder Luftlinien noch erfundene Straßenstücke sind zulässig. Ergänzungen werden als **„simulierte OSM-Verbindung“** gekennzeichnet, nicht als offizielle Umleitung.
- Vor Aktivierung werden Anschlussstellen in korrekter **Fahrtrichtung** geprüft: Abzweig *vor*, Wiedereintritt *hinter* dem Ereignis. AK Koblenz/AD Dernbach werden nicht als reguläre Ortsausfahrten behandelt. Eine aktivierte Umleitung ist farblich als eigenständige Linie auf der Karte sichtbar; eine nur geladene Route erscheint dezent gestrichelt.
- Nach ausdrücklicher Aktivierung werden tatsächlich akzeptierte Fahrzeuge aus dem Hauptfahrbahn-Strom **an der AS herausgerechnet** und nach ihrer Reisezeit über das Nachgeordnete Straßennetz **am Wiedereintritt wieder eingefügt**. Ein separates, massenerhaltendes Kontenmodell verfolgt wartende Fahrzeuge auf der Nebenstraße und Fahrzeuge unterwegs; die lokale Straßenkapazität ist eine Szenarioannahme von 700–1100 Fzg/h, die Ausfahrt maximal 1200 Fzg/h. Ist die Nebenstraße voll, bleiben weitere Fahrzeuge auf der Autobahn.
- Simulation bleibt stark vereinfacht: Vorfahrt-/Ampel-Knoten des Nebennetzes, getrennte Anschlussstellenrampen und alle Kreuzungsabbieger werden noch nicht physikalisch aufgelöst. Es wird pro Autobahn-Fahrtrichtung **eine aktivierte Umleitung** gleichzeitig unterstützt. OSM-Daten müssen über einen öffentlich erreichbaren Overpass-Dienst geladen werden; Offlinebetrieb kann keine neuen Strecken laden. Fehlgeschlagene Abfragen aktivieren ausdrücklich **keine** geometrisch unbekannte Route.
- Die Dokumentation historischer U-Relationen ist keine offizielle aktuelle Anordnung und keine Verkehrsnavigation. Keine Echtzeitinformationen und keine gefahrene Strecke für echte Verkehrsteilnehmer.


## TRAFFIC 1.5.6 – beruhigte Stauwellen, lesbare AD-Karte, realistische Kreuzungseinflüsse

- Verhindert übertriebene Geschwindigkeits-Impulse in stauendem Verkehr. Bei 5 km/h darf eine visualisierte Bremswelle nicht plötzlich mit Orange/65 km/h über ganze Kilometer laufen. Bewegungsphasen sind länger voneinander getrennt, langsamer, kürzer und räumlich lokal; Rückstaustand und Staulänge bleiben primär von vorhandener Fahrzeugbilanz und Engpasskapazität abhängig. Auf den AD-Rampen ist die Wellenamplitude zusätzlich reduziert.
- Kleine **Karten-Callouts** werden nur platziert, wenn sie weder Marker/Rampen-Badges noch andere Stauhinweise, Kartenstatus oder Legende überdecken. Andernfalls steht der vollständigere Stauhinweis weiterhin in der Liste unter der Karte, anstatt die komplizierte Kreuzungsgeometrie zu verdecken.
- Für eine ausdrücklich geladene OSM-Umleitungsstrecke ermittelt der Router jetzt **in den OSM-Daten vorhandene Straßenkreuzungen** und tatsächlich als `traffic_signals` getaggte Lichtsignalanlagen. Daraus werden konservative **zusätzliche Fahrzeit und Kapazitätsabschläge** geschätzt; keine Ampel wird bloß anhand eines Musters erfunden, es gibt noch keine exakten Ampelphasen oder einzelne abbiegende Fahrzeugströme.
- Die Nebenstraßenbilanz trennt nun Warteschlangen **vor lokalen Engpässen** und **vor dem Wiedereinfädeln** nach Autobahnauffahrt. Die bisherige künstlich regelmäßige Sinus-Ampeleinschränkung ist entfernt; wartende Fahrzeuge bleiben physikalisch erhalten und werden nicht unbemerkt hinter die Auffahrt verschoben.
- Technische Grenze: Die vorhandene Fahrbahn-/Umleitungs-Strömung bleibt aggregiert. Voll gekoppelte A3↔A48-U40-Abbiegeströme und fahrzeugerhaltende Zellen pro Nebenstraßenkreuzung sind weiterhin **nicht** umgesetzt. Die OSM-Signalanlagen sind Online-Daten; falls sie im Abruf nicht enthalten sind, werden keine zusätzlichen Ampeln angenommen.


## TRAFFIC 1.5.7 – massenerhaltendes Verkehrszellenmodell (erste Integrationsstufe)

- Die vier A3/A48-Richtungsfahrbahnen erhalten unabhängige, **auf den OSM-Fahrbahnkilometern liegende Zellen** von ca. 500 Metern. Kein Fahrzeug wird einzeln gerendert.
- Pro Zelle werden tatsächlich modellierte **Fahrzeuganzahl, Dichte, Abfluss und Geschwindigkeit** gespeichert. Die Zellgrenzen übernehmen nur den durch Kapazität, Vorwärtsfluss und verfügbaren Platz möglichen Verkehr. Das Zellmodell nutzt ein dreieckiges Fundamentaldiagramm mit 22 km/h negativer Rückstauwellengeschwindigkeit und maximal 95 Fzg/km/Fahrstreifen. Sechs 10-Sekunden-Teilschritte je Simulationsminute erfüllen die numerische CFL-Bedingung. Die gesamte Zellfahrzeugbilanz (inkl. außerhalb der Karte wartender Einfahrer) wird überwacht.
- **Farb-Overlay der vier Hauptfahrbahnen** wird aus tatsächlich berechneten lokalen Zellgeschwindigkeiten/dichten erzeugt. Künstliche Stop-and-Go-Impulse werden hier nicht mehr für die Verkehrsfarbe verwendet. Dadurch dürfen einzelne Abschnitte nach Freigabe eines Fahrstreifens schneller werden, während weiter hinten noch Stau herrscht.
- Bestehende getrennte Rampen-, AD Dernbach- und Umleitungsmodelle sind für ihre bisherigen Fahrzeugbestände/Zeitverluste noch **autoritativ**. Das neue Hauptfahrbahn-Zellmodell rechnet in dieser ersten Ausbaustufe parallel; deshalb wird seine Fahrzeugzahl nicht mit dem alten Modell addiert oder als gesamter Stau im UI ausgegeben. OSM-Umleitungen und Rampenzuflüsse sind noch NICHT in die Zell-Bilanz übertragen – als solche gekennzeichnete Abweichungen zwischen Karte und aggregierter Kachel sind möglich. Nächster Schritt: die Transferflüsse direkt in dieselbe Zellbilanz einbinden und die alten Aufsummierungen ablösen.
- Tests decken geschlossene/teilweise freigegebene Fahrstreifen, Stauauf-/abbau, Erhaltung der Fahrzeuganzahl, numerische Grenzen, freie Fahrt bei geringer Nachfrage und nicht-invasive Rampenintegration ab.


## TRAFFIC 1.5.8 – iPhone-Oberfläche, Simulationsuhr und geplante Maßnahmen

- Datum, Uhrzeit und Simulationsstatus stehen als gut lesbare Zeitleiste oberhalb der Karte und laufen ausschließlich mit der Modellzeit bei Start/Pause/Reset. Die Simulationssteuerung bleibt unterhalb der Karte. Ein doppelter Zeittext im Verkehrsfluss-Panel wurde entfernt.
- Im Kartenbereich verhindert iOS-WebKit-Selektion (`user-select:none`, `-webkit-touch-callout:none`, kein Kontextmenü/Dragstart) die blauen Markierungen und „Kopieren“-Popups bei Kartengesten. Normale Formularfelder bleiben editierbar und auswählbar.
- Kartenstatus kompakter; Legende zweispaltig auf Mobilgeräten. Ausführliche Modellbeschreibung ist in einem aufklappbaren Infobereich statt als lange Textwand zu sehen.
- **Zeitpläne für Baustellen/Vollsperrungen:** Beginn und Ende in Geräte-Ortszeit; optional bis zu sechs Phasenwechsel mit individuellem Zeitpunkt, temporärer Voll-/Teilsperrung, betroffenen Fahrstreifen, Tempo und Standstreifen. Vor Beginn auf Karte und im Verkehrsmodell inaktiv; am Ende automatisch deaktiviert. Der Plan bleibt im lokalen Browser gespeichert, damit man die Simulation wiederholen kann.
- Entscheidend: Bei Ablauf einer Baustelle wird **nur die Restriktion aufgehoben**; bereits aufgelaufene Fahrzeuge müssen im Verkehrsmodell normal abfließen und werden nicht gelöscht. Persistierte Altereignisse ohne Zeitplan bleiben unverändert dauerhaft aktiv. Nach Umstellen der Simulationszeit werden passende gespeicherte Bauphasen wieder aktiviert.
- Der Zeitplan berücksichtigt **Simulationszeit**, nicht die echte Geräteuhr. Ein Plan ist keine reale Straßenverkehrsanordnung. Kein Hintergrundbetrieb bei geschlossenem Simulator.


## TRAFFIC 1.5.9 – Abfahrten, Auffahrten und Stauumfahrungs-Prozent an allen Anschlussstellen

- Für **alle regulären A3/A48-Anschlussstellen beider Richtungen** zeigt die Verkehrsfluss-Ansicht geordnet entlang der jeweiligen Fahrtrichtung den **gewünschten Anteil für die Stauumfahrung** (in Prozent), die **tatsächlich über geprüfte OSM-Routen abgefahrenen Fahrzeuge pro Stunde** (↓), und die **nach der Nebenstraßenreise wieder aufgefahrenen Fahrzeuge pro Stunde** (↑). AD Dernbach / AK Koblenz bleiben als **Autobahnknoten** erkennbar und erhalten keine fiktive Ortsausfahrt.
- Bei einer **formalen Vollsperrung** erhält ausschließlich die **letzte erreichbare reguläre AS vor der Sperre 100 % Soll-Umfahrung**. „100 % Soll“ ist ausdrücklich **keine gemessene Abfahrt**. Reale Ausfahrt und Auffahrt werden **nur** aus dem bestehenden massenerhaltenden aktivierten OSM-Umleitungsmodell angezeigt. Falls keine Route aktiviert ist oder die Ausfahrt überlastet, bleiben die Fahrzeuge physisch im Rückstau und werden **nicht teleportiert**. Die derzeitige simulierte maximale Ausfahrtleistung liegt bei 1200 Fzg/h und begrenzt die tatsächliche Rate.
- Bei anderen Engpässen ist die **mögliche Umfahrungsneigung eine Modellannahme**, an den letzten drei möglichen AS mit nach Nähe reduzierten Prozentwerten. Unveränderte Richtung und passende Ausfahrt werden vorausgesetzt. Keine Pflichtquote für Lkw oder Regelungen aus dem realen Straßenverkehr.
- Optional kleine dynamische Pfeil-Badges auf der Karte nur bei ausreichender Vergrößerung: Prozent Soll an der AS und reale `↓ .../h` bzw. `↑ .../h` bei aktiver Umleitung. Die reguläre Ausfahrt-/Auffahrt-Nachfrage an übrigen Anschlussstellen ist **noch nicht als separater Fahrzeugstrom umgesetzt**; darum steht dort „—“, nicht eine erfundene Zahl.
- Die normale Verkehrs- und geplante Baustellenlogik bleibt unverändert. Das vollständige Koppeln aller AS-Ein-/Ausfahrten in die Fahrzeugbilanz der Hauptfahrbahn-Zellen wäre eine spätere Ausbaustufe.


## TRAFFIC 1.6.0 – Vollsperrung als Einfahrtsverbot, nicht als physisches Hindernis

- Ein formales Ereignis `closure` wird **an der letzten regulären, in Fahrtrichtung erreichbaren Anschlussstelle vor dem Ereignis** zu einem **Einfahrtsverbot für nachfolgende Fahrzeuge**. Bereits hinter dieser AS vorhandene Fahrzeuge dürfen den Abschnitt leerfahren. AD/AK werden nicht fälschlich als Ortsausfahrten angesehen. Fehlt eine geeignete AS in den zugrundeliegenden Kartendaten, liegt der Einfahrtsstop an der Modellgrenze, damit niemand durch die Sperre fährt.
- Beide vorhandenen Rechenmodelle, das aggregierte Warteschlangenmodell und das 500-m-Hauptfahrbahn-Zellmodell, legen den **Closure-Eintrittsstopp an dieselbe AS**. Ein separates Ereignis Unfall/Panne/Baustelle, das tatsächlich alle Fahrstreifen blockiert, bleibt am **physischen Ort** und kann den bereits im Sperrabschnitt vorhandenen Verkehr weiterhin aufhalten.
- Eine Null-Durchfluss-Closure zeigt nun die **bisher verstrichene Wartezeit des ältesten noch modellierten Rückstaus** an. Das ist **keine Prognose**, wie lange bis zur Wiederfreigabe gewartet werden muss. Auf Karte, in Staukacheln und in der Richtungsübersicht steht `bisher` neben dem Minutenwert. Keine künstlichen Aufschläge, keine unbegrenzte minutengestützte Stau-Prognose.
- Der Kartenabschnitt am Ereignis selbst wird bei einer rein administrativen Vollsperrung nicht mehr automatisch rot/dunkelrot übermalt; die vom Zellmodell berechneten Geschwindigkeiten gelten. Vorhandener Rückstau bleibt bis zum echten Abfluss bestehen. Beim Ende der Sperrung verschwindet die Beschränkung, nicht die Fahrzeuge.
- Die freiwillig aktivierte OSM-Umleitung zieht wie bisher ausschließlich die tatsächlich aufgenommenen Fahrzeuge über ihre eigene Nebenstraßen-Bilanz ab; ein 100-%-Sollwert ist **keine 100-%-Ist-Abfahrt**. Ein vollständig einheitliches Hauptfahrbahn-, Rampen- und Umleitungs-Fahrzeugkonto bleibt eine separate Erweiterung und wird von dieser Korrektur nicht behauptet.
