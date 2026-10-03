import { enforcePublicRate } from "./public-rate-limit";
import { privacyRequestSchema, privacyFieldsSchema, privacyReceiptSchema, privacyTokenSchema, privacyViewSchema } from "../../../shared/api/privacy";
import { sha256Bytes } from "../storage/sha256";
import { createTurnstileVerifier } from "./turnstile";
import { WeeklyError } from "./admin-weekly";
import type { AppBindings } from "../../app/app";
const enc=new TextEncoder();
const hash=(text:string)=>sha256Bytes(enc.encode(text));
async function receipt(pepper:string|undefined,key:string) {
  if(!pepper || !/^[0-9a-f]{64}$/u.test(pepper)) throw new Error('PRIVACY_UNAVAILABLE');
  const secret=await crypto.subtle.importKey('raw',enc.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',secret,enc.encode(`privacy-receipt/${key}`)));
  return `PRV-${Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}`;
}
export class PrivacyChallengeError extends Error {
  constructor(readonly unavailable:boolean){super('PRIVACY_CHALLENGE');}
}
export async function submitPrivacyRequest(bindings:AppBindings,raw:unknown,rateRequest?:Request,rateActor?:string) {
  const command=privacyRequestSchema.parse(raw),fields=privacyFieldsSchema.parse({requestType:command.requestType,quizSlug:command.quizSlug,submittedName:command.submittedName,message:command.message});
  // The form does not collect contact details or attachments.
  if(/(?:https?:\/\/|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|0\d{1,2}[- ]?\d{3,4}[- ]?\d{4})/u.test([fields.submittedName,fields.message].join(' '))) throw new WeeklyError('INVALID');
  const token=await receipt(bindings.SESSION_PEPPER,command.requestKey),lookupHash=await hash(token),requestHash=await hash(JSON.stringify(fields));
  const prior=await bindings.DB.prepare('SELECT request_hash fingerprint,lookup_token_hash lookupHash FROM privacy_requests WHERE id=?').bind(command.requestKey).first<{fingerprint:string;lookupHash:string}>();
  if(prior) {
    if(prior.fingerprint!==requestHash) throw new WeeklyError('CONFLICT');
    if(prior.lookupHash!==lookupHash) throw new Error('PRIVACY_UNAVAILABLE');
    return privacyReceiptSchema.parse({lookupToken:token});
  }
  if (bindings.PUBLIC_RATE_LIMIT_ENABLED === "true") {
    if (!rateRequest) throw new Error("PRIVACY_UNAVAILABLE");
    await enforcePublicRate(bindings,rateRequest,"privacy-create",rateActor);
  }
  const verifier=createTurnstileVerifier({secret:bindings.TURNSTILE_SECRET,expectedHostname:bindings.TURNSTILE_EXPECTED_HOSTNAME??'',
    expectedAction:'privacy_request',...(bindings.TURNSTILE_SITEVERIFY_FETCH?{fetcher:bindings.TURNSTILE_SITEVERIFY_FETCH}:{})});
  const verified=await verifier.verify({idempotencyKey:command.requestKey,token:command.turnstileToken});
  if(verified.outcome!=='verified') throw new PrivacyChallengeError(verified.outcome==='unavailable');
  const at=new Date().toISOString();
  await bindings.DB.prepare(`INSERT INTO privacy_requests(id,lookup_token_hash,request_hash,request_type,quiz_slug,submitted_name,message,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,'received',?,?) ON CONFLICT(id) DO NOTHING`).bind(command.requestKey,lookupHash,requestHash,fields.requestType,fields.quizSlug,fields.submittedName,fields.message,at,at).run();
  const stored=await bindings.DB.prepare('SELECT request_hash fingerprint,lookup_token_hash lookupHash FROM privacy_requests WHERE id=?').bind(command.requestKey).first<{fingerprint:string;lookupHash:string}>();
  if(stored?.fingerprint!==requestHash || stored.lookupHash!==lookupHash) throw new WeeklyError('CONFLICT');
  return privacyReceiptSchema.parse({lookupToken:token});
}
export async function readPrivacyRequest(db:D1Database,rawToken:string) {
  const token=privacyTokenSchema.parse(rawToken),fingerprint=await hash(token);
  const row=await db.prepare(`SELECT request_type requestType,status,admin_response adminResponse,created_at createdAt FROM privacy_requests WHERE lookup_token_hash=?`).bind(fingerprint).first();
  if(!row) throw new WeeklyError('NOT_FOUND');
  return privacyViewSchema.parse(row);
}
