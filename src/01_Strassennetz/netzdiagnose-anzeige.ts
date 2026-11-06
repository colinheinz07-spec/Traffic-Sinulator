/** Mobile/read-only network inspection; never modifies traffic state. */
import {directionNetworkAudit,validateNetworkAudit,type RampAuditStatus,
 type DirectionNetworkAudit} from './netzdiagnose.js';
import type {Corridor} from '../spatial.js';
import type {Exit} from '../core.js';
const state=new WeakMap<object,Map<string,DirectionNetworkAudit>>();
const st=(status:RampAuditStatus)=>status==='bound'?'zugeordnet':
 status==='not-applicable'?'laut Daten nicht vorhanden':'Zuordnung prüfen';
function line(tag:'div'|'strong'|'span'|'small',value:string,className=''):HTMLElement{
 const e=document.createElement(tag);e.textContent=value;if(className)e.className=className;
 return e;
}
function results(routes:Readonly<Record<string,Corridor>>,path:string,exits:readonly Exit[]):DirectionNetworkAudit{
 let map=state.get(routes);if(!map){map=new Map();state.set(routes,map);}
 let item=map.get(path);
 if(!item){item=directionNetworkAudit(path,routes,exits);map.set(path,item);}
 return item;
}
export function renderNetworkAudit(path:string,routes:Readonly<Record<string,Corridor>>,exits:readonly Exit[]):void{
 const panel=document.getElementById('network-audit-panel');
 if(!(panel instanceof HTMLDetailsElement)||!panel.open)return;
 const summary=document.getElementById('network-audit-summary');
 const list=document.getElementById('network-audit-list');
 if(!summary||!list)return;
 if(panel.dataset.path===path)return;
 panel.dataset.path=path;
 list.replaceChildren();
 const report=results(routes,path,exits);
 const structural=validateNetworkAudit(report);
 const linked=report.accesses.reduce((n,r)=>n+Number(r.entry==='bound')+Number(r.exit==='bound'),0);
 summary.textContent=report.label+' · '+report.lengthKm.toLocaleString('de-DE',{maximumFractionDigits:1})+
  ' km · '+report.ordinaryJunctions+' reguläre AS · '+report.interchanges+
  ' AK/AD · '+linked+' zugeordnete Arme · '+report.unboundAccesses+
  ' mögliche Zuordnungslücken · '+report.exactMainlineLinks+' direkte OSM-Rampenverknüpfungen';
 if(structural.length){
  const e=line('div',structural.join(' | '),'network-audit-problem');list.append(e);
 }
 for(const access of report.accesses){
  const item=document.createElement('div');item.className='network-audit-row';
  item.append(line('strong','AS '+access.ref+' · '+access.name));
  const entry=line('span','Auffahrt: '+st(access.entry));
  const exit=line('span','Abfahrt: '+st(access.exit));
  if(access.entry==='review')entry.classList.add('network-audit-review');
  if(access.exit==='review')exit.classList.add('network-audit-review');
  item.append(entry,exit);
  const ramps=[...new Set([...access.entryRamps,...access.exitRamps])];
  if(ramps.length){
   const details=document.createElement('details');
   details.append(line('summary' as 'div','Rampen-IDs ('+ramps.length+')'));
   details.append(line('small',ramps.join(' · ')));
   item.append(details);
  }
  list.append(item);
 }
 if(!report.accesses.length)list.append(line('div','Für diesen Fahrweg sind keine regulären Anschlussstellen zugeordnet.'));
 if(report.issues.length)list.append(line('div',report.issues.join(' | '),'network-audit-note'));
}
