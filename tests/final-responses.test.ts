import { test } from "node:test";
import assert from "node:assert/strict";
import { FinalResponses, type HistoryPage } from "../server/final-responses.ts";
import { settingsSchema } from "../shared/settings.ts";

const turn = { agentId: "a", turnId: "t1", parentAgentId: null };
const identity = { agentId: "a", messageId: "last", text: "Final answer" };
function page(items: { type: string; text?: string; messageId?: string; turnId?: string }[], older = false): HistoryPage {
  return { entries: items.map(({ turnId = "t1", ...item }) => ({ turnId, item })), hasOlder: older, startCursor: { epoch: "e", seq: 1 } };
}
const history = page([
  { type: "assistant_message", messageId: "first", text: "Working" },
  { type: "tool_call" },
  { type: "assistant_message", messageId: "last", text: "Final answer" },
]);
function setup(overrides: Record<string, unknown> = {}, limits?: { maxEntries?: number; maxBytes?: number }) {
  const calls: string[] = [];
  const coordinator = new FinalResponses({
    settings: async () => settingsSchema.parse({ backend: "api", ...overrides }),
    translate: async (text) => { calls.push(text); return "最终答复"; }, ...limits,
  });
  return { coordinator, calls };
}

test("only the last assistant response in a successful observed main turn is translated", async () => {
  const { coordinator, calls } = setup();
  coordinator.start(turn);
  await coordinator.complete(turn, "completed", async () => history);
  assert.deepEqual(calls, ["Final answer"]);
  assert.deepEqual(coordinator.get(identity), { status: "ready", text: "最终答复" });
});
test("replayed completion without a live start is ignored", async () => {
  const { coordinator, calls } = setup();
  await coordinator.complete(turn, "completed", async () => history);
  assert.equal(calls.length, 0);
});
test("duplicate completion cannot call the backend twice", async () => {
  const { coordinator, calls } = setup(); coordinator.start(turn);
  await Promise.all([coordinator.complete(turn, "completed", async () => history), coordinator.complete(turn, "completed", async () => history)]);
  assert.equal(calls.length, 1);
});
for (const outcome of ["failed", "canceled"] as const) test(`${outcome} turns keep original output`, async () => {
  const { coordinator, calls } = setup(); coordinator.start(turn);
  await coordinator.complete(turn, outcome, async () => history);
  assert.equal(calls.length, 0);
});
test("child agents, unnamed turns and disabled translation are ignored", async () => {
  for (const current of [{ ...turn, parentAgentId: "parent" }, { ...turn, turnId: null }]) {
    const { coordinator, calls } = setup(); coordinator.start(current);
    await coordinator.complete(current, "completed", async () => history); assert.equal(calls.length, 0);
  }
  for (const settings of [{ enabled: false }, { autoFinal: false }]) {
    const { coordinator, calls } = setup(settings); coordinator.start(turn);
    await coordinator.complete(turn, "completed", async () => history); assert.equal(calls.length, 0);
  }
});
test("history uses exact turn identity, not text or latest message heuristics", async () => {
  const { coordinator, calls } = setup(); coordinator.start(turn);
  await coordinator.complete(turn, "completed", async () => page([{ type: "assistant_message", text: "Other", messageId: "other", turnId: "t2" }]));
  assert.equal(calls.length, 0);
});
test("an assistant message without stable identity does not translate an earlier row instead", async () => {
  const { coordinator, calls } = setup(); coordinator.start(turn);
  await coordinator.complete(turn, "completed", async () => page([
    { type: "assistant_message", messageId: "first", text: "Earlier" }, { type: "assistant_message", text: "No ID" },
  ]));
  assert.equal(calls.length, 0);
});
test("a new turn invalidates pending history fetch", async () => {
  const { coordinator, calls } = setup(); coordinator.start(turn);
  let resolve!: (value: HistoryPage) => void;
  const pending = coordinator.complete(turn, "completed", () => new Promise(r => { resolve = r; }));
  await new Promise(r => setImmediate(r));
  coordinator.start({ ...turn, turnId: "t2" }); resolve(history); await pending;
  assert.equal(calls.length, 0);
});
test("a new turn cancels in-flight translation and rejects its stale result", async () => {
  let resolve!: (value: string) => void; let signal: AbortSignal | undefined;
  const coordinator = new FinalResponses({ settings: async () => settingsSchema.parse({}), translate: async (_text, _target, _settings, abort) => {
    signal = abort; return new Promise(r => { resolve = r; });
  } });
  coordinator.start(turn); const pending = coordinator.complete(turn, "completed", async () => history);
  await new Promise(r => setImmediate(r));
  assert.equal(coordinator.get(identity).status, "translating");
  coordinator.start({ ...turn, turnId: "t2" }); assert.equal(signal?.aborted, true);
  resolve("旧结果"); await pending; assert.equal(coordinator.get(identity).status, "original");
});
test("close and dispose cannot publish late translations", async () => {
  for (const dispose of [false, true]) {
    let resolve!: (value: string) => void;
    const coordinator = new FinalResponses({ settings: async () => settingsSchema.parse({}), translate: () => new Promise(r => { resolve = r; }) });
    coordinator.start(turn); const pending = coordinator.complete(turn, "completed", async () => history);
    await new Promise(r => setImmediate(r));
    if (dispose) coordinator.dispose(); else coordinator.close("a");
    resolve("late"); await pending; assert.equal(coordinator.get(identity).status, "original");
  }
});
test("failed translation preserves source, is retryable, and sanitizes failures", async () => {
  let fail = true;
  const coordinator = new FinalResponses({ settings: async () => settingsSchema.parse({}), translate: async () => {
    if (fail) throw new Error("secret-token"); return "成功";
  } });
  coordinator.start(turn); await coordinator.complete(turn, "completed", async () => history);
  assert.equal(coordinator.get(identity).status, "error");
  assert.ok(!JSON.stringify(coordinator.get(identity)).includes("secret-token"));
  fail = false; assert.equal(await coordinator.retry(identity), true);
  assert.deepEqual(coordinator.get(identity), { status: "ready", text: "成功" });
  assert.equal(await coordinator.retry({ ...identity, text: "changed" }), false);
});
test("bounded cache evicts old rows without accidentally matching changed text", async () => {
  const { coordinator } = setup({}, { maxEntries: 1 });
  coordinator.start(turn); await coordinator.complete(turn, "completed", async () => history);
  const next = { ...turn, turnId: "t2" }; coordinator.start(next);
  await coordinator.complete(next, "completed", async () => page([{ type: "assistant_message", messageId: "new", text: "Next", turnId: "t2" }]));
  assert.equal(coordinator.get(identity).status, "original");
  assert.equal(coordinator.get({ agentId: "a", messageId: "new", text: "changed" }).status, "original");
});
test("cache snapshots use revisions, bound bytes and clear on settings reset", async () => {
  const { coordinator } = setup(); coordinator.start(turn); await coordinator.complete(turn, "completed", async () => history);
  const snapshot = coordinator.snapshot("a"); assert.equal(snapshot.entries?.length, 1);
  assert.equal(coordinator.snapshot("a", snapshot.revision).entries, undefined);
  coordinator.reset(); assert.equal(coordinator.snapshot("a").entries?.length, 0);
  const { coordinator: tiny } = setup({}, { maxBytes: 5 }); tiny.start(turn); await tiny.complete(turn, "completed", async () => history);
  assert.equal(tiny.get(identity).status, "original");
});
test("history pagination uses cursors and stops on repeated cursor", async () => {
  const { coordinator, calls } = setup(); coordinator.start(turn); let reads = 0;
  await coordinator.complete(turn, "completed", async (cursor) => {
    reads++; return cursor ? history : page([{ type: "tool_call", turnId: "t1" }], true);
  });
  assert.equal(reads, 2); assert.equal(calls.length, 1);
  const other = setup(); other.coordinator.start(turn);
  await other.coordinator.complete(turn, "completed", async () => page([], true));
  assert.equal(other.calls.length, 0);
});
test("closing an agent while retry reads settings prevents late retry admission", async () => {
  let hold = false; let release!: (settings: ReturnType<typeof settingsSchema.parse>) => void; let calls = 0;
  const coordinator = new FinalResponses({
    settings: () => hold ? new Promise(r => { release = r; }) : Promise.resolve(settingsSchema.parse({})),
    translate: async () => { calls++; throw new Error("backend"); },
  });
  coordinator.start(turn); await coordinator.complete(turn, "completed", async () => history);
  hold = true; const pending = coordinator.retry(identity);
  coordinator.close("a"); release(settingsSchema.parse({}));
  assert.equal(await pending, false); assert.equal(calls, 1);
});
