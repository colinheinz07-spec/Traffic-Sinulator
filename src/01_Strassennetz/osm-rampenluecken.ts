/** OSM-originale, tatsächlich fehlende motorway_link-Kanten an Rampen.
 * Keine Landstraßen, kein Snapping, keine künstlichen Geraden.
 * Erzeugt mit scripts/repair_osm_ramp_gaps.py. © OSM-Mitwirkende, ODbL.
 */
export interface VerifiedRampGap {id:string;name:string;zone:string;kind:'ramp';lanes:number;laneSegments:{fromM:number;toM:number;lanes:number}[];points:[number,number][];wayIds:number[];demandVph:number;freeKmh:number}
export const verifiedRampGapRoutes:VerifiedRampGap[]=[];
