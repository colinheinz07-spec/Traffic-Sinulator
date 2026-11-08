/** Ausschließlich im OSM-Quellsnapshot nachgewiesene fehlende Teilstücke von Autobahnrampen.
 * Aus scripts/repair_osm_ramp_gaps.py erzeugt. Keine geraden Hilfslinien und keine Landstraßen.
 * © OpenStreetMap-Mitwirkende, ODbL.
 */
export interface VerifiedRampGap {id:string;name:string;zone:string;kind:'ramp';lanes:number;laneSegments:{fromM:number;toM:number;lanes:number}[];points:[number,number][];wayIds:number[];demandVph:number;freeKmh:number}
export const verifiedRampGapRoutes:VerifiedRampGap[]=[];
