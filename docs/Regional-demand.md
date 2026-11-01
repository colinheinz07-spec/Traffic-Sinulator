# Regional traffic demand, v1.17.0

The calendar mode uses separate scenario curves for regional A3 transit, Koblenz/A48 commuting, the Cologne ring, A59 airport/commuter traffic, A559 urban commuting and A560/Siegtal commuting. Curves begin their morning increase around 04:30–05:00, peak between 07:00 and 08:00, recede during the morning and have separate afternoon and weekend shapes. Smooth interpolation avoids hourly steps. Curve endpoints agree at midnight, including Friday/Saturday and Sunday/Monday. Holidays, school holidays and live counts are not included.

## Evidence and assumptions

Published DTV means **vehicles per day across both directions**. It is not an hourly or directional inflow and is not applied everywhere on an entire motorway.

| Observed section | Published scale | Source |
|---|---:|---|
| A3/A4 Köln-Ost–Heumar | about 166,300/day, SVZ 2021 | [Toll Collect report reproducing BASt SVZ results](https://company.toll-collect.de/static/media/dokumente/toll-collect/informationen/nutzer/mautnetz-und-lkw-verkehr/mautnetz-und-lkw-verkehr-2-halbjahr-2022.pdf) |
| A3 Heumar–Bad Honnef | 80,000–100,000/day | [Autobahn GmbH project](https://www.autobahn.de/planen-bauen/projekt/grundhafte-erneuerung-der-a3-zwischen-koeln-heumar-und-bad-honnef) |
| A48 Höhr-Grenzhausen | 44,748/day, 2022 | [Autobahn GmbH project](https://www.autobahn.de/planen-bauen/projekt/ersatzneubau-des-a48-ueberfuehrungsbauwerkes-der-l307-bei-hoehr-grenzhausen) |
| A48 Bendorf Rhine crossing | almost 70,000/day, approximate and undated | [Polizei Rheinland-Pfalz](https://www.polizei.rlp.de/die-polizei/dienststellen/polizeipraesidium-koblenz/unsere-dienststellen/verkehrsdirektion-koblenz/polizeiautobahnstation-montabaur) |
| A59 Flughafen–Troisdorf | about 90,000/day, SVZ 2021 | [Autobahn GmbH](https://www.autobahn.de/betrieb-verkehr/verkehrsmeldung/31-03-2026-update-a59-verlaengerung-der-sperrung-der-anschlussstelle-lind-in-richtung-koeln) |

The sampled model week 2–8 November 2026 gives approximately 87k/day for the regional A3, 167k/day for the Cologne shared section, 43k/day for eastern A48 and 90k/day for the A59 main section. These are calibration checks, not new observations or forecasts. The A4, A559 and A560 peak inputs and all hourly/turning shapes are explicitly model assumptions; this change does not claim measured hourly curves or observed OD fractions for those roads.

## Spatial flow changes

The A3 reference input remains the regional peak-hour reference. Extra Cologne demand enters or leaves only near the Heumar end of the shared four-lane section, at retained directional geometry anchors. The A3 towards Frankfurt receives its urban boundary inflow and loses the corresponding destination share before the regional stretch. Westerwald traffic therefore does not inherit the ring's high volume.

The A48 has a higher western/Rhine-crossing demand and a lower Höhr/Dernbach reference. Bendorf exchange shares the existing AS node and its physical service/storage. A59 southbound begins with only part of the main-section reference at the narrow Heumar connection; the Porz merge adds the remaining model flow. Northbound A59 loses its model A559 share at Porz. A560 has distinct western and eastern model shares at Bonn/Siegburg.

The shares (A48 western multiplier 1.55, A59 Heumar entry 0.42 / northbound Porz continuation 0.55, A560 eastern share 0.78) are scenario assumptions, not surveyed turning counts. Regional additions at motorway merges have explicit receiving/service assumptions; ordinary exit terminals keep their existing capacity.

Each admission increases offered/entered totals; each departure increases exited totals. Existing vehicles are never multiplied or removed to make a density match a target. Regional initial inventories use local free-flow demand, are counted in initialVehicles and respect physical capacity. Larger combined boundary demands can reach 16,000 offers/h in the internal solver; the editable reference remains limited to 8,000/h. Excess demand waits rather than becoming extra road capacity.

Regional junction adjustments are enabled only in calendar mode. Constant and declining-peak stress-test modes retain the chosen reference flow. Demand offers at a regional merge inside a formal closure are suppressed, preserving any already-stored vehicle inventory.

The selected road's panel shows the effective boundary demand. Selecting an actual motorway point additionally shows the model demand at that location, updated every simulation minute. These offers are distinct from actual discharge during a queue.

Legacy independent macroscopic ramp demands and intermediary motorway legs of bundled detours remain approximations; this is not a full regional origin/destination assignment. The density correction does not extend the map into the Ruhrgebiet or beyond Köln-Ost.
