import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join,dirname,resolve,relative} from 'node:path';
function filesBelow(dir){
 return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?filesBelow(join(dir,e.name)):e.name.endsWith('.js')?[join(dir,e.name)]:[]);
}
test('all published root and nested SPCK modules share one build fingerprint and valid dependencies',()=>{
 const html=readFileSync('index.html','utf8');
 const build=html.match(/src="\.\/app\.js\?build=([a-f0-9]{16})"/)?.[1];
 assert.ok(build);
 let count=0,foundNested=0;
 for(const generated of filesBelow('dist')){
  // build.mjs writes cache-fingerprinted browser JS to repository root, not to dist/.
  const file=relative('dist',generated);
  assert.ok(existsSync(file),'published SPCK file missing: '+file);
  if(file.includes('/'))foundNested++;
  for(const match of readFileSync(file,'utf8').matchAll(/(?:from\s*|import\s*\()(['"])(\.\.?\/[^'"]+\.js)([^'"]*)\1/g)){
   assert.equal(match[3],'?build='+build,file+' imports a stale browser module');
   assert.ok(existsSync(resolve(dirname(file),match[2])),file+' references '+match[2]);
   count++;
  }
 }
 assert.ok(count>50);
 assert.ok(foundNested>=30,'nested browser modules must be published');
});
