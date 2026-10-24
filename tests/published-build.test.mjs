import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';

test('SPCK entry point and every published dependency request the same fresh engine build',()=>{
 const html=readFileSync('index.html','utf8');
 const build=html.match(/src="\.\/app\.js\?build=([a-f0-9]{16})"/)?.[1];
 assert.ok(build);let imports=0;
 for(const file of readdirSync('dist').filter(f=>f.endsWith('.js'))){
  for(const match of readFileSync(file,'utf8').matchAll(/(?:from\s*|import\s*\()(['"])(\.\/[^'"]+\.js)([^'"]*)\1/g)){
   assert.equal(match[3],'?build='+build,file+' would load an old or mixed module');
   assert.ok(existsSync(match[2]),file+' references a missing dependency');imports++;
  }
 }
 assert.ok(imports>50,'the full published module graph must be checked');
});
