// A synthetic-only D1 SQL export/import rehearsal. No input path, token,
// network API, real DB, or remote flag is accepted.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,readdir,realpath,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {unstable_splitSqlQuery} from 'wrangler';
import {localRecoveryD1,databaseFingerprint} from './local-recovery-d1.mjs';
assert.equal(process.argv.length,2,'SYNTHETIC_ONLY_NO_ARGUMENTS');
const root=path.resolve(import.meta.dirname,'..'),directory=await mkdtemp(path.join(tmpdir(),'biblequiz-p8-restore-'));
const require=createRequire(await realpath(path.join(root,'node_modules/wrangler/package.json'))),wrangler=path.join(path.dirname(require.resolve('wrangler/package.json')),'bin/wrangler.js');
const config=path.join(directory,'wrangler.json'),source='p8-source',restored='p8-restored';
await writeFile(config,JSON.stringify({name:'p8-synthetic-restore',compatibility_date:'2026-08-25',d1_databases:[{binding:'SOURCE',database_name:source,database_id:randomUUID(),migrations_dir:path.join(root,'migrations')},{binding:'RESTORED',database_name:restored,database_id:randomUUID(),migrations_dir:path.join(root,'migrations')}]}));
function run(args){
  assert.ok(!args.includes('--remote'));const r=spawnSync(process.execPath,[wrangler,'d1',...args,'--local','--config',config],{cwd:root,encoding:'utf8',timeout:120_000,maxBuffer:8*1024*1024,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:path.join(directory,'wrangler.log')}});
  if(r.error)throw r.error;assert.equal(r.status,0,r.stderr+r.stdout);return r.stdout;
}
run(['migrations','apply',source]);run(['execute',source,'--file',path.join(root,'tests/fixtures/published-quiz.sql')]);
const seed=path.join(directory,'synthetic-submission.sql');
await writeFile(seed,`INSERT INTO anonymous_sessions(session_hash,created_at,last_seen_at,expires_at) VALUES('${'a'.repeat(64)}','2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z','2027-01-01T00:00:00.000Z');
INSERT INTO submissions(id,quiz_variant_id,quiz_revision,session_hash,display_name,comment,answers_json,correct_cells,total_cells,correct_words,total_words,score_basis_points,is_fully_correct,correctness_mask,status,submitted_at,idempotency_key,request_hash)
VALUES('p8-synthetic-submission','e2e-adult',1,'${'a'.repeat(64)}','합성이름','합성댓글','{"r0c0":"가"}',1,2,0,1,5000,0,'10','visible','2026-09-01T00:01:00.000Z','11111111-1111-7111-8111-111111111111','${'b'.repeat(64)}');`);
// Fixture IDs are reviewed rather than guessed in the live database.
const fixture=await readFile(path.join(root,'tests/fixtures/published-quiz.sql'),'utf8');
const variant=/INSERT INTO quiz_variants[\s\S]+?VALUES \(\s*'([^']+)'/u.exec(fixture)?.[1];assert.ok(variant);
await writeFile(seed,(await readFile(seed,'utf8')).replace("'e2e-adult'",`'${variant}'`));run(['execute',source,'--file',seed]);
const originalFiles=new Set(await files(path.join(directory,'.wrangler/state')));
const dumpFile=path.join(directory,'source.sql');run(['export',source,'--output',dumpFile]);
const sql=await readFile(dumpFile),compressed=gzipSync(sql),checksum=createHash('sha256').update(compressed).digest('hex');
await writeFile(path.join(directory,'backup.sql.gz'),compressed);assert.equal(createHash('sha256').update(await readFile(path.join(directory,'backup.sql.gz'))).digest('hex'),checksum);
const statements=unstable_splitSqlQuery(gunzipSync(compressed).toString('utf8'));
// All referenced tables must exist before data; replay INSERT guards only after
// original data is present. Use Wrangler's SQL parser, including trigger bodies.
const tables=statements.filter(s=>/^CREATE TABLE/iu.test(s.trim())),rows=statements.filter(s=>/^INSERT /iu.test(s.trim())),rest=statements.filter(s=>!/^CREATE TABLE|^INSERT |^PRAGMA /iu.test(s.trim()));
assert.equal(tables.length+rows.length+rest.length+statements.filter(s=>/^PRAGMA /iu.test(s.trim())).length,statements.length);
await writeFile(path.join(directory,'restore.sql'),['PRAGMA defer_foreign_keys=TRUE',...tables,...rows,...rest,'PRAGMA defer_foreign_keys=FALSE'].join(';\n')+';\n');run(['execute',restored,'--file',path.join(directory,'restore.sql')]);
async function files(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())out.push(...await files(p));else if(p.endsWith('.sqlite'))out.push(p);}return out;}
const dbFiles=await files(path.join(directory,'.wrangler/state')),opened=dbFiles.map(file=>({file,...localRecoveryD1(file,false)}));
const sources=opened.filter(v=>v.native.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='submissions'").get().n===1);assert.equal(sources.length,2);
// Locate original by the file present before the separate destination exists.
const original=sources.find(v=>originalFiles.has(v.file));assert.ok(original);
const destination=sources.find(v=>v!==original);assert.ok(destination);assert.notEqual(original.file,destination.file);
const nativeTables=v=>v.native.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='d1_migrations' ORDER BY name").all().map(r=>r.name);
assert.deepEqual(nativeTables(original),nativeTables(destination));
for(const kind of ['index','trigger'])assert.deepEqual(destination.native.prepare("SELECT name,sql FROM sqlite_master WHERE type=? AND name NOT LIKE 'sqlite_%' ORDER BY name").all(kind),original.native.prepare("SELECT name,sql FROM sqlite_master WHERE type=? AND name NOT LIKE 'sqlite_%' ORDER BY name").all(kind));
for(const table of nativeTables(original))assert.deepEqual(destination.native.prepare(`SELECT * FROM "${table}" ORDER BY 1`).all(),original.native.prepare(`SELECT * FROM "${table}" ORDER BY 1`).all());
const {outputFiles}=await require('esbuild').build({stdin:{contents:'export { createSubmissionDeletionRetentionService } from "./workers/_shared/services/submission-deletion-retention"; export { createDatabase } from "./workers/_shared/db/client";',resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const previousFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('OFFLINE_NETWORK_FORBIDDEN');};
try{
  const {createSubmissionDeletionRetentionService,createDatabase}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
  const live=createSubmissionDeletionRetentionService(createDatabase(original.db)),restore=createSubmissionDeletionRetentionService(createDatabase(destination.db));
  await original.db.batch([original.db.prepare("UPDATE submissions SET status='deleted',display_name=NULL,comment=NULL,answers_json=NULL,deleted_at=? WHERE id=?").bind('2026-10-01T00:00:00.000Z','p8-synthetic-submission'),original.db.prepare("INSERT INTO audit_logs(id,entity_type,entity_id,action,actor_type,safe_metadata_json,created_at) VALUES('p8-delete','submission','p8-synthetic-submission','self_service_delete','self_service',?,?)").bind(JSON.stringify({deletedAt:'2026-10-01T00:00:00.000Z',quizRevision:1,quizVariantId:variant}),'2026-10-01T00:00:00.000Z')]);
  const manifest=await live.buildManifest('2026-10-01T00:01:00.000Z');assert.equal(manifest.entries.length,1);assert.ok(!JSON.stringify(manifest).includes('합성이름'));
  await writeFile(path.join(directory,'latest-deletions.json'),JSON.stringify(manifest),{mode:0o600});
  await assert.rejects(restore.verifyManifestApplied(manifest));
  const sourceAfter=databaseFingerprint(original.native),verified=await restore.reapplyManifestBeforePublicReopen(manifest);
  assert.deepEqual(verified,{entries:1,deletedTombstones:1,absentSubmissions:0});
  const first=databaseFingerprint(destination.native);await restore.reapplyManifestBeforePublicReopen(manifest);assert.equal(databaseFingerprint(destination.native),first);
  assert.equal(databaseFingerprint(original.native),sourceAfter,'Restore never mutates original source');
  for(const db of sources){assert.deepEqual(db.native.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.native.prepare('PRAGMA quick_check').get().quick_check,'ok');}
  const tomb=await destination.db.prepare("SELECT display_name,comment,answers_json,status FROM submissions WHERE id='p8-synthetic-submission'").first();assert.equal(tomb.status,'deleted');assert.equal(tomb.display_name,null);assert.equal(tomb.comment,null);assert.equal(tomb.answers_json,null);
  const bad=structuredClone(manifest);bad.entries[0].quizRevision=2;await assert.rejects(restore.reapplyManifestBeforePublicReopen(bad));assert.equal(databaseFingerprint(destination.native),first);
  const report={syntheticOnly:true,remoteCalls:0,paidCalls:0,directory,sqlBytes:sql.byteLength,gzipBytes:compressed.byteLength,sha256:checksum,tables:nativeTables(original).length,verified,idempotent:true,originalUnchanged:true,foreignKeyErrors:0,quickCheck:'ok'};
  await writeFile(path.join(directory,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{globalThis.fetch=previousFetch;for(const db of opened)db.close();}
