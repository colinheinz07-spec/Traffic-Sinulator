import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,relative,join} from 'node:path';
import {createHash} from 'node:crypto';
// All compiled entry points and nested modules receive the same immutable URL fingerprint.
async function javascriptFiles(dir){
 const entries=await readdir(dir,{withFileTypes:true});
 const paths=await Promise.all(entries.map(e=>e.isDirectory()?javascriptFiles(join(dir,e.name)):Promise.resolve(e.isFile()&&e.name.endsWith('.js')?[join(dir,e.name)]:[])));
 return paths.flat();
}
const files=(await javascriptFiles('dist')).sort();
const sources=await Promise.all(files.map(file=>readFile(file,'utf8')));
const fingerprint=createHash('sha256').update(JSON.stringify([files,sources])).digest('hex').slice(0,16);
for(let i=0;i<files.length;i++){
 const published=sources[i].replace(/(from\s*|import\s*\()(['"])(\.\.?\/[^'"]+\.js)\2/g,
  (_,prefix,quote,path)=>prefix+quote+path+'?build='+fingerprint+quote);
 const dest=relative('dist',files[i]); await mkdir(dirname(dest),{recursive:true});
 await writeFile(dest,published);
}
const html=await readFile('index.html','utf8');
await writeFile('index.html',html.replace(/src="\.\/app\.js(?:\?[^"\s]*)?"/,
 'src="./app.js?build='+fingerprint+'"'));
