export async function planProblemCleanup(db:D1Database,sermonId:string,now:string) {
 const row=await db.prepare(`SELECT max(a.at) lastAt,
 (SELECT count(*) FROM quiz_problem_cases c JOIN quiz_sets q ON q.id=c.quiz_set_id WHERE q.sermon_id=? AND NOT EXISTS(SELECT 1 FROM quiz_problem_cleanup WHERE case_id=c.id)) remaining,
 EXISTS(SELECT 1 FROM generation_step_receipts r JOIN generation_jobs j ON j.id=r.generation_job_id WHERE j.sermon_id=? AND r.state IN ('claimed','effect_started') AND r.lease_expires_at>?) blocked
 FROM quiz_problem_activity a WHERE a.sermon_id=? AND EXISTS(SELECT 1 FROM quiz_problem_cases c JOIN quiz_sets q ON q.id=c.quiz_set_id WHERE q.sermon_id=a.sermon_id)`)
 .bind(sermonId,sermonId,now,sermonId).first<{lastAt:string|null;remaining:number;blocked:number}>();
 if(!row?.lastAt)return null;
 const dueAt=new Date(Date.parse(row.lastAt)+7*86_400_000).toISOString();
 return {dueAt,purgedAt:row.remaining ? null:dueAt,blocked:row.blocked ? "active_call" as const:null};
}
export async function problemCleanupStatements(db:D1Database,sermonId:string,now:string) {
 const cases=await db.prepare(`SELECT c.id FROM quiz_problem_cases c JOIN quiz_sets q ON q.id=c.quiz_set_id WHERE q.sermon_id=? AND NOT EXISTS(SELECT 1 FROM quiz_problem_cleanup WHERE case_id=c.id) ORDER BY c.cycle`).bind(sermonId).all<{id:string}>();
 const statements:D1PreparedStatement[]=[];
 for(const c of cases.results) {
  const drafts=await db.prepare("SELECT revision,body_sha256 FROM quiz_problem_drafts WHERE case_id=? ORDER BY revision").bind(c.id).all<{revision:number;body_sha256:string}>();
  statements.push(db.prepare("INSERT INTO quiz_problem_cleanup VALUES(?,?,?,?)").bind(c.id,drafts.results.at(-1)!.revision,JSON.stringify(Object.fromEntries(drafts.results.map(d=>[d.revision,d.body_sha256]))),now));
 }
 statements.push(db.prepare("INSERT INTO audit_logs VALUES(?,'sermon',?,'problem_drafts_purged','system',NULL,?,?)").bind(crypto.randomUUID(),sermonId,JSON.stringify({policy:"draft_7_days",cases:cases.results.length}),now));
 return statements;
}
