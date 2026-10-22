import type {Point,Road,RoadId,Ramp,Exit} from './core.js';

/** Concatenate ONLY motorway ways sharing identical OSM end nodes.
 * No nearest-road routing, no fabricated links between visually close streets. */
export interface DrawableRoad {road:RoadId;points:Point[];wayIds:number[]}
const key=(p:Point)=>`${p[0].toFixed(7)}|${p[1].toFixed(7)}`;
export function buildContinuousRoads(roads:readonly Road[]):DrawableRoad[]{
 const output:DrawableRoad[]=[];
 for(const road of ['A3-koeln','A3-frankfurt','A48-dernbach','A48-koblenz'] as const){
  const entries=roads.filter(r=>r.road===road);
  const ends=new Map<string,number[]>();
  entries.forEach((entry,i)=>{for(const p of [entry.points[0]!,entry.points[entry.points.length-1]!]){
   const k=key(p),list=ends.get(k)??[];list.push(i);ends.set(k,list);
  }});
  const used=new Set<number>();
  for(let i=0;i<entries.length;i++){
   if(used.has(i))continue;
   const base=entries[i]!;used.add(i);
   let points=base.points.slice(),wayIds=[base.wayId];
   for(const end of ['back','front'] as const){
    while(true){
     const anchor=end==='back'?points[points.length-1]!:points[0]!;
     const candidate=(ends.get(key(anchor))??[]).find(j=>!used.has(j));
     if(candidate===undefined)break;
     const next=entries[candidate]!,first=next.points[0]!,last=next.points[next.points.length-1]!;
     const forward=key(first)===key(anchor),reverse=key(last)===key(anchor);
     if(!forward&&!reverse)break;
     used.add(candidate);
     if(end==='back'){
      const path=forward?next.points:next.points.slice().reverse();
      points=points.concat(path.slice(1));wayIds.push(next.wayId);
     }else{
      const path=reverse?next.points:next.points.slice().reverse();
      points=path.slice(0,-1).concat(points);wayIds.unshift(next.wayId);
     }
    }
   }
   output.push({road,points,wayIds});
  }
 }
 return output;
}
export function lineWidths(zoom:number){
 const z=Math.max(8,Math.min(17,zoom));
 const t=Math.max(0,Math.min(1,(z-10.8)/4.5));
 const base=1.65+t*2.1;
 const ramp=1.7+t*1.9;
 return {motorway:base,motorwayCasing:base+1.25,ramp,rampCasing:ramp+1.25};
}
function dist(a:Point,b:Point):number{
 const meanLat=(a[0]+b[0])*Math.PI/360;
 return Math.hypot((a[0]-b[0])*111195,(a[1]-b[1])*111195*Math.cos(meanLat));
}
export function along(points:readonly Point[],fraction:number):Point{
 if(points.length===0)throw Error('Empty path');
 if(points.length===1)return points[0]!;
 const lens=points.slice(1).map((p,i)=>dist(points[i]!,p));
 const whole=lens.reduce((a,b)=>a+b,0),requested=whole*Math.max(0,Math.min(1,fraction));
 let spent=0;
 for(let i=0;i<lens.length;i++){
  const n=lens[i]!;
  if(spent+n>=requested||i===lens.length-1){const t=n?Math.max(0,Math.min(1,(requested-spent)/n)):0,a=points[i]!,b=points[i+1]!;
   return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  }
  spent+=n;
 }
 return points[points.length-1]!;
}
export interface RampBadge {ramp:Ramp;point:Point;screen:[number,number];bubble:[number,number];number:number}
export function rampBadges(ramps:readonly Ramp[],project:(p:Point)=>[number,number],size:{width:number;height:number}):RampBadge[]{
 const chosen:RampBadge[]=[];
 const presets:[number,number][]=[[15,-20],[-17,-20],[16,21],[-16,21],[31,3],[-31,3],[0,-34],[0,34]];
 ramps.forEach((ramp,i)=>{
  let best:{point:Point;screen:[number,number];bubble:[number,number];score:number}|null=null;
  for(const f of [.4,.57,.72,.27,.85,.15]){
   const point=along(ramp.points,f),screen=project(point);
   for(const [dx,dy] of presets){const bubble:[number,number]=[screen[0]+dx,screen[1]+dy];
    if(bubble[0]<17||bubble[0]>size.width-17||bubble[1]<42||bubble[1]>size.height-48)continue;
    const sep=chosen.length?Math.min(...chosen.map(c=>Math.hypot(c.bubble[0]-bubble[0],c.bubble[1]-bubble[1]))):100;
    const score=Math.min(90,sep)-Math.hypot(dx,dy)*.12;
    if(!best||score>best.score)best={point,screen,bubble,score};
   }
  }
  if(best)chosen.push({ramp,point:best.point,screen:best.screen,bubble:best.bubble,number:i+1});
 });
 return chosen;
}
export interface Rectangle {x:number;y:number;w:number;h:number}
export function overlaps(a:Rectangle,b:Rectangle,margin=3){return a.x<b.x+b.w+margin&&a.x+a.w+margin>b.x&&a.y<b.y+b.h+margin&&a.y+a.h+margin>b.y;}

export interface JunctionLabel {exit:Exit;point:[number,number];text:string;box:Rectangle|null}
/** Show every in-view junction even in the whole-network view. Long names
 * may fall back to compact AS/AD/AK numbers, never to a hidden junction.
 * Label leaders retain the exact geographic anchor in dense interchanges.
 */
export function layoutJunctionLabels(exits:readonly Exit[],project:(point:Point)=>[number,number],
 viewport:{width:number;height:number},zoom:number,measure:(text:string)=>number,
 obstacles:readonly Rectangle[]=[]):JunctionLabel[]{
 const result:JunctionLabel[]=[];
 const inView=exits.map(exit=>({exit,point:project(exit.position)})).filter(({point:[x,y]})=>
  x>=0&&x<=viewport.width&&y>=0&&y<=viewport.height).sort((a,b)=>
   a.point[1]-b.point[1]||a.exit.road.localeCompare(b.exit.road)||a.exit.ref.localeCompare(b.exit.ref));
 const used=[...obstacles,...inView.map(({point:[x,y]})=>({x:x-5,y:y-5,w:10,h:10}))];
 for(const {exit,point:[x,y]} of inView){
  const kind=exit.name.startsWith('AD ')?'AD':exit.name.startsWith('AK ')?'AK':'AS';
  const compact=kind+' '+exit.ref,full=compact+' '+exit.name.replace(/^(AD|AK) /,'');
  const variants=zoom>=11.4?[full,compact]:[compact];
  let box:Rectangle|null=null,text=compact;
  for(const candidate of variants){
   const w=Math.min(viewport.width-16,Math.ceil(measure(candidate))+12),h=19;
   const locations:Rectangle[]=[];
   for(const gap of [9,28,48,72]){
    for(const [left,top] of [[x+9,y-gap-h],[x-w-9,y-gap-h],[x+9,y+gap],
     [x-w-9,y+gap],[x-w/2,y-gap-h],[x-w/2,y+gap]])locations.push({x:left,y:top,w,h});
   }
   box=locations.find(r=>r.x>=5&&r.y>=5&&r.x+r.w<=viewport.width-5&&r.y+r.h<=viewport.height-5&&
    !used.some(other=>overlaps(r,other,3)))??null;
   if(box){text=candidate;break;}
  }
  if(box)used.push(box);
  result.push({exit,point:[x,y],text,box});
 }
 return result;
}
