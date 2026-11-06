import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
function filesBelow(dir){
 return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?filesBelow(join(dir,e.name)):e.name.endsWith('.js')?[join(dir,e.name)]:[]);
}
test('all root and nested SPCK modules share one build fingerprint and have valid dependencies',()=>{
 const html=readFileSync('index.html','utf8');
 const build=html.match(/src="\.\/app\.js\?build=([a-f0-9]{16})"/)?.[1];
 assert.ok(build);
 let count=0,foundNested=0;
 for(const file of filesBelow('dist')){
  if(file.split('/').length>2)foundNested++;
  for(const match of readFileSync(file,'utf8').matchAll(/(?:from\s*|import\s*\()(['"])(\.\.?\/[^'"]+\.js)([^'"]*)\1/g)){
   assert.equal(match[3],'?build='+build,file+' imports a stale module');
   assert.ok(existsSync(resolve(dirname(file),match[2])),file+' references '+match[2]);
   count++;
  }
 }
 assert.ok(count>50);
 assert.ok(foundNested>=30,'the new Fachordner must contain compiled modules');
});
