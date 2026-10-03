import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Build check cannot silently rewrite a stale generated manual in CI.
const manual=await readFile(new URL('../docs/operations-manual.md',import.meta.url),'utf8');
const content=await readFile(new URL('../workers/_shared/manual-content.ts',import.meta.url),'utf8');
assert.ok(content.includes(JSON.stringify(manual)),'OPERATIONS_MANUAL_OUTDATED');
const future=await readFile(new URL('../docs/future/notes.md',import.meta.url),'utf8');
assert.ok(content.includes(JSON.stringify(future)),'FUTURE_MANUAL_OUTDATED');
for(let i=1;i<=14;i++)assert.match(manual,new RegExp(`^## ${i}\\. `,'m'));
const registry=await readFile(new URL('../src/config/service-registry.ts',import.meta.url),'utf8');
for(const id of ['openai','r2','d1','workers','durable_objects','workflows','workers_builds','access','github_actions','domain'])assert.ok(registry.includes(`id:"${id}"`));
const root=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
for(const config of [root,...Object.values(root.env??{})]){
  assert.ok(!config.r2_buckets?.length,'APP_MUST_NOT_HAVE_R2');
  assert.ok(!config.ratelimits?.length,'REMOTE_RATE_LIMIT_ACTIVATION_NOT_APPROVED');
  for(const key of ['BACKUP_ENABLED','OPERATIONS_CRON_ENABLED','PUBLIC_RATE_LIMIT_ENABLED'])assert.notEqual(config.vars?.[key],'true','REMOTE_OPERATIONS_ACTIVATION_NOT_APPROVED');
  assert.ok(!(config.workflows??[]).some(w=>w.binding==='BACKUP_WORKFLOW'),'REMOTE_BACKUP_BINDING_NOT_APPROVED');
}
const backup=JSON.parse(await readFile(new URL('../workers/backup/wrangler.jsonc',import.meta.url),'utf8'));
assert.equal(backup.workers_dev,false);assert.equal(backup.preview_urls,false);assert.ok(!backup.routes?.length&&!backup.r2_buckets?.length&&!backup.d1_databases?.length&&!backup.triggers?.crons?.length,'BACKUP_REMOTE_RESOURCES_NOT_APPROVED');
console.log('PASS: operations manual/registry and inactive remote boundaries');
