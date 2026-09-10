import { mkdirSync, copyFileSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';

// An allowlist keeps migrations, test fixtures, server code and local secrets out of static hosting.
const output=resolve('dist');
mkdirSync(output,{recursive:true});
for(const file of ['index.html','privacy.html','terms.html'])copyFileSync(file,resolve(output,file));
for(const folder of ['js','styles','assets'])cpSync(folder,resolve(output,folder),{recursive:true});
console.log('Static frontend built in dist/. Vercel deploys api/access.js separately as a server function.');
