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
