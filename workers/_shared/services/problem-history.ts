import { problemHistorySchema } from "../../../shared/api/problem-history";
import { ownSubmissionSchema } from "../../../shared/api/submission";
import { withdrawalReviewSchema } from "../../../shared/api/admin-withdraw";
import { createDatabase } from "../db/client";
import { createSubmissionRepository } from "../repositories/submission-repository";
import { checkWithdrawalVariant } from "./withdrawal-preview";
import { scoreSubmission } from "./submission-scoring";

export async function readProblemHistory(db:D1Database,slug:string,difficulty:"child"|"adult",sessionHash:string,at:string) {
 const repository=createSubmissionRepository(createDatabase(db));
 if(!await repository.findActiveSession(sessionHash,at)) return {items:[]};
 const rows=await db.prepare(`SELECT v.id,v.revision,v.lifecycle_reason notice,c.source_json source FROM quiz_variants v
 JOIN quiz_sets q ON q.id=v.quiz_set_id JOIN sermons s ON s.id=q.sermon_id
 JOIN submissions sub ON sub.quiz_variant_id=v.id AND sub.session_hash=?
 JOIN quiz_problem_cases c ON c.quiz_set_id=q.id
 JOIN quiz_problem_outcomes o ON o.case_id=c.id AND o.action='publish'
 WHERE s.slug=? AND v.difficulty=? AND v.lifecycle_status='superseded' AND v.results_status='invalidated'
 AND EXISTS(SELECT 1 FROM json_each(c.source_json,'$.variants') original WHERE json_extract(original.value,'$.sourceVariantId')=v.id)
 ORDER BY v.revision DESC`).bind(sessionHash,slug,difficulty).all<{id:string;revision:number;notice:string;source:string}>();
 const items=[];
 for(const row of rows.results) {
  const stored=await repository.findSubmission(row.id,sessionHash);
  if(!stored || stored.quizRevision!==row.revision) throw new Error("HISTORY_UNAVAILABLE");
  if(stored.status==="deleted") {items.push({notice:row.notice,grid:null,submission:ownSubmissionSchema.parse({status:"deleted",quizVariantId:row.id,quizRevision:row.revision,deletedAt:stored.deletedAt})});continue;}
  const source=withdrawalReviewSchema.parse(JSON.parse(row.source)),variant=source.variants.find(v=>v.sourceVariantId===row.id);
  if(!variant) throw new Error("HISTORY_UNAVAILABLE");
  const checked=checkWithdrawalVariant(variant,[]),solution=await repository.findScoringSolution(row.id);
  if(!checked.preview || !solution) throw new Error("HISTORY_UNAVAILABLE");
  const score=scoreSubmission({grid:checked.preview.grid,...solution},stored.answers);
  for(const key of ["correctCells","totalCells","correctWords","totalWords","scoreBasisPoints","correctnessMask","isFullyCorrect"] as const) if(score[key]!==stored[key]) throw new Error("HISTORY_UNAVAILABLE");
  items.push({notice:row.notice,grid:checked.preview.grid,submission:ownSubmissionSchema.parse({status:"submitted",quizVariantId:row.id,quizRevision:row.revision,answers:stored.answers,
   result:{submissionId:stored.id,submittedAt:stored.submittedAt,correctCells:stored.correctCells,totalCells:stored.totalCells,correctWords:stored.correctWords,totalWords:stored.totalWords,
    scoreBasisPoints:stored.scoreBasisPoints,correctnessMask:stored.correctnessMask,canRevealAnswer:true,solution:solution.solution}})});
 }
 return problemHistorySchema.parse({items});
}
