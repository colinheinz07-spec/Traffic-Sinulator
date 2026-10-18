import {readdir,copyFile} from 'node:fs/promises';
// Publish compiled JavaScript alongside the root index.html for SPCK (no bundler/CDN).
for (const file of await readdir('dist')) if(file.endsWith('.js')) await copyFile(`dist/${file}`,file);
