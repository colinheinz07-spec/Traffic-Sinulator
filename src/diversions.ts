/** Publicly documented emergency diversion (Bedarfsumleitung) INVENTORY.
 * Sources:
 *  - OSM Wiki Germany/Bedarfsumleitung/Rheinland-Pfalz and Hessen (Oct 2026)
 *  - Autobahn GmbH A3 U5 (Jan 2025) and U8 (Jul 2026)
 * No local-road geometry, journey time or official active diversion is assumed.
 * This module produces ROUTE PLANNING PREVIEWS only. It must never silently
 * subtract or teleport vehicles from the conserved A3/A48 motorway queues.
 */
import type {Exit,RoadId} from './core.js';
import type {SimEvent} from './events.js';
import type {Corridor} from './spatial.js';
import {positionM} from './spatial.js';

export type DiversionEvidence='named-endpoints'|'partial';
export interface DiversionLink {
 id:string;code:string;path:RoadId;
 fromRoad:'A3'|'A48';fromRef:string;toRoad:'A3'|'A48'|null;toRef:string|null;
 evidence:DiversionEvidence;description:string;
}
const r=(code:string,path:RoadId,fromRef:string,toRef:string|null,evidence:DiversionEvidence='named-endpoints'):DiversionLink=>({
 id:path+'-'+code,code,path,fromRoad:path.startsWith('A3')?'A3':'A48',fromRef,
 toRoad:toRef?(path.startsWith('A3')?'A3':'A48'):null,toRef,evidence,
 description:evidence==='partial'?'Start belegt, Ziel oder Straßenverlauf unvollständig':
 'Start und Ziel dokumentiert; Nebenstraßen-Geometrie noch nicht übernommen'
});
/** Includes only U-signs we can attribute to this motorway/direction.
 * A missing number does NOT imply an impossible diversion or drive-through.
 */
export const DIVERSION_LINKS:readonly DiversionLink[]=[
 r('U72','A3-koeln','43','42'),
 r('U74','A3-koeln','42',null,'partial'),
 r('U1','A3-koeln','41','40'),
 r('U3','A3-koeln','40','38'),
 r('U5','A3-koeln','38','37'),
 r('U7','A3-koeln','37',null,'partial'),
 r('U9','A3-koeln','36',null,'partial'),
 r('U11','A3-koeln','35',null,'partial'),
 r('U4','A3-frankfurt','35','36'),
 r('U6','A3-frankfurt','36','37'),
 r('U8','A3-frankfurt','37','38'),
 r('U10','A3-frankfurt','38','40'),
 r('U12','A3-frankfurt','40','41'),
 r('U51','A3-frankfurt','41','42'),
 r('U53','A3-frankfurt','42','43'),
 r('U91','A48-dernbach','9',null,'partial'),
 r('U95','A48-dernbach','10','11'),
 r('U97','A48-dernbach','11',null,'partial'),
 r('U99','A48-dernbach','12',null,'partial'),
 r('U42','A48-koblenz','12','11','partial')
];
/** Known A3→A48 local diversion at Ransbach-Baumbach (U40).
 * This route is NOT a junction on the A48 carriageway itself. Keep separate
 * so a simulated A48 exit cannot magically become A3 AS 38.
 */
export const CROSS_MOTORWAY_DIVERSION:Readonly<DiversionLink>={
 id:'a3-ransbach-u40-to-a48-hoehr',code:'U40',path:'A48-koblenz',
 fromRoad:'A3',fromRef:'38',toRoad:'A48',toRef:'12',evidence:'named-endpoints',
 description:'Über das nachgeordnete Netz von A3 AS 38 zur A48 AS 12; L307. Nicht direkt am AD Dernbach befahrbar.'
};

export type JunctionAnchor=Exit & {metre:number;isInterchange:boolean};
/** Exit coordinates come from the already-audited geodata file. Snap only
 * their motorway positions: this is NOT a side-road ramp location.
 */
export function diversionJunctions(path:RoadId,exits:readonly Exit[],corridor:Corridor):JunctionAnchor[]{
 if(path!==corridor.key)throw Error('Fahrtrichtung und Geometrie passen nicht zusammen');
 const road=path.startsWith('A3')?'A3':'A48';
 return exits.filter(e=>e.road===road).map(e=>({
  ...e,metre:positionM(corridor,e.position,900),
  isInterchange:e.name.startsWith('AD ')||e.name.startsWith('AK ')
 })).filter((e):e is JunctionAnchor=>e.metre!==null)
  .sort((a,b)=>a.metre-b.metre||a.ref.localeCompare(b.ref));
}
export interface DiversionOption {
 exit:JunctionAnchor;link:DiversionLink|null;
 upstreamKm:number;isLastUsableExit:boolean;
 canSimulate:boolean; // Always FALSE without certified local-road graph.
}
export interface DiversionPlan {
 eventId:string;path:RoadId;eventKind:SimEvent['kind'];
 delayMin:number|null;requiredDiversion:boolean;interestPercent:number|null;
 candidateExits:DiversionOption[];
 reason:string;
}
/** Illustrative willingness to divert. This percentage is NOT applied to the
 * motorway conservation model until a real reachable and capacity-limited
 * local road path with junction turn flows is available.
 */
export function potentialDiversionPercent(delayMin:number|null,required:boolean):number|null{
 if(required)return null;
 if(delayMin===null||!Number.isFinite(delayMin)||delayMin<45)return 0;
 const anchors:readonly (readonly [number,number])[]=[
  [0,0],[45,2],[50,8],[60,25],[75,50],[90,75],[105,90],[120,100]
 ];
 for(let i=1;i<anchors.length;i++){
  const [end,to]=anchors[i]!, [begin,from]=anchors[i-1]!;
  if(delayMin<=end)return Math.round((from+(to-from)*(delayMin-begin)/(end-begin))*10)/10;
 }
 return 100;
}
export function planDiversion(event:SimEvent,route:Corridor,exits:readonly Exit[],
 delayMin:number|null,maxOptions=Infinity):DiversionPlan|null{
 if(route.key!==event.pathKey||route.key.startsWith('ramp-'))return null;
 const path=route.key as RoadId;
 const at=positionM(route,event.point,100);
 if(at===null)return null;
 const all=diversionJunctions(path,exits,route);
 const upstream=all.filter(x=>!x.isInterchange&&x.metre<at-50).reverse().slice(0,maxOptions);
 const candidates=upstream.map((exit,index)=>{
  const link=DIVERSION_LINKS.find(u=>u.path===path&&u.fromRoad===exit.road&&u.fromRef===exit.ref)??null;
  return {exit,link,upstreamKm:Math.max(0,(at-exit.metre)/1000),
   isLastUsableExit:index===0,canSimulate:false};
 });
 const required=event.kind==='closure';
 return {eventId:event.id,path,eventKind:event.kind,delayMin,requiredDiversion:required,
  interestPercent:potentialDiversionPercent(delayMin,required),candidateExits:candidates,
  reason:required
  ?'Vollsperrung: an geeigneter Ausfahrt ableiten oder Fahrzeuge davor zurückhalten. Ohne geprüfte Nebenstraßen darf keine Weiterfahrt simuliert werden.'
  :'Ausweichbereitschaft ist nur eine angenommene Nachfrage; keine Fahrzeuge werden bisher automatisch umgeleitet.'};
}
