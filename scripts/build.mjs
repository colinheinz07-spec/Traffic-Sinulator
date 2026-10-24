import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
// Every module in a published build has the same content-derived URL token.
// Updating index.html must not combine a fresh version badge with an old
// cached traffic engine in an embedded SPCK browser. dist stays testable.
const files=(await readdir('dist')).filter(file=>file.endsWith('.js')).sort();
const sources=await Promise.all(files.map(file=>readFile(`dist/${file}`,'utf8')));
const fingerprint=createHash('sha256').update(JSON.stringify([files,sources])).digest('hex').slice(0,16);
for(let i=0;i<files.length;i++){
 const published=sources[i].replace(/(from\s*|import\s*\()(['"])(\.\/[^'"]+\.js)\2/g,
  (_,prefix,quote,path)=>prefix+quote+path+'?build='+fingerprint+quote);
 await writeFile(files[i],published);
}
const html=await readFile('index.html','utf8');
await writeFile('index.html',html.replace(/src="\.\/app\.js(?:\?[^"\s]*)?"/,
 'src="./app.js?build='+fingerprint+'"'));
