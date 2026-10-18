export type Point = [number, number]; // [latitude, longitude]
export type RoadId = 'A3-koeln'|'A3-frankfurt'|'A48-dernbach'|'A48-koblenz';
export type Road = {id:string;wayId:number;road:RoadId;lanes:number;km:number;posKm:number;points:Point[];tags?:Record<string,string>};
export type Ramp = {id:string;name:string;from:RoadId;to:RoadId;lanes:number;wayIds:number[];points:Point[]};
export type Exit = {road:'A3'|'A48';ref:string;name:string;position:Point;source:string};
export type MapData={version:number;source:string;created:string;roads:Road[];ramps:Ramp[];exits:Exit[];coverage:Record<RoadId,number>;audit:{complete:boolean;notes:string[];ways:number}};
export const DIRECTIONS:RoadId[]=['A3-koeln','A3-frankfurt','A48-dernbach','A48-koblenz'];
export const names:Record<RoadId,string>={'A3-koeln':'A3 Richtung Köln','A3-frankfurt':'A3 Richtung Frankfurt','A48-dernbach':'A48 Richtung Dernbach','A48-koblenz':'A48 Richtung Koblenz'};
export const exitRefs={A3:['34','35','36','37','38','39','40','41','42','43'],A48:['9','10','11','12','13']};
export function validateMap(data:MapData):{valid:boolean;errors:string[]}{
 const errors:string[]=[];
 if(data.version!==2||!data.audit?.complete)errors.push('Datensatz nicht freigegeben');
 if(data.roads.length<300)errors.push('Zu wenige geprüfte Straßenstücke');
 for(const id of DIRECTIONS){
  const rs=data.roads.filter(r=>r.road===id);
  if(rs.length<35)errors.push('Fahrtrichtung unvollständig: '+id);
  if((data.coverage[id]??0)<0.98)errors.push('Geometrieabdeckung ungenügend: '+id);
 }
 const keys=new Set(data.exits.map(e=>e.road+':'+e.ref));
 for(const [name,refs] of Object.entries(exitRefs))for(const n of refs)if(!keys.has(`${name}:${n}`))errors.push('Anschluss fehlt: '+name+'/'+n);
 const routes=new Set(data.ramps.map(r=>r.from+'>'+r.to));
 if(data.ramps.length!==4||routes.size!==4)errors.push('Vier eindeutige Dernbach-Rampen erforderlich');
 for(const road of ['A3-frankfurt','A3-koeln'] as const){
  const added=data.roads.filter(r=>r.road===road && r.posKm<0);
  if(added.length<8 || added.reduce((sum,r)=>sum+r.km,0)<9 || !added.some(r=>r.points.some(p=>p[1]>8.085&&p[0]<50.399)))errors.push('A3 bis Limburg-Süd unvollständig: '+road);
 }
 for(const r of data.roads){if(!r.points || r.points.length<2||r.lanes<1||r.km<=0)errors.push('Straßenabschnitt ungültig: '+r.id);
  else if(!r.tags?.ref?.replaceAll(' ','').includes(r.road.startsWith('A3-')?'A3':'A48'))errors.push('Fremde Straße: '+r.id);
 }
 for(const ramp of data.ramps)if(ramp.points.length<12 || ramp.wayIds.length<2)errors.push('Rampengeometrie fehlt: '+ramp.id);
 return{valid:errors.length===0,errors};
}
export function mercator(p:Point,z:number):[number,number]{
 const sin=Math.sin(Math.max(-85,Math.min(85,p[0]))*Math.PI/180),scale=256*2**z;
 return[(p[1]+180)/360*scale,(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*scale];
}
export function inverse(p:[number,number],z:number):Point{
 const size=256*2**z;const lon=p[0]/size*360-180;const n=Math.PI-2*Math.PI*p[1]/size;
 return[Math.atan(Math.sinh(n))*180/Math.PI,lon];
}
export function nearestPolyline(points:Point[],pixel:[number,number],project:(p:Point)=>[number,number]){
 let best={distance:Infinity,point:points[0]!,fraction:0};let cumulative=0;
 const pix=points.map(project);let total=0;const ds:number[]=[];
 for(let i=1;i<pix.length;i++){const a=pix[i-1]!,b=pix[i]!;const d=Math.hypot(b[0]-a[0],b[1]-a[1]);ds.push(d);total+=d;}
 for(let i=1;i<pix.length;i++){
  const a=pix[i-1]!,b=pix[i]!,d=ds[i-1]!;
  const t=d?Math.max(0,Math.min(1,((pixel[0]-a[0])*(b[0]-a[0])+(pixel[1]-a[1])*(b[1]-a[1]))/(d*d))):0;
  const hit:[number,number]=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];const distance=Math.hypot(pixel[0]-hit[0],pixel[1]-hit[1]);
  if(distance<best.distance)best={distance,point:[points[i-1]![0]+(points[i]![0]-points[i-1]![0])*t,points[i-1]![1]+(points[i]![1]-points[i-1]![1])*t] as Point,fraction:total?(cumulative+d*t)/total:0};
  cumulative+=d;
 }
 return best;
}
export function roadIdName(id:RoadId){return names[id];}
