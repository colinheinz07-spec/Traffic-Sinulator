import {networkData} from './geodata.js';
import {DIRECTIONS,validateMap,names,mercator,inverse,nearestPolyline,type Point,type Road,type Ramp,type Exit} from './core.js';

const $=<T extends HTMLElement>(id:string)=>{const element=document.getElementById(id);if(!element)throw Error(`Element fehlt: ${id}`);return element as T;};
const canvas=$<HTMLCanvasElement>('map'),wrapper=canvas.parentElement!;
const context=canvas.getContext('2d');if(!context)throw Error('Canvas 2D wird nicht unterstützt');
const status=$('status'),hint=$('hint');
let focus:Point=[50.507,7.63],zoom=10,needsDraw=true;
const roadColors={'A3-koeln':'#26bb7c','A3-frankfurt':'#26bb7c','A48-dernbach':'#2bc9c5','A48-koblenz':'#2bc9c5'};
const mapReady=validateMap(networkData);const allRoads=networkData.roads,ramps=networkData.ramps,exits=networkData.exits;
const pointerPositions=new Map<number,[number,number]>();let pointerDown:{x:number;y:number;at:number}|null=null;
let selected:{road?:Road;ramp?:Ramp;point:Point;distance:number}|null=null;
const imageCache=new Map<string,{image:HTMLImageElement;ready:boolean;failed:boolean}>();
const size=()=>{const width=wrapper.clientWidth,height=wrapper.clientHeight,scale=Math.min(2,window.devicePixelRatio||1);if(canvas.width!==Math.floor(width*scale)||canvas.height!==Math.floor(height*scale)){canvas.width=Math.floor(width*scale);canvas.height=Math.floor(height*scale);}return {width,height,scale};};
function toScreen(p:Point):[number,number]{const mid=mercator(focus,zoom),v=mercator(p,zoom);return [wrapper.clientWidth/2+v[0]-mid[0],wrapper.clientHeight/2+v[1]-mid[1]];}
function fromScreen(x:number,y:number):Point{const mid=mercator(focus,zoom);return inverse([mid[0]+x-wrapper.clientWidth/2,mid[1]+y-wrapper.clientHeight/2],zoom);}
const refresh=()=>{needsDraw=true;};
function fit(){
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
 if(zoom<10.6)return;
 for(const exit of exits){const [x,y]=toScreen(exit.position);if(x<15||x>width-15||y<20||y>height-15)continue;
  context!.beginPath();context!.arc(x,y,3,0,Math.PI*2);context!.fillStyle='#082237';context!.fill();context!.strokeStyle='#fff';context!.lineWidth=1.2;context!.stroke();
  if(zoom>=11.6){const label=`${exit.road} ${exit.ref} · ${exit.name}`;context!.font='600 10px system-ui';const wide=context!.measureText(label).width;
   context!.fillStyle='#0a2236ef';context!.fillRect(x-4,y-20,wide+11,15);context!.fillStyle='#fff';context!.fillText(label,x+2,y-9);}
 }
}
function draw(){
 const {width,height,scale}=size();context!.setTransform(scale,0,0,scale,0,0);
 context!.fillStyle='#132b3d';context!.fillRect(0,0,width,height);
 drawTiles(width,height);
 // Two passes: casing before colored line prevents adjacent carriageways from hiding the data.
 for(const road of allRoads)stroke(road.points,6.4,'#073347');
 for(const road of allRoads)stroke(road.points,4.5,roadColors[road.road]);
 for(const ramp of ramps)stroke(ramp.points,8,'#173247');
 for(const ramp of ramps)stroke(ramp.points,5,'#ffb455');
 plotLabels(width,height);
 if(selected){const [x,y]=toScreen(selected.point);context!.beginPath();context!.arc(x,y,9,0,2*Math.PI);context!.fillStyle='#39d7ff';context!.fill();context!.lineWidth=2;context!.strokeStyle='#fff';context!.stroke();}
}
function loop(){if(needsDraw){needsDraw=false;draw()}requestAnimationFrame(loop)}
function focusOn(place:Point,z=13){focus=place;zoom=z;refresh()}
function selectAt(x:number,y:number){
 let best:{road?:Road;ramp?:Ramp;point:Point;distance:number}|null=null;
 const candidate=(points:Point[],target:{road?:Road;ramp?:Ramp})=>{const hit=nearestPolyline(points,[x,y],toScreen);if(hit.distance>19||(best&&hit.distance>=best.distance))return;best={...target,point:hit.point,distance:hit.distance};};
 // Check ramps first (independent event locations), then mainlines, choosing the closer one.
 for(const ramp of ramps)candidate(ramp.points,{ramp});
 for(const road of allRoads)candidate(road.points,{road});
 if(!best){hint.textContent='Kein Autobahnabschnitt am Tipp-Punkt. Zoome näher an die Fahrbahn.';return;}
 selected=best;refresh();
 const found=best as {road?:Road;ramp?:Ramp;point:Point;distance:number};
 $('selected-title').textContent=found.ramp?.name ?? names[found.road!.road];
 $('selected-note').textContent=found.ramp?'Verbindungsrampe am AD Dernbach – separat auswählbar.':`A3/A48-Fahrbahnabschnitt · OSM-Way ${found.road!.wayId}`;
 $('selected-coords').textContent=`${found.point[0].toFixed(6)}° N · ${found.point[1].toFixed(6)}° E`;
 $('selected-lanes').textContent=String(found.ramp?.lanes ?? found.road!.lanes);
 $('detail').hidden=false;
 hint.textContent='Fahrbahnposition ausgewählt. Die Ereignisfunktion kommt nach der Kartenfreigabe.';
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
 $('close').onclick=()=>{$('detail').hidden=true};
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
 fillMetrics();makeExitButtons();bind();fit();status.textContent=`✓ ${allRoads.length} echte Autobahnabschnitte · 4 Rampen · ${exits.length} Anschlüsse`;
 requestAnimationFrame(loop);
}
start();
