import { test } from "node:test";
import assert from "node:assert/strict";
import { DraftTranslation } from "../client/draft.ts";

test("translation requires an explicit action and never sends automatically", async () => {
  const draft = new DraftTranslation(); draft.edit("你好"); let calls = 0;
  assert.equal(draft.snapshot().translated, undefined);
  await draft.translate(async text => { calls++; assert.equal(text, "你好"); return "Hello"; });
  assert.equal(calls, 1); assert.equal(draft.snapshot().translated, "Hello");
  let sent = ""; await draft.send(async text => { sent = text; });
  assert.equal(sent, "Hello"); assert.equal(draft.snapshot().source, "");
});
test("editing while translation is pending discards late results", async () => {
  const draft = new DraftTranslation(); draft.edit("first");
  let resolve!: (value: string) => void;
  const pending = draft.translate(() => new Promise(r => { resolve = r; }));
  draft.edit("new draft"); resolve("old translation"); await pending;
  assert.equal(draft.snapshot().source, "new draft"); assert.equal(draft.snapshot().translated, undefined);
});
test("changing source invalidates a ready translation", async () => {
  const draft = new DraftTranslation(); draft.edit("你好"); await draft.translate(async () => "Hello"); draft.edit("再见");
  let calls = 0; await draft.send(async () => { calls++; });
  assert.equal(calls, 0); assert.equal(draft.snapshot().source, "再见");
});
test("translation and send failures preserve text without leaking raw errors", async () => {
  const draft = new DraftTranslation(); draft.edit("你好");
  await draft.translate(async () => { throw new Error("secret-token"); });
  assert.equal(draft.snapshot().source, "你好"); assert.ok(!draft.snapshot().error?.includes("secret-token"));
  await draft.translate(async () => "Hello");
  await draft.send(async () => { throw new Error("secret-token"); });
  assert.equal(draft.snapshot().translated, "Hello"); assert.ok(!draft.snapshot().error?.includes("secret-token"));
});
test("concurrent translation/send actions are deduplicated", async () => {
  const draft = new DraftTranslation(); draft.edit("你好"); let calls = 0;
  let resolve!: (value: string) => void;
  const pending = draft.translate(() => { calls++; return new Promise(r => { resolve = r; }); });
  await draft.translate(async () => { calls++; return "duplicate"; }); resolve("Hello"); await pending;
  let release!: () => void;
  const sending = draft.send(() => { calls++; return new Promise<void>(r => { release = r; }); });
  await draft.send(async () => { calls++; }); release(); await sending;
  assert.equal(calls, 2);
});
test("send retries reuse the same message id", async () => {
  const draft = new DraftTranslation(); draft.edit("你好"); await draft.translate(async () => "Hello");
  const ids: string[] = [];
  await draft.send(async (_text, id) => { ids.push(id); throw new Error("network"); });
  await draft.send(async (_text, id) => { ids.push(id); });
  assert.ok(ids[0]); assert.equal(ids[0], ids[1]);
});
test("disposed drafts discard late results and stop notifying listeners", async () => {
  const draft = new DraftTranslation(); let changes = 0; draft.subscribe(() => { changes++; }); draft.edit("你好");
  let resolve!: (value: string) => void;
  const pending = draft.translate(() => new Promise(r => { resolve = r; }));
  draft.dispose(); const count = changes; resolve("Hello"); await pending;
  assert.equal(changes, count); assert.equal(draft.snapshot().translated, undefined);
});
test("settings revision changes invalidate prepared translations and in-flight results", async () => {
  const draft = new DraftTranslation(); draft.configure("first"); draft.edit("你好");
  await draft.translate(async () => "Hello"); draft.configure("second");
  assert.equal(draft.snapshot().translated, undefined); assert.equal(draft.snapshot().source, "你好");
  let resolve!: (value: string) => void;
  const pending = draft.translate(() => new Promise(r => { resolve = r; }));
  draft.configure("third"); resolve("old settings"); await pending;
  assert.equal(draft.snapshot().translated, undefined);
});
test("settings changes while sending cannot leave the input permanently locked", async () => {
  const draft = new DraftTranslation(); draft.configure("first"); draft.edit("你好"); await draft.translate(async () => "Hello");
  let resolve!: () => void;
  const pending = draft.send(() => new Promise<void>(r => { resolve = r; }));
  draft.configure("second"); resolve(); await pending;
  assert.equal(draft.snapshot().sending, false);
  draft.edit("next"); assert.equal(draft.snapshot().source, "next");
});
