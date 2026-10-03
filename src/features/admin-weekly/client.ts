import { z } from "zod";
export async function weeklyRequest<T>(url:string,schema:z.ZodType<T>,method='GET',body?:unknown,signal?:AbortSignal):Promise<T> {
  const response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15_000)]):AbortSignal.timeout(15_000),
    ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const result=await response.json() as {data?:unknown;error?:{message?:string}};
  if(!response.ok) throw new Error(result.error?.message??'처리 결과를 확인하지 못했습니다.');
  return schema.parse(result.data);
}
