/** Compact map callout placement. Keep interchange ramps, controls and
 * event markers visible before placing optional traffic descriptions.
 * If nothing fits, show the details in the traffic panel rather than
 * painting a large opaque block across the AD Dernbach geometry.
 */
export interface LabelRect {x:number;y:number;width:number;height:number}
export interface LabelPoint {x:number;y:number}
export function intersectsLabel(rect:LabelRect,obstacle:LabelRect,pad=3):boolean{
 return rect.x<obstacle.x+obstacle.width+pad&&rect.x+rect.width+pad>obstacle.x
  &&rect.y<obstacle.y+obstacle.height+pad&&rect.y+rect.height+pad>obstacle.y;
}
export function placeJamCallout(point:LabelPoint,width:number,height:number,
 viewport:{width:number;height:number},obstacles:readonly LabelRect[]):LabelRect|null{
 if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||width<=0||height<=0)return null;
 // Avoid top map status, top right zoom, and bottom legend independently
 // of the stream direction. On small screens there may be no free place.
 const reserved:LabelRect[]=[
  {x:0,y:0,width:Math.min(viewport.width-65,525),height:115},
  {x:viewport.width-70,y:0,width:70,height:160},
  {x:0,y:viewport.height-116,width:viewport.width,height:116},
  ...obstacles
 ];
 const choices=[
  {x:point.x+20,y:point.y-58},
  {x:point.x-width-20,y:point.y-58},
  {x:point.x+20,y:point.y+27},
  {x:point.x-width-20,y:point.y+27},
  {x:point.x-width/2,y:point.y-77},
  {x:point.x-width/2,y:point.y+46}
 ];
 for(const {x,y} of choices){
  const rect={x,y,width,height};
  if(x<7||y<7||x+width>viewport.width-7||y+height>viewport.height-7)continue;
  if(reserved.some(other=>intersectsLabel(rect,other,7)))continue;
  return rect;
 }
 return null;
}
