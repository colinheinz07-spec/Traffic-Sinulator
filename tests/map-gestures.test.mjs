import test from 'node:test';import assert from 'node:assert/strict';
import {bindMapGestures} from '../dist/map-gestures.js';
class Surface extends EventTarget{
 captured=new Set();hidden=false;
 getBoundingClientRect(){return {left:10,top:20}}
 setPointerCapture(id){this.captured.add(id)}
 hasPointerCapture(id){return this.captured.has(id)}
 send(type,props={}){const event=new Event(type,{cancelable:true});Object.assign(event,{pointerId:1,clientX:30,clientY:40,pointerType:'touch',isPrimary:true,button:0,buttons:1,...props});this.dispatchEvent(event)}
}
function setup(){const canvas=new Surface(),win=new Surface(),doc=new Surface(),calls=[];globalThis.window=win;globalThis.document=doc;
 bindMapGestures(canvas,{pan:(...args)=>calls.push(['pan',...args]),zoomAt:(...args)=>calls.push(['zoom',...args]),select:(...args)=>calls.push(['select',...args])});return {canvas,win,doc,calls}}
test('lost capture allows fresh single-finger panning',()=>{const {canvas,calls}=setup();canvas.send('pointerdown');canvas.send('lostpointercapture');canvas.send('pointerdown',{pointerId:2});canvas.send('pointermove',{pointerId:2,clientX:50});assert.deepEqual(calls,[['pan',20,0]])});
test('pinch transitions to pan without a false tap',()=>{const {canvas,win,calls}=setup();canvas.send('pointerdown');canvas.send('pointerdown',{pointerId:2,isPrimary:false,clientX:70});canvas.send('pointermove',{pointerId:2,isPrimary:false,clientX:90});win.send('pointerup',{pointerId:2});canvas.send('pointermove',{clientX:40});win.send('pointerup');assert.ok(calls.some(c=>c[0]==='zoom'));assert.deepEqual(calls.at(-1),['pan',10,0]);assert.ok(!calls.some(c=>c[0]==='select'))});
for(const reason of ['blur','pagehide','hidden'])test(`${reason} clears old contacts`,()=>{const {canvas,win,doc,calls}=setup();canvas.send('pointerdown');if(reason==='hidden'){doc.hidden=true;doc.send('visibilitychange')}else win.send(reason);canvas.send('pointermove',{clientX:100});assert.equal(calls.length,0);canvas.send('pointerdown',{pointerId:3});canvas.send('pointermove',{pointerId:3,clientX:40});assert.deepEqual(calls,[['pan',10,0]])});
test('new primary pointer recovers from missing end events',()=>{const {canvas,calls}=setup();canvas.send('pointerdown');canvas.send('pointerdown',{pointerId:2});canvas.send('pointermove',{pointerId:2,clientX:40});assert.deepEqual(calls,[['pan',10,0]])});
test('normal tap selects local coordinates once',()=>{const {canvas,win,calls}=setup();canvas.send('pointerdown');win.send('pointerup');canvas.send('lostpointercapture');assert.deepEqual(calls,[['select',20,20]])});
test('drag returning to origin cannot select a road',()=>{const {canvas,win,calls}=setup();canvas.send('pointerdown');canvas.send('pointermove',{clientX:100});canvas.send('pointermove');win.send('pointerup');assert.ok(!calls.some(c=>c[0]==='select'))});
test('cancelled gesture cannot select',()=>{const {canvas,win,calls}=setup();canvas.send('pointerdown');win.send('pointercancel');win.send('pointerup');assert.deepEqual(calls,[])});
test('coincident pinch contacts never emit nonfinite zoom',()=>{const {canvas,calls}=setup();canvas.send('pointerdown');canvas.send('pointerdown',{pointerId:2,isPrimary:false});canvas.send('pointermove',{pointerId:2,isPrimary:false});assert.ok(!calls.some(c=>c[0]==='zoom'))});
