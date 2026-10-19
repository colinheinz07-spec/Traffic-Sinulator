import {PATHS,pathBottleneck,baselineCapacity,defaultDemand,defaultDemands,demandAtMinute,type DemandMode,type PathKey,type TrafficColor} from './traffic.js';
import {networkData} from './geodata.js';
import {routeReport} from './network-report.js';
import {makeCorridors,routeSlice,advanceSpatial,emptySpatial,jamsAt,jamBands} from './spatial.js';
import {buildRampConnections,rampSpillbacks} from './interchange.js';
import {decodeEvents,eventFromHit,updatedEvent,eventNames,eventSymbols,eventSummary,flowPolicy,defaultLengthM,defaultSettings,maxLengthM,suggestedSpeed,STORAGE_KEY,isEventKind,type EventKind,type ShoulderMode,type SimEvent} from './events.js';
import {roadLaneInfo,rampLaneInfo} from './lane-info.js';
import {mapCandidates,chooseMapHits,closestJunction,lanePositions,hitLabel,type MapHit} from './selection.js';
import {buildContinuousRoads,lineWidths,along,rampBadges,overlaps,type Rectangle,type RampBadge} from './cartography.js';
import {DIRECTIONS,validateMap,names,mercator,inverse,nearestPolyline,type Point,type Road,type Ramp,type Exit} from './core.js';

const $=<T extends HTMLElement>(id:string)=>{const element=document.getElementById(id);if(!element)throw Error(`Element fehlt: ${id}`);return element as T;};
const canvas=$<HTMLCanvasElement>('map'),wrapper=canvas.parentElement!;
const context=canvas.getContext('2d');if(!context)throw Error('Canvas 2D wird nicht unterstützt');
const status=$('status'),hint=$('hint');
let focus:Point=[50.507,7.63],zoom=10,needsDraw=true;
const roadColors={'A3-koeln':'#26bb7c','A3-frankfurt':'#26bb7c','A48-dernbach':'#26bb7c','A48-koblenz':'#26bb7c'};
const mapReady=validateMap(networkData);const allRoads=networkData.roads,ramps=networkData.ramps,exits=networkData.exits;
const drawnRoads=buildContinuousRoads(allRoads);
const spatialCorridors=makeCorridors(allRoads,ramps);
const rampConnections=buildRampConnections(ramps,spatialCorridors);
let badges:RampBadge[]=[];
const pointerPositions=new Map<number,[number,number]>();let pointerDown:{x:number;y:number;at:number}|null=null;
let selected:MapHit|null=null;
let events:SimEvent[]=readStoredEvents();
let activeEventId:string|null=null;
let editingEventId:string|null=null;
let speedManuallyChanged=false;
let storageWarning='';
function readStoredEvents():SimEvent[]{try{return decodeEvents(window.localStorage.getItem(STORAGE_KEY))}catch{return []}}
function persistEvents(){try{window.localStorage.setItem(STORAGE_KEY,JSON.stringify(events));storageWarning='';}catch{storageWarning='Achtung: Dieser Browser speichert Ereignisse nicht dauerhaft.';}renderTraffic();}
function eventPathLabel(e:SimEvent):string{
 const ramp=ramps.find(r=>r.id===e.pathKey);
 return ramp?.name??(names[e.pathKey as keyof typeof names]||'Unbekannter Fahrweg');
}
function redrawEventList(){
 const parent=$('events-list');parent.replaceChildren();
 $('event-counter').textContent=`(${events.length})`;
 if(!events.length){const p=document.createElement('p');p.textContent='Noch keine Ereignisse gesetzt. Wähle einen Fahrbahnabschnitt auf der Karte.';parent.append(p);return;}
 for(const event of [...events].reverse()){
  const item=document.createElement('div');item.className='event-row';
  const title=document.createElement('strong'),meta=document.createElement('small'),jump=document.createElement('button');
  title.textContent=`${eventSymbols[event.kind]} ${eventNames[event.kind]} · ${eventPathLabel(event)}`;
  meta.textContent=eventSummary(event);
  jump.type='button';jump.textContent='Auf Karte ansehen';
  jump.onclick=()=>{focus=event.point;zoom=Math.max(zoom,14.4);showExistingEvent(event);refresh();};
  item.append(title,meta,jump);parent.append(item);
 }
}
function clearEventUi(){
 $('new-event-zone').hidden=true;$('event-form').hidden=true;$('existing-event').hidden=true;
 $('event-delete').textContent='Ereignis entfernen';$('event-delete').dataset.confirm='';$('event-form-error').textContent='';editingEventId=null;
}
function showExistingEvent(e:SimEvent){
 selected=null;activeEventId=e.id;clearEventUi();selectTrafficRoute(e.pathKey);
 $('selection-chooser').hidden=true;$('selected-fields').hidden=true;
 $('selection-help').hidden=true;
 $('selected-title').textContent=`${eventSymbols[e.kind]} ${eventNames[e.kind]}`;
 $('selected-note').textContent=eventPathLabel(e);
 $('existing-event-desc').textContent=`${eventSummary(e)} · ${e.point[0].toFixed(6)}° N, ${e.point[1].toFixed(6)}° E · ${new Date(e.createdAt).toLocaleString('de-DE')}`;
 $('existing-event').hidden=false;$('detail').hidden=false;
 hint.textContent=`${eventNames[e.kind]} ausgewählt – du kannst die Verkehrsführung bearbeiten oder das Ereignis entfernen.`;
 refresh();
}
function laneCountFor(hit:MapHit):number{
 const info=hit.kind==='ramp'?rampLaneInfo(hit.ramp,hit.point):roadLaneInfo(hit.road);
 return info.source==='unknown'?0:info.count;
}
function drawEventMarkers(width:number,height:number){
 for(const event of events){const [x,y]=toScreen(event.point);
  if(x < -20||y < -20||x>width+20||y>height+20)continue;
  const active=event.id===activeEventId;
  context!.beginPath();context!.arc(x,y,active?18:15,0,2*Math.PI);
  context!.fillStyle=active?'#0b4760':'#112638';context!.fill();
  context!.strokeStyle=active?'#39ddff':'#ffcb79';context!.lineWidth=active?3:2;context!.stroke();
  context!.font='18px system-ui,"Apple Color Emoji"';context!.textAlign='center';context!.textBaseline='middle';
  context!.fillText(eventSymbols[event.kind],x,y+1);
  context!.textAlign='start';context!.textBaseline='alphabetic';
 }
}
function formLaneCount():number{
 if(editingEventId)return events.find(e=>e.id===editingEventId)?.laneCount??0;
 return selected?laneCountFor(selected):0;
}
function formPathKey():string{
 if(editingEventId)return events.find(e=>e.id===editingEventId)?.pathKey??'';
 return selected?.key??'';
}
function chosenLanes():number[]{return Array.from(document.querySelectorAll<HTMLInputElement>('#event-lanes input:checked')).map(x=>Number(x.value))}
function currentShoulder():ShoulderMode{return $<HTMLSelectElement>('event-shoulder').value as ShoulderMode}
function renderEventLaneChoices(preset?:readonly number[]){
 const help=$('event-lane-help'),parent=$('event-lanes');
 const selectedBefore=preset??chosenLanes();parent.replaceChildren();
 const count=formLaneCount(),kind=$<HTMLSelectElement>('event-kind').value;
 if(!count){help.textContent='Fahrstreifenangabe ungeklärt – Ereignis hier vorerst nicht anlegbar.';return;}
 if(kind==='closure'){help.textContent=`Eigenständige Vollsperrung: alle ${count} regulären Fahrstreifen gesperrt.`;return;}
 help.textContent=`Reguläre Fahrstreifen sperren (${count} laut OSM; Standstreifen separat):`;
 lanePositions(count).forEach((name,i)=>{const row=document.createElement('label'),input=document.createElement('input'),label=document.createElement('span');
  input.type='checkbox';input.value=String(i);input.name='closed-lane';input.checked=selectedBefore.includes(i);label.textContent=name;
  input.addEventListener('change',()=>updateEventConfigPreview());row.append(input,label);parent.append(row);
 });
}
function updateEventConfigPreview(resetSpeed=false){
 const kind=$<HTMLSelectElement>('event-kind').value as EventKind;
 if(!isEventKind(kind))return;
 const count=formLaneCount(),closed=kind==='closure'?Array.from({length:count},(_,i)=>i):chosenLanes();
 const shoulder=$<HTMLSelectElement>('event-shoulder'),shoulderRow=$('event-shoulder-row');
 const isRamp=formPathKey().startsWith('ramp-');
 shoulderRow.hidden=isRamp;$('event-shoulder-note').hidden=isRamp;
 if(isRamp)shoulder.value='normal';
 if(kind==='closure'){shoulder.value='blocked';shoulder.disabled=true;}else shoulder.disabled=false;
 const mode=currentShoulder();
 const input=$<HTMLInputElement>('event-length');input.max=String(maxLengthM(kind));input.min='1';
 const length=Number(input.value);
 if(resetSpeed||!(length>=1&&length<=maxLengthM(kind)))input.value=String(defaultLengthM(kind));
 $('event-length-note').textContent=kind==='accident'||kind==='breakdown'
  ?'Punktuelles Ereignis: maximal 200 m.':kind==='roadworks'?'Baustellenabschnitt: bis 20 km einstellbar.':'Sperrabschnitt: bis 10 km einstellbar.';
 const speed=$<HTMLSelectElement>('event-speed');
 const suggested=suggestedSpeed(kind,count,closed,mode);
 if(resetSpeed||!speedManuallyChanged||suggested===0){speed.value=String(suggested);speedManuallyChanged=false;}
 speed.disabled=suggested===0;
 const zero=speed.querySelector<HTMLOptionElement>('option[value="0"]');if(zero)zero.disabled=suggested!==0;
 const open=Math.max(0,count-closed.length)+(mode==='open'?1:0);
 $('event-rule-hint').textContent=kind==='closure'
  ?'Vollsperrung: keine neuen Fahrzeuge in den Sperrabschnitt; bereits darin befindliche Fahrzeuge dürfen später ausfahren. Nachfolgender Verkehr wird künftig über zulässige Ausfahrten/Umleitungen geleitet. Noch keine Verkehrsberechnung.'
  :open===0?'Kein freier Fahrstreifen: derzeit kein Durchfluss. Ein Unfall ist trotzdem KEIN formales Vollsperrungs-Ereignis.'
  :`${open} nutzbare Fahrstreifen (davon ${mode==='open'?'1 Standstreifen':'0 Standstreifen'}). Geschwindigkeitsvorschlag ${suggested} km/h – frei anpassbar. Nur Simulationsannahme, keine StVO-Vorgabe.`;
}
function beginEventForm(){
 if(!selected)return;
 editingEventId=null;speedManuallyChanged=false;
 $('new-event-button').hidden=true;$('event-form').hidden=false;
 $<HTMLSelectElement>('event-kind').value='roadworks';
 $<HTMLSelectElement>('event-shoulder').value='normal';
 $<HTMLInputElement>('event-length').value='500';
 $('event-save').textContent='Ereignis setzen';
 $('event-form-error').textContent='';renderEventLaneChoices([]);updateEventConfigPreview(true);
}
function beginEditEvent(){
 const current=events.find(x=>x.id===activeEventId);if(!current)return;
 const id=current.id;
 clearEventUi();editingEventId=id;speedManuallyChanged=true;
 $('existing-event').hidden=true;$('new-event-zone').hidden=false;
 $('new-event-button').hidden=true;$('event-form').hidden=false;
 $('event-save').textContent='Änderungen speichern';
 $('event-form-error').textContent='';
 $<HTMLSelectElement>('event-kind').value=current.kind;
 $<HTMLSelectElement>('event-shoulder').value=current.settings.shoulder;
 $<HTMLInputElement>('event-length').value=String(current.settings.lengthM);
 renderEventLaneChoices(current.closedLanes);
 updateEventConfigPreview(false);
 $<HTMLSelectElement>('event-speed').value=String(current.settings.speedKmh);
}
function saveNewEvent(){
 const kind=$<HTMLSelectElement>('event-kind').value;
 if(!isEventKind(kind))return;
 const count=formLaneCount();
 const closed=chosenLanes();
 const settings={lengthM:Number($<HTMLInputElement>('event-length').value),speedKmh:Number($<HTMLSelectElement>('event-speed').value),shoulder:currentShoulder()};
 try{
  let entry:SimEvent;
  if(editingEventId){
   const current=events.find(e=>e.id===editingEventId);if(!current)throw Error('Zu bearbeitendes Ereignis nicht gefunden.');
   entry=updatedEvent(current,kind,closed,settings);
   events=events.map(e=>e.id===entry.id?entry:e);
  }else{
   if(!selected)throw Error('Wähle zuerst eine Fahrbahn.');
   const id=`ev-${Date.now()}-${Math.random().toString(36).slice(2,12)}`;
   entry=eventFromHit(selected,kind,count,closed,id,new Date().toISOString(),settings);
   if(events.length>=150)throw Error('Maximal 150 Ereignisse gleichzeitig möglich.');
   events=[...events,entry];
  }
  persistEvents();redrawEventList();showExistingEvent(entry);
  if(storageWarning)hint.textContent=storageWarning;
 }catch(e){$('event-form-error').textContent=e instanceof Error?e.message:'Ereignis konnte nicht gespeichert werden.';}
}
function removeExistingEvent(){
 const e=events.find(e=>e.id===activeEventId);if(!e)return;
 const button=$('event-delete');
 if(button.dataset.confirm!==e.id){button.dataset.confirm=e.id;button.textContent='Wirklich entfernen?';return;}
 events=events.filter(x=>x.id!==e.id);activeEventId=null;button.dataset.confirm='';persistEvents();redrawEventList();
 $('detail').hidden=true;hint.textContent=storageWarning||'Ereignis aus der Simulation entfernt.';refresh();
}


// Version 0.9: standalone macroscopic estimates, not live traffic measurements.
// No fabricated traffic transfers between A3, A48, and AD Dernbach ramps.

let spatialState=emptySpatial();
const trafficDemands=defaultDemands();
let demandMode:DemandMode='wave';
let trafficTimer:ReturnType<typeof setInterval>|null=null;
const trafficRouteLabel=(key:string)=>ramps.find(r=>r.id===key)?.name??(names[key as keyof typeof names]??key);
const trafficNumber=(n:number,digits=0)=>n.toLocaleString('de-DE',{maximumFractionDigits:digits,minimumFractionDigits:digits});
const trafficColorName:Record<TrafficColor,string>={free:'Frei',slow:'Stockend',jam:'Stau / Stop-and-Go',standstill:'Stillstand / gesperrt'};
function renderTraffic(){
 const selector=$<HTMLSelectElement>('traffic-route');const key=selector.value as PathKey;
 if(!PATHS.includes(key))return;
 const jams=jamsAt(spatialState,events,spatialCorridors);
 const spillbacks=rampSpillbacks(jams,rampConnections,spatialCorridors);
 const result=routeReport(key,jams,spillbacks,events);
 const bn=pathBottleneck(key,events);
 $('traffic-minute').textContent=`Minute ${spatialState.minute}`;
 const activeDemands=demandAtMinute(trafficDemands,spatialState.minute,demandMode);
 $('traffic-demand').textContent=trafficNumber(activeDemands[key]);
 $('traffic-demand-hint').textContent=demandMode==='wave'
  ?'Modellannahme: Die Stoßzeit klingt ab. Der tatsächliche Zufluss sinkt über ca. 100 Modellminuten; die Eingabe ist der Anfangszufluss.'
  :'Konstanter Zufluss. Bei mehr Ankünften als Engpasskapazität wächst die Warteschlange weiter.';
 $('traffic-capacity').textContent=trafficNumber(result.capacityVph);
 $('traffic-outflow').textContent=trafficNumber(Math.min(result.capacityVph,activeDemands[key]+result.ownVehicles*60));
 $('traffic-queue').textContent=trafficNumber(result.queueVehicles);
 $('traffic-shared').textContent=result.sharedRampVehicles>0?`Davon ${trafficNumber(result.sharedRampVehicles)} bereits in einer Rampenwarteschlange gezählte Fahrzeuge`:'Keine Rampenfahrzeuge auf diesem Abschnitt';
 $('traffic-queue-km').textContent=`${trafficNumber(result.queueKm,2)} km`;
 $('traffic-delay').textContent=result.delayMin===null?'Bei Stillstand nicht berechenbar':`${trafficNumber(result.delayMin,1)} min`;
 $('traffic-speed').textContent=result.color!=='free'&&!bn.event?'variiert (Rückstau)':`${bn.speedKmh} km/h`;
 $('traffic-events').textContent=bn.count===0?'Kein eigenes Ereignis auf dieser Richtung – mögliche Rückstauübertragung am AD wird berücksichtigt':
  `${bn.count} eigene(s) Ereignis(se) auf dieser Richtung`;
 const stateLabel=$('traffic-state');stateLabel.textContent=trafficColorName[result.color];stateLabel.className=`traffic-state ${result.color}`;
 $('traffic-closure-note').textContent=bn.event?.kind==='closure'?'Vollsperrung: kein neuer Zufluss in den Sperrabschnitt. Offizielle Umleitung und Ausfahrt bereits eingeschlossener Fahrzeuge werden noch NICHT simuliert. Die hier gezeigte Warteschlange ist vorläufiger, auflaufender Verkehr vor der Sperrung.':'';
 const mergeQueues=jams.filter(j=>j.id.startsWith('merge:')&&!j.released);
 const overflowText=spillbacks.map(s=>`${trafficRouteLabel(s.rampId)}: ${trafficNumber(s.lengthM/1000,2)} km Rückstau auf ${trafficRouteLabel(s.source)}`).join(' · ');
 const mergeText=mergeQueues.map(x=>`${trafficRouteLabel(x.pathKey)}: ${trafficNumber(x.queueVehicles)} Fahrzeuge warten wegen Rückstau an der Einmündung`).join(' · ');
 $('traffic-interchange').textContent=[overflowText,mergeText].filter(Boolean).join(' · ')||'AD Dernbach: Kein Rückstau reicht derzeit von einer Rampe auf A3/A48 oder von einer Zielautobahn in eine Rampe zurück.';
 const parent=$('traffic-summary');parent.replaceChildren();
 for(const item of PATHS){const m=routeReport(item,jams,spillbacks,events);
  const button=document.createElement('button');button.type='button';button.className='traffic-summary-row';
  const label=document.createElement('span');label.textContent=trafficRouteLabel(item);
  const status=document.createElement('strong');status.className=`traffic-state ${m.color}`;
  status.textContent=`${trafficNumber(m.queueKm,1)} km · ${m.delayMin===null?'Zeit unbestimmt':trafficNumber(m.delayMin,1)+' min'}`;
  button.append(label,status);button.setAttribute('aria-label',`${label.textContent}, ${status.textContent}`);
  button.onclick=()=>selectTrafficRoute(item);parent.append(button);
 }
  const container=$('traffic-jams');container.replaceChildren();
  $('traffic-jams-count').textContent=`(${jams.length})`;
  if(jams.length===0){const p=document.createElement('p');p.textContent='Noch kein Rückstau an einem gesetzten Ereignis. Stau entsteht erst, wenn der Zufluss die Kapazität übersteigt.';container.append(p);}
  for(const jam of jams){
   const row=document.createElement('button');row.type='button';row.className='traffic-summary-row';
   const title=document.createElement('span'),event=events.find(e=>e.id===jam.id);
   title.textContent=`${trafficRouteLabel(jam.pathKey)} · ${jam.released?'Rückstau löst sich auf':jam.id.startsWith('merge:')?'Rückstau von Zielautobahn':jam.id.startsWith('spill:')?'Rampenstau beeinträchtigt Ausfahrt':event?eventNames[event.kind]:'Engpass'}`;
   const value=document.createElement('strong');value.className=`traffic-state ${jam.color}`;
   value.textContent=`${trafficNumber(jam.queueM/1000,2)} km · ${jam.delayMin===null?'Zeit unbestimmt':trafficNumber(jam.delayMin,1)+' min'}`;
   const overflow=spillbacks.find(s=>s.id===jam.id&&s.rampId===jam.pathKey);
   if(overflow){const extra=document.createElement('small');extra.textContent=`↳ Reicht ${trafficNumber(overflow.lengthM/1000,2)} km auf ${trafficRouteLabel(overflow.source)} zurück`;title.append(document.createElement('br'),extra)}
   row.append(title,value);
   row.onclick=()=>{focus=overflow?ramps.find(r=>r.id===overflow.rampId)!.points[0]!:jam.point;zoom=Math.max(zoom,14);refresh();};container.append(row);
  }
  refresh();
}
function selectTrafficRoute(path:string){
 if(!PATHS.includes(path as PathKey))return;
 const key=path as PathKey;
 $<HTMLSelectElement>('traffic-route').value=key;
 $<HTMLInputElement>('traffic-inflow').value=String(trafficDemands[key]);
 renderTraffic();
}
function stopTraffic(){if(trafficTimer!==null){clearInterval(trafficTimer);trafficTimer=null;}$('traffic-play').textContent='▶ Start';}
function stepTraffic(minutes:number){
 try{
  for(let i=0;i<minutes;i++){
   const active=demandAtMinute(trafficDemands,spatialState.minute,demandMode);
   spatialState=advanceSpatial(spatialState,events,active,1,spatialCorridors,rampConnections);
  }
  renderTraffic();
 }
 catch(e){stopTraffic();$('traffic-issue').textContent=e instanceof Error?e.message:'Simulationsfehler';}
}
function initializeTraffic(){
 const select=$<HTMLSelectElement>('traffic-route');select.replaceChildren();
 for(const key of PATHS){const option=document.createElement('option');option.value=key;option.textContent=trafficRouteLabel(key);select.append(option)}
 select.value='A3-koeln';selectTrafficRoute(select.value);
 select.addEventListener('change',()=>selectTrafficRoute(select.value));
 const pattern=$<HTMLSelectElement>('traffic-demand-mode');
 pattern.value=demandMode;
 pattern.addEventListener('change',()=>{
  demandMode=pattern.value==='constant'?'constant':'wave';
  renderTraffic();
 });
 const input=$<HTMLInputElement>('traffic-inflow');
 input.addEventListener('change',()=>{
  const val=Number(input.value),key=select.value as PathKey;
  if(!Number.isInteger(val)||val<0||val>8000){$('traffic-issue').textContent='Zufluss: nur ganze Zahlen zwischen 0 und 8.000 Fahrzeugen/h.';input.value=String(trafficDemands[key]);return;}
  $('traffic-issue').textContent='';trafficDemands[key]=val;renderTraffic();
 });
 $('traffic-play').onclick=()=>{
  if(trafficTimer!==null){stopTraffic();return;}
  $('traffic-play').textContent='⏸ Pause';
  trafficTimer=setInterval(()=>stepTraffic(1),1000);
 };
 $('traffic-step').onclick=()=>stepTraffic(5);
 $('traffic-reset').onclick=()=>{stopTraffic();spatialState=emptySpatial();renderTraffic();};
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopTraffic();});
}

const imageCache=new Map<string,{image:HTMLImageElement;ready:boolean;failed:boolean}>();
const size=()=>{const width=wrapper.clientWidth,height=wrapper.clientHeight,scale=Math.min(2,window.devicePixelRatio||1);if(canvas.width!==Math.floor(width*scale)||canvas.height!==Math.floor(height*scale)){canvas.width=Math.floor(width*scale);canvas.height=Math.floor(height*scale);}return {width,height,scale};};
function toScreen(p:Point):[number,number]{const mid=mercator(focus,zoom),v=mercator(p,zoom);return [wrapper.clientWidth/2+v[0]-mid[0],wrapper.clientHeight/2+v[1]-mid[1]];}
function fromScreen(x:number,y:number):Point{const mid=mercator(focus,zoom);return inverse([mid[0]+x-wrapper.clientWidth/2,mid[1]+y-wrapper.clientHeight/2],zoom);}
let frame=0;
const refresh=()=>{needsDraw=true;if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(needsDraw){needsDraw=false;draw();}});};
function fit(){
 activeEventId=null;selected=null;$('detail').hidden=true;
 const all=[...allRoads.flatMap(r=>r.points),...ramps.flatMap(r=>r.points)];
 const latMin=Math.min(...all.map(p=>p[0])),latMax=Math.max(...all.map(p=>p[0]));
 const lonMin=Math.min(...all.map(p=>p[1])),lonMax=Math.max(...all.map(p=>p[1]));
 const center:Point=[(latMin+latMax)/2,(lonMin+lonMax)/2];
 const {width,height}=size();zoom=8;
 for(let z=13;z>=8;z-=.08){let p1=mercator([latMin,lonMin],z),p2=mercator([latMax,lonMax],z);if(Math.abs(p1[0]-p2[0])<width*.86&&Math.abs(p1[1]-p2[1])<height*.79){zoom=z;break;}}
 focus=center;refresh();
}
function drawTiles(width:number,height:number){
 const tileZoom=Math.floor(zoom),factor=2**(zoom-tileZoom),dim=256*factor;
 const center=mercator(focus,zoom),left=center[0]-width/2,top=center[1]-height/2;
 const firstX=Math.floor(left/dim),lastX=Math.floor((left+width)/dim),firstY=Math.max(0,Math.floor(top/dim)),lastY=Math.floor((top+height)/dim);
 for(let y=firstY;y<=lastY;y++)for(let x=firstX;x<=lastX;x++){
  const n=2**tileZoom;if(y>=n)continue;const xt=((x%n)+n)%n,key=`${tileZoom}/${xt}/${y}`;
  let rec=imageCache.get(key);
  if(!rec){const img=new Image();rec={image:img,ready:false,failed:false};const local=rec;
    img.onload=()=>{local.ready=true;refresh()};img.onerror=()=>{local.failed=true;refresh()};img.referrerPolicy='no-referrer';img.src=`https://tile.openstreetmap.org/${key}.png`;imageCache.set(key,rec);
  }
  if(rec.ready)context!.drawImage(rec.image,x*dim-left,y*dim-top,dim+.6,dim+.6);
 }
 if(imageCache.size>320){for(const key of [...imageCache.keys()].slice(0,90))imageCache.delete(key)}
}
function stroke(points:Point[],width:number,color:string){
 if(points.length<2)return;
 context!.beginPath();for(let i=0;i<points.length;i++){const [x,y]=toScreen(points[i]!);if(i===0)context!.moveTo(x,y);else context!.lineTo(x,y)}
 context!.strokeStyle=color;context!.lineWidth=width;context!.lineJoin='round';context!.lineCap='round';context!.stroke();
}
function plotLabels(width:number,height:number){
 if(zoom<11)return;
 const labels:Rectangle[]=[];
 const sorted=[...exits].sort((a,b)=>{
  const pa=toScreen(a.position),pb=toScreen(b.position);
  return Math.hypot(pa[0]-width/2,pa[1]-height/2)-Math.hypot(pb[0]-width/2,pb[1]-height/2);
 });
 for(const exit of sorted){const [x,y]=toScreen(exit.position);if(x<14||x>width-14||y<55||y>height-44)continue;
  context!.beginPath();context!.arc(x,y,3.4,0,2*Math.PI);context!.fillStyle='#09283d';context!.fill();context!.strokeStyle='#f3f8fc';context!.lineWidth=1.3;context!.stroke();
  if(zoom<12.1)continue;
  const label=`${exit.road} ${exit.ref} · ${exit.name}`;context!.font='600 11px system-ui';const wide=context!.measureText(label).width;
  const choices:Rectangle[]=[
   {x:x+8,y:y-23,w:wide+10,h:17},{x:x+8,y:y+7,w:wide+10,h:17},
   {x:x-wide-18,y:y-23,w:wide+10,h:17},{x:x-wide-18,y:y+7,w:wide+10,h:17}
  ];
  const box=choices.find(b=>b.x>=6&&b.x+b.w<=width-6&&b.y>=56&&b.y+b.h<=height-46&&!labels.some(used=>overlaps(b,used)));
  if(!box)continue;
  labels.push(box);context!.fillStyle='#0a2236e8';context!.fillRect(box.x,box.y,box.w,box.h);
  context!.strokeStyle='#3d657a';context!.strokeRect(box.x,box.y,box.w,box.h);
  context!.fillStyle='#fff';context!.fillText(label,box.x+5,box.y+12);
 }
}
function plotRampBadges(width:number,height:number){
 badges=zoom>=13.2?rampBadges(ramps,toScreen,{width,height}):[];
 for(const badge of badges){const [x,y]=badge.screen,[bx,by]=badge.bubble;
  context!.beginPath();context!.moveTo(x,y);context!.lineTo(bx,by);context!.strokeStyle='#e8b065';context!.lineWidth=1.5;context!.stroke();
  context!.beginPath();context!.arc(bx,by,12.5,0,2*Math.PI);context!.fillStyle='#674115';context!.fill();
  context!.strokeStyle='#ffcd7e';context!.lineWidth=1.6;context!.stroke();
  context!.fillStyle='#fff';context!.font='bold 12px system-ui';context!.textAlign='center';context!.textBaseline='middle';context!.fillText(String(badge.number),bx,by+1);
  context!.textAlign='start';context!.textBaseline='alphabetic';
 }
}
const jamColors={slow:'#f59e0b',jam:'#dc2626',standstill:'#7f1d1d'} as const;
function drawSpatialJams(){
 const list=jamsAt(spatialState,events,spatialCorridors);
 // Storage on a congested ramp can overflow onto its VERIFIED feeder mainline.
 // This colored mainline segment is not a second set of queued vehicles.
 const spillbacks=rampSpillbacks(list,rampConnections,spatialCorridors);
 for(const spill of spillbacks){
  const route=spatialCorridors[spill.source];
  const length=spill.toM-spill.fromM;
  if(length<1)continue;
  const tail=Math.min(length*.25,Math.max(60,length*.12));
  const split=Math.min(spill.toM,spill.fromM+tail);
  for(const [start,end,color] of [[spill.fromM,split,'slow'],[split,spill.toM,spill.color==='standstill'?'jam':spill.color]] as const){
   const line=routeSlice(route,start,end);
   if(line.length>1){stroke(line,lineWidths(zoom).motorwayCasing+1,'#102735');stroke(line,lineWidths(zoom).motorway+1.1,jamColors[color==='free'?'slow':color]);}
  }
 }
 // No purely cosmetic downstream-merge overlay: a blocked ramp gets its
 // own real queue in advanceSpatial(), rendered with the same jamBands() below.
 // Colored paths are exact OSM segments immediately UPSTREAM of each bottleneck.
 for(const jam of list){
  const road=spatialCorridors[jam.pathKey];
  for(const band of jamBands(jam)){
   const line=routeSlice(road,band.fromM,band.toM);
   if(line.length>1){stroke(line,lineWidths(zoom).motorwayCasing+1,'#102735');stroke(line,lineWidths(zoom).motorway+1.1,jamColors[band.color]);}
  }
 }
  if(zoom<10.6)return;
 for(const jam of list){
  const road=spatialCorridors[jam.pathKey];
  const midM=Math.max(0,jam.anchorM-jam.visibleQueueM*.5);
  const mid=routeSlice(road,midM-1,midM+1);
  if(!mid.length)continue;
  const [x,y]=toScreen(mid[0]!);if(x<8||x>wrapper.clientWidth-75||y<54||y>wrapper.clientHeight-63)continue;
  const txt=jam.delayMin===null?'🚗🚗 gesperrt':`🚗🚗 +${trafficNumber(jam.delayMin,1)} min`;
  context!.font='bold 11px system-ui';const w=context!.measureText(txt).width+16;
  context!.fillStyle='#0a1c2bef';context!.fillRect(x,y-23,w,20);
  context!.fillStyle='#fff';context!.fillText(txt,x+8,y-9);
 }
}
function draw(){
 const {width,height,scale}=size();context!.setTransform(scale,0,0,scale,0,0);
 context!.fillStyle='#132b3d';context!.fillRect(0,0,width,height);
 drawTiles(width,height);
 // Exact OSM node-connected chains eliminate thick end caps at ordinary way boundaries.
 // Zoom-adaptive outlines keep both carriageways visually distinct on narrow screens.
 const lines=lineWidths(zoom);
 for(const road of drawnRoads)stroke(road.points,lines.motorwayCasing,'#083348');
 for(const road of drawnRoads)stroke(road.points,lines.motorway,roadColors[road.road]);
 for(const ramp of ramps)stroke(ramp.points,lines.rampCasing,'#273b4c');
 for(const ramp of ramps)stroke(ramp.points,lines.ramp,'#26bb7c');
 drawSpatialJams();
 plotLabels(width,height);plotRampBadges(width,height);drawEventMarkers(width,height);
 if(selected){const [x,y]=toScreen(selected.point);context!.beginPath();context!.arc(x,y,9,0,2*Math.PI);context!.fillStyle='#39d7ff';context!.fill();context!.lineWidth=2;context!.strokeStyle='#fff';context!.stroke();}
}
function focusOn(place:Point,z=13){activeEventId=null;selected=null;$('detail').hidden=true;focus=place;zoom=z;refresh()}
function showSelected(hit:MapHit){
 activeEventId=null;clearEventUi();selected=hit;selectTrafficRoute(hit.key);refresh();
 $('selection-chooser').hidden=true;
 $('new-event-zone').hidden=false;$('new-event-button').hidden=false;
 $('selected-fields').hidden=false;
 $('selection-help').hidden=false;
 $('selected-title').textContent=hitLabel(hit);
 $('selected-note').textContent=hit.kind==='ramp'
  ? 'Überleitung am AD Dernbach – vom OSM-Fahrbahnverlauf ausgewählt.'
  : `Fahrtrichtung eindeutig zugeordnet · OSM-Way ${hit.road.wayId}`;
 $('selected-direction').textContent=hitLabel(hit);
 $('selected-coords').textContent=`${hit.point[0].toFixed(6)}° N · ${hit.point[1].toFixed(6)}° E`;
 const details=routeReport(hit.key as PathKey,jamsAt(spatialState,events,spatialCorridors),rampSpillbacks(jamsAt(spatialState,events,spatialCorridors),rampConnections,spatialCorridors),events);
 $('selected-traffic').textContent=`${trafficNumber(details.queueVehicles)} Fahrzeuge auf diesem Fahrweg · ${details.delayMin===null?'Zeitverlust unbestimmt':`+${trafficNumber(details.delayMin,1)} min`}`;
 const lane=hit.kind==='ramp'?rampLaneInfo(hit.ramp,hit.point):roadLaneInfo(hit.road);
 $('selected-lanes').textContent=lane.label;
 $('selected-lane-names').textContent=lanePositions(lane.count).join(' · ')||'Keine gesicherte Fahrstreifenaufteilung';
 if(lane.source!=='osm')$('selected-note').textContent+=' · Fahrstreifenangabe nicht aktuell verifiziert.';
 const junction=closestJunction(hit,exits);
 $('selected-junction').textContent=hit.kind==='ramp'
  ? 'AD Dernbach (A3 39 / A48 13)'
  : junction?`${junction.exit.road} ${junction.exit.ref} ${junction.exit.name} · ca. ${junction.distanceKm.toFixed(1).replace('.',',')} km Luftlinie`:'Nicht zugeordnet';
 $('detail').hidden=false;
 hint.textContent='Fahrbahn ausgewählt. Du kannst ein Simulator-Ereignis anlegen.';
}
function selectAt(x:number,y:number){
 const picked=[...events].reverse().find(e=>{const p=toScreen(e.point);return Math.hypot(p[0]-x,p[1]-y)<=18});
 if(picked){showExistingEvent(picked);return;}
 // Ramp badges are independent explicit controls, not generic near-road guesses.
 const badge=badges.find(b=>Math.hypot(b.bubble[0]-x,b.bubble[1]-y)<=17);
 if(badge){
  const snapped=mapCandidates([], [badge.ramp],toScreen(badge.point),toScreen,2)[0];
  if(snapped)showSelected(snapped);
  return;
 }
 const nearby=mapCandidates(allRoads,ramps,[x,y],toScreen,zoom<10.5?12:18);
 const options=chooseMapHits(nearby);
 if(!options.length){hint.textContent='Keine A3-/A48-Fahrbahn oder Rampe getroffen. Zoome näher heran.';return;}
 if(options.length===1){showSelected(options[0]!);return;}
 selected=null;activeEventId=null;clearEventUi();refresh();
 $('selected-title').textContent='Fahrtrichtung auswählen';
 $('selected-note').textContent='Mehrere Fahrbahnen oder Rampen liegen hier dicht beieinander. Wähle den richtigen Verkehrsweg:';
 $('selected-fields').hidden=true;
 $('selection-help').hidden=true;
 const parent=$('selection-options');parent.replaceChildren();
 for(const option of options){
  const button=document.createElement('button');button.type='button';button.className='direction-choice';
  button.textContent=hitLabel(option);
  button.onclick=()=>showSelected(option);
  parent.append(button);
 }
 $('selection-chooser').hidden=false;
 $('detail').hidden=false;
 hint.textContent='Mehrere Fahrtrichtungen am Fingertipp: bitte unten eindeutig auswählen.';
}
function makeExitButtons(){const parent=$('junctions');parent.replaceChildren();
 const sorted=[...exits].sort((a,b)=>a.road===b.road?(a.road==='A3'?Number(b.ref)-Number(a.ref):Number(a.ref)-Number(b.ref)):a.road==='A3'?-1:1);
 for(const exit of sorted){const button=document.createElement('button');const heading=document.createElement('span');heading.textContent=`${exit.road} · ${exit.ref}`;
  button.append(heading,document.createTextNode(exit.name));button.addEventListener('click',()=>{focusOn(exit.position,13.8);hint.textContent=`${exit.road} AS/Knoten ${exit.ref} – ${exit.name}. Tippe auf die zugehörige Fahrbahn.`;});parent.append(button);
 }
}
function fillMetrics(){const parent=$('metrics');parent.replaceChildren();
 for(const dir of DIRECTIONS){const card=document.createElement('div');card.className='metric';const title=document.createElement('small'),amount=document.createElement('strong');
  title.textContent=names[dir];amount.textContent=`${allRoads.filter(r=>r.road===dir).reduce((sum,r)=>sum+r.km,0).toFixed(1)} km Fahrbahn`;card.append(title,amount);parent.append(card);
 }
}
function bind(){
 $('fit').onclick=()=>fit();$('dernbach').onclick=()=>focusOn([50.460264,7.767549],14.2);
 for(const [id,road,ref] of [['koblenz','A48','9'],['diez','A3','41'],['limburg-nord','A3','42'],['limburg-sued','A3','43'],['honnef','A3','34']]){
  $(id!).onclick=()=>{const exit=exits.find(e=>e.road===road&&e.ref===ref);if(exit)focusOn(exit.position,13.8)};
 }
 $('plus').onclick=()=>{zoom=Math.min(17,zoom+1);refresh()};$('minus').onclick=()=>{zoom=Math.max(8,zoom-1);refresh()};
 $('close').onclick=()=>{$('detail').hidden=true;$('event-delete').dataset.confirm='';};
 $('new-event-button').onclick=beginEventForm;
 $('event-cancel').onclick=()=>{const current=events.find(e=>e.id===editingEventId);if(current){showExistingEvent(current);}else{$('event-form').hidden=true;$('new-event-button').hidden=false;}};
 $('event-kind').addEventListener('change',()=>{renderEventLaneChoices();updateEventConfigPreview(true)});
 $('event-shoulder').addEventListener('change',()=>updateEventConfigPreview());
 $('event-speed').addEventListener('change',()=>{speedManuallyChanged=true;updateEventConfigPreview()});
 $('event-edit').onclick=beginEditEvent;
 $('event-save').onclick=saveNewEvent;
 $('event-delete').onclick=removeExistingEvent;
 canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);pointerPositions.set(e.pointerId,[e.clientX,e.clientY]);if(pointerPositions.size===1)pointerDown={x:e.clientX,y:e.clientY,at:performance.now()};else pointerDown=null});
 canvas.addEventListener('pointermove',e=>{const last=pointerPositions.get(e.pointerId);if(!last)return;
  const current:[number,number]=[e.clientX,e.clientY];pointerPositions.set(e.pointerId,current);
  if(pointerPositions.size===1){const pivot=mercator(focus,zoom);focus=inverse([pivot[0]-(current[0]-last[0]),pivot[1]-(current[1]-last[1])],zoom);refresh();}
  else if(pointerPositions.size===2){const other=[...pointerPositions.entries()].find(([id])=>id!==e.pointerId)?.[1];if(!other)return;
   const old=Math.hypot(last[0]-other[0],last[1]-other[1]),next=Math.hypot(current[0]-other[0],current[1]-other[1]);if(old>2){zoom=Math.max(8,Math.min(17,zoom+Math.log2(next/old)));refresh();}
  }
 });
 canvas.addEventListener('pointerup',e=>{pointerPositions.delete(e.pointerId);if(pointerDown&&pointerPositions.size===0&&performance.now()-pointerDown.at<650&&Math.hypot(e.clientX-pointerDown.x,e.clientY-pointerDown.y)<8){const bound=canvas.getBoundingClientRect();selectAt(e.clientX-bound.left,e.clientY-bound.top)}if(pointerPositions.size===0)pointerDown=null;});
 canvas.addEventListener('pointercancel',e=>{pointerPositions.delete(e.pointerId);pointerDown=null});
 canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(8,Math.min(17,zoom+(e.deltaY<0?.4:-.4)));refresh()},{passive:false});
 window.addEventListener('resize',refresh);
}
function start(){if(!mapReady.valid){status.classList.add('error');status.textContent='Geodatenprüfung fehlgeschlagen';hint.textContent=mapReady.errors.join(' · ');return;}
 fillMetrics();makeExitButtons();bind();initializeTraffic();redrawEventList();fit();status.textContent=`✓ ${allRoads.length} OSM-Fahrbahnstücke · ${drawnRoads.length} durchgehende Zeichenlinien · 4 AD-Rampen · ${exits.length} Anschlussstellen`;
 refresh();
}
start();
