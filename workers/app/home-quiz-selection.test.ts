import { expect, it } from "vitest";
import { selectHomeQuiz, type HomeQuizCandidate } from "../_shared/repositories/home-quiz-selection";
const now=new Date("2026-10-12T03:00:00.000Z");
const candidate=(quizSetId:string,other:Partial<HomeQuizCandidate>={}):HomeQuizCandidate=>({quizSetId,status:"published",submissionState:"open",publishedAt:"2026-10-11T00:00:00.000Z",sermonDate:"2026-10-11",opensAt:"2026-10-11T00:00:00.000Z",closesAt:"2026-10-18T00:00:00.000Z",...other});
it("selects an explicitly featured eligible quiz before the automatically open quiz",()=>{
 const live=candidate("live"),archive=candidate("archive",{status:"archived",submissionState:"closed"});
 expect(selectHomeQuiz([live,archive],"archive",now)).toEqual(archive);
});
it("falls back from a stale feature to the newest open quiz without mutating candidates",()=>{
 const old=candidate("old",{publishedAt:"2026-10-01T00:00:00.000Z"}),latest=candidate("new"),paused=candidate("paused",{publishedAt:"2026-10-12T02:00:00.000Z",submissionState:"paused"});
 const rows=[old,latest,paused];
 expect(selectHomeQuiz(rows,"missing",now)).toEqual(latest);
 expect(rows.map(q=>q.quizSetId)).toEqual(["old","new","paused"]);
});
it("uses the latest effective sermon date for archives and ignores closed, upcoming and paused publications",()=>{
 const archive=candidate("archive",{status:"archived",sermonDate:"2026-10-04"}),corrected=candidate("corrected",{status:"archived",sermonDate:"2026-10-05",publishedAt:"2026-09-01T00:00:00.000Z"});
 const excluded=[candidate("ended",{closesAt:now.toISOString()}),candidate("upcoming",{opensAt:"2026-10-13T00:00:00.000Z"}),candidate("paused",{submissionState:"paused"})];
 expect(selectHomeQuiz([...excluded,archive,corrected],null,now)).toEqual(corrected);
 expect(selectHomeQuiz(excluded,null,now)).toBeUndefined();
});
it("includes the exact opening instant and returns no selection for no public candidates",()=>{
 const opensNow=candidate("start",{opensAt:now.toISOString()});
 expect(selectHomeQuiz([opensNow],undefined,now)).toEqual(opensNow);
 expect(selectHomeQuiz([],"draft",now)).toBeUndefined();
});
it("retains the public SQL ordering when open quizzes have identical publication dates",()=>{
 const upper=candidate("Z"),lower=candidate("a");
 expect(selectHomeQuiz([upper,lower],null,now)).toEqual(lower);
});
