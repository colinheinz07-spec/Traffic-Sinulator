# A59 / A560 extension, v1.15

The simulator retains both directed A59 carriageways between Sankt Augustin-West and Heumar, including their actual joins to the short shared A3/A4 carriageway. A560 covers Sankt Augustin-West–Hennef-Ost. Junctions A59 31–39 and A560 1–7 have directional anchors; Rath's entry-only northbound connection is not offered as an exit.

Geometry derives from OpenStreetMap, © OpenStreetMap contributors, ODbL. `data/a59-a560-osm.json` supplements the previously retained regional snapshot. The exact map API extract tiles are retained in `scripts/fetch_a59_osm.py`. Run the data scripts in this order:

1. `python3 scripts/extend_heumar_merge.py`
2. `python3 scripts/build_network_extensions.py`
3. `python3 scripts/build_extension_detours.py`
4. `npm run build`

The extension's motorway cells use the existing vehicle-conserving motorway/detour solver. Ordinary AS demands, terminal capacity and ramp storage remain scenario assumptions. Dedicated motorway ramp turn demands remain a separate macroscopic approximation, as in the existing Dernbach model.

Diversion geometry follows connected directed OSM roads, including local routes and alternatives over neighbouring motorways. Departure, local transit and re-entry share one vehicle ledger. Geometry is bundled offline. Vertex indices are deduplicated and decoded once when the module loads. The route catalogue renders its contents only when expanded. Automated decisions run no more than three return junctions per source exit.

These are **simulated alternatives**, not a claim to reproduce every signed U-route or navigation choice. The published Autobahn GmbH notice for Bonn/Siegburg documents U17 from A560 Siegburg via B56 to A3 Lohmar and U40 via A3 Lohmar. The catalogue's computed street paths are not certified reproductions of those signs. Live roadworks are not imposed on the base network; users create scenario events.

A route crossing another simulated motorway closure admits no new vehicles and holds its existing inventory until service returns. Its motorway leg's capacity is reserved within the detour ledger; individual vehicles are not inserted into each intermediate motorway cell. This is a remaining modelling approximation, rather than a full origin/destination assignment model.
