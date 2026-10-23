/** User-defined simulation events and configuration; no actual moving vehicles yet. */
import type {Point,RoadId} from './core.js';
import type {MapHit} from './selection.js';
import {validDailyRecurrence,dailyRecurrenceBounds,dailyOccurrenceAt,type DailyRecurrence} from './recurring-events.js';

export const EVENT_KINDS=['roadworks','accident','breakdown','closure'] as const;
export type EventKind=typeof EVENT_KINDS[number];
export type ShoulderMode='normal'|'open'|'blocked';
export const eventNames:Record<EventKind,string>={roadworks:'Baustelle',accident:'Unfall',breakdown:'Lkw-Panne',closure:'Vollsperrung'};
export const eventSymbols:Record<EventKind,string>={roadworks:'🚧',accident:'💥',breakdown:'🚛',closure:'⛔'};
/** Keep old key so 0.7 events do not disappear after updating to 0.8. */
export const STORAGE_KEY='traffic-sinulator-events-v1';
export interface EventSettings {lengthM:number;speedKmh:number;shoulder:ShoulderMode}
export interface EventPhase {startAt:string;kind:'roadworks'|'closure';closedLanes:number[];speedKmh:number;shoulder:ShoulderMode}
export interface EventSchedule {startAt:string;endAt:string;phases:EventPhase[];recurrence?:DailyRecurrence}
export interface SimEvent {id:string;kind:EventKind;pathKey:string;point:Point;closedLanes:number[];laneCount:number;createdAt:string;settings:EventSettings;schedule?:EventSchedule}
export interface FlowPolicy {openMainLanes:number;openTotalLanes:number;canEnter:boolean;occupantsMayLeave:boolean;rerouteApproaching:boolean;speedKmh:number}
const directions:ReadonlySet<string>=new Set<RoadId>(['A3-koeln','A3-frankfurt','A48-koblenz','A48-dernbach']);
const knownRampIds:ReadonlySet<string>=new Set(['ramp-a3-to-a48-from-frankfurt','ramp-a3-to-a48-from-koeln','ramp-a48-to-koeln','ramp-a48-to-frankfurt']);
export function isKnownPath(key:string):boolean{return directions.has(key)||knownRampIds.has(key)}
export function isEventKind(v:unknown):v is EventKind{return typeof v==='string'&&(EVENT_KINDS as readonly string[]).includes(v)}
const isShoulder=(x:unknown):x is ShoulderMode=>x==='normal'||x==='open'||x==='blocked';
function isPoint(p:unknown):p is Point{return Array.isArray(p)&&p.length===2&&p.every(n=>typeof n==='number'&&Number.isFinite(n))&&p[0]>=50.32&&p[0]<=50.73&&p[1]>=7.27&&p[1]<=8.16}
export function maxLengthM(kind:EventKind):number{return kind==='accident'||kind==='breakdown'?200:kind==='closure'?10000:20000}
export function defaultLengthM(kind:EventKind):number{return kind==='roadworks'?500:kind==='closure'?200:kind==='accident'?100:50}
/** These are adjustable *simulation assumptions*, not German traffic-law speed limits. */
export function suggestedSpeed(kind:EventKind,laneCount:number,closedLanes:readonly number[],shoulder:ShoulderMode):number{
 if(kind==='closure')return 0;
 const open=Math.max(0,laneCount-new Set(closedLanes).size)+(shoulder==='open'?1:0);
 if(open===0)return 0;
 if(kind==='accident'||kind==='breakdown')return open===1?40:open===2?60:80;
 return open===1?40:open===2?60:open===3?80:100;
}
export function defaultSettings(kind:EventKind,laneCount:number,closedLanes:readonly number[]):EventSettings{
 return {lengthM:defaultLengthM(kind),speedKmh:suggestedSpeed(kind,laneCount,closedLanes,'normal'),shoulder:kind==='closure'?'blocked':'normal'};
}
export function validEvent(v:unknown):v is SimEvent{
 if(!v||typeof v!=='object')return false;
 const x=v as Partial<SimEvent>,laneCount=x.laneCount,s=x.settings;
 if(!(typeof x.id==='string'&&x.id.length>0&&x.id.length<=100&&isEventKind(x.kind)
  &&typeof x.pathKey==='string'&&isKnownPath(x.pathKey)&&isPoint(x.point)
  &&typeof laneCount==='number'&&Number.isInteger(laneCount)&&laneCount>=1&&laneCount<=7
  &&Array.isArray(x.closedLanes)&&x.closedLanes.length<=laneCount&&new Set(x.closedLanes).size===x.closedLanes.length
  &&x.closedLanes.every(n=>Number.isInteger(n)&&n>=0&&n<laneCount)
  &&(x.kind!=='closure'||x.closedLanes.length===laneCount)
  &&typeof x.createdAt==='string'&&Number.isFinite(Date.parse(x.createdAt))))return false;
 if(!s||!Number.isInteger(s.lengthM)||s.lengthM<1||s.lengthM>maxLengthM(x.kind))return false;
 if(!isShoulder(s.shoulder)||(!directions.has(x.pathKey)&&s.shoulder!=='normal'&&x.kind!=='closure'))return false;
 if(x.kind==='closure'&&s.shoulder!=='blocked')return false;
 const passable=x.kind!=='closure'&&(laneCount-x.closedLanes.length+(s.shoulder==='open'?1:0)>0);
 if(!Number.isInteger(s.speedKmh)||s.speedKmh<0||s.speedKmh>130||s.speedKmh%10!==0)return false;
 if((!passable&&s.speedKmh!==0)||(passable&&s.speedKmh===0))return false;
 if(x.schedule!==undefined){
  if(x.kind!=='roadworks'&&x.kind!=='closure')return false;
  const sch=x.schedule;
  if(!sch||typeof sch!=='object'||typeof sch.startAt!=='string'||typeof sch.endAt!=='string'
   ||!Number.isFinite(Date.parse(sch.startAt))||!Number.isFinite(Date.parse(sch.endAt))
   ||Date.parse(sch.startAt)>=Date.parse(sch.endAt)
   ||!Array.isArray(sch.phases)||sch.phases.length>6)return false;
  if(sch.recurrence!==undefined){
   if(!validDailyRecurrence(sch.recurrence)||sch.phases.length)return false;
   const bounds=dailyRecurrenceBounds(sch.recurrence);
   if(!bounds||Date.parse(bounds.startAt)!==Date.parse(sch.startAt)||Date.parse(bounds.endAt)!==Date.parse(sch.endAt))return false;
  }
  let previous=Date.parse(sch.startAt);
  for(const phase of sch.phases){
   if(!phase||typeof phase!=='object'||typeof phase.startAt!=='string'
    ||(phase.kind!=='roadworks'&&phase.kind!=='closure')||
    !Array.isArray(phase.closedLanes)||!isShoulder(phase.shoulder)||
    !Number.isInteger(phase.speedKmh))return false;
   const ts=Date.parse(phase.startAt);
   if(!Number.isFinite(ts)||ts<=previous||ts>=Date.parse(sch.endAt))return false;
   previous=ts;
   const candidate={...x,kind:phase.kind,closedLanes:phase.closedLanes,
    settings:{...s,shoulder:phase.shoulder,speedKmh:phase.speedKmh},schedule:undefined};
   if(!validEvent(candidate))return false;
  }
 }
 return true;
}
/** Old 0.7 event records are upgraded in memory; no silent data loss. */
function upgradeOldEvent(value:unknown):unknown{
 if(!value||typeof value!=='object')return value;
 const x=value as Partial<SimEvent>;
 if(x.settings!==undefined)return value;
 if(!isEventKind(x.kind)||typeof x.laneCount!=='number'||!Array.isArray(x.closedLanes))return value;
 return {...x,settings:defaultSettings(x.kind,x.laneCount,x.closedLanes)};
}
export function decodeEvents(raw:string|null):SimEvent[]{
 if(!raw)return [];
 try{const v:unknown=JSON.parse(raw);if(!Array.isArray(v))return [];
  const ids=new Set<string>(),output:SimEvent[]=[];
  for(const item of v){const entry=upgradeOldEvent(item);if(!validEvent(entry)||ids.has(entry.id))continue;ids.add(entry.id);output.push(entry);if(output.length>=150)break;}
  return output;
 }catch{return []}
}
export function eventFromHit(hit:MapHit,kind:EventKind,laneCount:number,lanes:readonly number[],id:string,createdAt:string,settings?:EventSettings):SimEvent{
 if(!isEventKind(kind)||!isKnownPath(hit.key))throw Error('Unbekannter Ereignistyp oder Fahrweg');
 if(!Number.isInteger(laneCount)||laneCount<1||laneCount>7)throw Error('Fahrstreifenanzahl nicht gesichert');
 const closedLanes=kind==='closure'?Array.from({length:laneCount},(_,i)=>i):[...new Set(lanes)].sort((a,b)=>a-b);
 const result:SimEvent={id,kind,pathKey:hit.key,point:[...hit.point],closedLanes,laneCount,createdAt,settings:settings??defaultSettings(kind,laneCount,closedLanes)};
 if(!validEvent(result))throw Error('Ungültige Ereignislänge, Geschwindigkeit oder Verkehrsführung');
 return result;
}
/** Updating never relocates the point, changes the directional route, or duplicates the ID. */
export function updatedEvent(current:SimEvent,kind:EventKind,lanes:readonly number[],settings:EventSettings):SimEvent{
 const closed=kind==='closure'?Array.from({length:current.laneCount},(_,i)=>i):[...new Set(lanes)].sort((a,b)=>a-b);
 const candidate={...current,kind,closedLanes:closed,settings};
 if(!validEvent(candidate))throw Error('Ungültige Ereignis-Einstellungen');
 return candidate;
}
/** Simulation contract for subsequent traffic engine. Does not currently move vehicles. */
export function flowPolicy(e:SimEvent):FlowPolicy{
 const openMain=Math.max(0,e.laneCount-e.closedLanes.length);
 if(e.kind==='closure')return {openMainLanes:0,openTotalLanes:0,canEnter:false,occupantsMayLeave:true,rerouteApproaching:true,speedKmh:0};
 const openTotal=openMain+(e.settings.shoulder==='open'?1:0);
 return {openMainLanes:openMain,openTotalLanes:openTotal,canEnter:openTotal>0,occupantsMayLeave:openTotal>0,rerouteApproaching:false,speedKmh:openTotal?e.settings.speedKmh:0};
}
export function eventSummary(e:SimEvent):string{
 const parts:string[]=[`${e.settings.lengthM} m`,e.settings.speedKmh?`${e.settings.speedKmh} km/h`:'kein Durchfluss'];
 if(e.kind==='closure')parts.push('Vollsperrung · nachfolgende Fahrzeuge umleiten · Fahrzeuge im Abschnitt dürfen ausfahren');
 else if(e.closedLanes.length===e.laneCount)parts.push('Alle Fahrstreifen betroffen (ohne Vollsperrungs-Ereignis)');
 else if(e.closedLanes.length){
  parts.push(`${e.closedLanes.length} von ${e.laneCount} Fahrstreifen gesperrt`);
  const lanePositions=e.closedLanes.map(lane=>lane===0?'rechts':lane===e.laneCount-1?'links':'mittig');
  parts.push('Betroffen: '+lanePositions.join(', '));
 }
 else parts.push('Kein Fahrstreifen gesperrt');
 if(e.settings.shoulder==='open')parts.push('Standstreifen freigegeben (Simulation)');
 if(e.settings.shoulder==='blocked')parts.push('Standstreifen gesperrt');
 return parts.join(' · ');
}

/** A planned event is active in [start,end). Phases replace lane settings
 * without deleting history. This keeps rewinding/replaying deterministic.
 * Unscheduled historical events retain their original always-active behavior.
 */
export function effectiveEventAt(event:SimEvent,at:number):SimEvent|null{
 const schedule=event.schedule;
 if(!schedule)return event;
 if(!Number.isFinite(at)||at<Date.parse(schedule.startAt)||at>=Date.parse(schedule.endAt))return null;
 if(schedule.recurrence&&!dailyOccurrenceAt(schedule.recurrence,at))return null;
 let active:EventPhase|null=null;
 for(const phase of schedule.phases){
  if(Date.parse(phase.startAt)<=at)active=phase;
  else break;
 }
 if(!active)return event;
 return {...event,kind:active.kind,closedLanes:[...active.closedLanes],
  settings:{...event.settings,speedKmh:active.speedKmh,shoulder:active.shoulder}};
}
export function effectiveEventsAt(events:readonly SimEvent[],at:number):SimEvent[]{
 return events.flatMap(e=>{const active=effectiveEventAt(e,at);return active?[active]:[]});
}
export function eventScheduleStatus(event:SimEvent,at:number):'permanent'|'planned'|'active'|'between'|'finished'{
 if(!event.schedule)return 'permanent';
 if(at<Date.parse(event.schedule.startAt))return 'planned';
 if(at>=Date.parse(event.schedule.endAt))return 'finished';
 if(event.schedule.recurrence&&!dailyOccurrenceAt(event.schedule.recurrence,at))return 'between';
 return 'active';
}
