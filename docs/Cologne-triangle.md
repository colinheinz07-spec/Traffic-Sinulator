# Cologne motorway triangle (v1.16.0)

Included network: A3/A4 through Kreuz Köln-Ost; A4 between Heumar and Gremberg; A559 between Gremberg and Dreieck Porz. The new directional carriageways, junction ramps and junction anchors are retained OpenStreetMap geometry (© OpenStreetMap contributors, ODbL).

The A3/A4 shared carriageways use the existing A3 cell inventory, rather than drawing a second A4 motorway over the same street. A4 junction 16 Köln-Ost therefore selects the actual shared A3 direction. The standalone A4 paths join the retained Heumar carriageways at their exact existing vertices. A559 has separate northbound and southbound paths, Gremberghoven and both terminal interchanges. Where the A3 extension has explicitly retained normal-lane counts, lane selection uses those counts instead of the previous blanket three-lane assumption.

All six motorway names appear in navigation, junction directories, traffic summaries and length metrics. New directions use the existing synthetic demand, cell flow, event and queue model. Existing macroscopic interchange/route-capacity approximations described in A59-A560-network.md remain; this is not a measured OD assignment or live traffic feed.

Rebuild order:

1. `python3 scripts/fetch_cologne_osm.py` (only when refreshing source data; public OSM API)
2. `python3 scripts/extend_cologne_core.py`
3. `python3 scripts/build_network_extensions.py`
4. `python3 scripts/build_extension_detours.py`
5. `npm run build`

`data/legacy-extension-paths.json` preserves older Heumar fragment IDs used by stored events after complete turn walks replace those fragments. The source fetcher includes the retained map tiles around Köln-Ost, Heumar, Gremberg and Porz.

Topology reference: [Autobahn GmbH — replacement bridge at Kreuz Köln-Gremberg](https://www.autobahn.de/planen-bauen/projekt/ersatzneubau-im-autobahnkreuz-koeln-gremberg).
