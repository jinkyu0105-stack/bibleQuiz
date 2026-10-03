import { expect, it, vi } from "vitest";
import { finalCheckInstanceId, queueContentFinalCheck, readContentFinalCheck, queueDisplayPreparation, readDisplayPreparation, displayPreparationEnabled,
  displayPreparationInstanceId, type ContentWorkflowMessage } from "../_shared/services/content-final-check-workflow";

const params = () => ({ kind: "final-check" as const, jobId: crypto.randomUUID(), sermonId: crypto.randomUUID(), quizSetId: crypto.randomUUID(), requestKey: crypto.randomUUID() });
it("keeps display preparation separately disabled and limits it to the exact existing owners", async () => {
  const owner = params().sermonId;
  expect(displayPreparationEnabled({}, owner)).toBe(false);
  expect(displayPreparationEnabled({ CONTENT_DISPLAY_PREPARATION_ENABLED: "true" }, owner)).toBe(false);
  expect(displayPreparationEnabled({ CONTENT_DISPLAY_PREPARATION_ENABLED: "true", CONTENT_DISPLAY_PREPARATION_SERMON_IDS: "[" }, owner)).toBe(false);
  const env = { CONTENT_DISPLAY_PREPARATION_ENABLED: "true", CONTENT_DISPLAY_PREPARATION_SERMON_IDS: JSON.stringify([owner]) };
  expect(displayPreparationEnabled(env, owner)).toBe(true);
  expect(displayPreparationEnabled(env, "other-owner")).toBe(false);
});
it("queues one display-only identity, resolves lost replies, and exposes no private Workflow output", async () => {
  const command = { ...params(), kind: "display-prepare" as const };
  const create = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("already exists"));
  const status = vi.fn().mockResolvedValueOnce({ status: "running" }).mockResolvedValueOnce({ status: "complete", output: { outcome: "prepared" } })
    .mockResolvedValueOnce({ status: "complete", output: { outcome: "prepared", privateGrid: "PRIVATE_CANARY" } });
  const get = vi.fn().mockResolvedValue({ status });
  const workflow = { create, get } as unknown as Workflow<ContentWorkflowMessage>;
  await queueDisplayPreparation(workflow, command); await queueDisplayPreparation(workflow, command);
  expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
  expect(get).toHaveBeenCalledWith(await displayPreparationInstanceId(command.jobId, command.requestKey));
  expect(await displayPreparationInstanceId(command.jobId, command.requestKey)).not.toBe(await finalCheckInstanceId(command.jobId, command.requestKey));
  expect(await readDisplayPreparation(workflow, command.jobId, command.requestKey)).toEqual({ requestKey: command.requestKey, outcome: "prepared" });
  expect(await readDisplayPreparation(workflow, command.jobId, command.requestKey)).toEqual({ requestKey: command.requestKey, outcome: "failed" });
  await expect(queueDisplayPreparation(workflow, { ...command, privateGrid: {} } as never)).rejects.toThrow();
  expect(create).toHaveBeenCalledTimes(2);
});
it("resolves duplicate final-only creates using the exact existing instance without restarting it", async () => {
  const command = params(), status = vi.fn().mockResolvedValue({ status: "running" });
  const create = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("already exists"));
  const get = vi.fn().mockResolvedValue({ status });
  const workflow = { create, get } as unknown as Workflow<ContentWorkflowMessage>;
  expect(await queueContentFinalCheck(workflow, command)).toEqual({ outcome: "queued", requestKey: command.requestKey });
  expect(await queueContentFinalCheck(workflow, command)).toEqual({ outcome: "queued", requestKey: command.requestKey });
  expect(create.mock.calls[0]?.[0]).toEqual(create.mock.calls[1]?.[0]);
  expect(get).toHaveBeenCalledWith(await finalCheckInstanceId(command.jobId, command.requestKey));
  expect(status).toHaveBeenCalledTimes(1);
});
it("leaves an unobserved send unresolved and rejects extra Workflow payload fields", async () => {
  const create = vi.fn().mockRejectedValue(new Error("send unavailable"));
  const get = vi.fn().mockRejectedValue(new Error("read unavailable"));
  const workflow = { create, get } as unknown as Workflow<ContentWorkflowMessage>;
  await expect(queueContentFinalCheck(workflow, params())).rejects.toThrow("read unavailable");
  await expect(queueContentFinalCheck(workflow, { ...params(), privateGraph: "not allowed" } as never)).rejects.toThrow();
  expect(create).toHaveBeenCalledTimes(1);
});
it("reports only a bounded disposition and never serializes Workflow errors or private output", async () => {
  const command = params();
  const status = vi.fn()
    .mockResolvedValueOnce({ status: "waiting" })
    .mockResolvedValueOnce({ status: "complete", output: { outcome: "review_ready" } })
    .mockResolvedValueOnce({ status: "complete", output: { outcome: "review_ready", privateGraph: "PRIVATE_CANARY" } })
    .mockResolvedValueOnce({ status: "errored", error: { message: "PRIVATE_CANARY" } });
  const workflow = { get: async () => ({ status }) } as unknown as Workflow<ContentWorkflowMessage>;
  for (const outcome of ["running", "review_ready", "failed", "failed"]) {
    expect(await readContentFinalCheck(workflow, command.jobId, command.requestKey)).toEqual({ requestKey: command.requestKey, outcome });
  }
  const first = await finalCheckInstanceId("a".repeat(128), command.requestKey);
  expect(first.length).toBeLessThanOrEqual(100);
  expect(await finalCheckInstanceId("b".repeat(128), command.requestKey)).not.toBe(first);
});
