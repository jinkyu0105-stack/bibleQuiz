// This transport has no upstream fetch. It cannot send an OpenAI request.
import { z } from "zod";
import { intentFields } from "../workers/_shared/services/sermon-intent-contract";

export const marker = "P5_71_SYNTHETIC_ONLY";
export function syntheticTranscript(characters: number) {
  if (![11715, 30000].includes(characters)) throw new Error("P571_PROFILE_INVALID");
  return marker + "가".repeat(characters - marker.length);
}
const bodySchema = z.object({ input: z.string(), text: z.object({ format: z.object({ name: z.enum([
  "correction_v4", "intent_analysis_v4", "intent_critique_v4", "summary_v4", "child_candidates_v4", "adult_candidates_v4",
]) }) }) });
const inputSchema = z.object({ transcript: z.object({ format: z.literal("plain_text"), text: z.string() }) });
export function syntheticProvider(scenario: "success" | "invalid_output" = "success") {
  const stats = { syntheticResponses: 0, requestBytes: 0, responseBytes: 0, paidCalls: 0 };
  const transport: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== "https://api.openai.com/v1/responses" || init?.method !== "POST" || typeof init.body !== "string")
      throw new Error("P571_NETWORK_FORBIDDEN");
    const body = bodySchema.parse(JSON.parse(init.body)), content = inputSchema.parse(JSON.parse(body.input));
    if (content.transcript.text !== syntheticTranscript(content.transcript.text.length)) throw new Error("P571_REAL_INPUT_FORBIDDEN");
    const evidence = [{ quote: marker }];
    const analysis = Object.fromEntries(intentFields.map(field => [field, [{ id: field, text: `합성 ${field}`, origin: "transcript", evidence }]]));
    const clear = { assessment: "clear", concerns: [] };
    const task = body.text.format.name;
    const answers = ["가나다", "라마바", "가사라", "다아바", "허호", "거너", "더러", "머버", "서어", "저처", "커터", "퍼허", "겨녀", "뎌려", "며벼", "셔여"];
    const draft = scenario === "invalid_output" ? { invalid: "P571_INVALID_SYNTHETIC_RESPONSE" } :
      task === "correction_v4" ? { format: "plain_text", text: content.transcript.text } :
      task === "intent_analysis_v4" ? analysis : task === "intent_critique_v4" ? { analysis, critique: {
        exaggeratedIntent: clear, unsupportedConclusion: clear, illustrationAsMainClaim: clear, reversedMeaning: clear,
      } } : task === "summary_v4" ? { paragraphs: [{ id: "summary", text: "합성 측정 요약", intentClaimIds: ["centralMessage"], evidence }] } :
      { candidates: answers.slice(0, task === "child_candidates_v4" ? 15 : 16).map((answer, index) => ({
        id: `word-${index}`, displayAnswer: answer, gridAnswer: answer, clue: `${task} 합성 단서 ${index}`, phraseDescription: "합성",
        selectionReason: "합성", sermonImportance: "핵심", difficultyReason: "합성",
        grounding: { origin: "transcript", intentClaimIds: ["centralMessage"], evidence },
      })) };
    const response = JSON.stringify({ id: "p571-synthetic", model: "gpt-5.6-terra", status: "completed",
      usage: { input_tokens: 100, output_tokens: 30, input_tokens_details: { cached_tokens: 20 }, output_tokens_details: { reasoning_tokens: 10 } },
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ draft }) }] }] });
    stats.syntheticResponses++;
    stats.requestBytes += new TextEncoder().encode(init.body).byteLength;
    stats.responseBytes += new TextEncoder().encode(response).byteLength;
    return new Response(response, { headers: { "Content-Type": "application/json" } });
  };
  return { fetch: transport, stats };
}
