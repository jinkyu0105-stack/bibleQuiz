import {readFile,writeFile} from 'node:fs/promises';
const manual=await readFile(new URL('../docs/operations-manual.md',import.meta.url),'utf8');
const future=await readFile(new URL('../docs/future/notes.md',import.meta.url),'utf8');
const manualUpdatedAt=manual.match(/마지막 문서 갱신: (\d{4}-\d{2}-\d{2})/u)?.[1];
if(!manualUpdatedAt) throw new Error('OPERATIONS_MANUAL_DATE_MISSING');
const output='// Generated from repository Markdown. Rebuild with node scripts/build-operations-manual.mjs.\nexport const manualUpdatedAt = '+JSON.stringify(manualUpdatedAt)+';\nexport const manual = '+JSON.stringify(manual)+';\nexport const memberAuth = '+JSON.stringify(future)+';\n';
const file=new URL('../workers/_shared/manual-content.ts',import.meta.url);
if(process.argv.includes('--check')) {if(await readFile(file,'utf8')!==output) throw new Error('OPERATIONS_MANUAL_OUTDATED');}
else await writeFile(file,output);
