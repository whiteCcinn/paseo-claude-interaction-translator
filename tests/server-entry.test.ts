import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import contribute from "../index.server.ts";
import { responsesRpc, retryResponseRpc, translateDraftRpc } from "../shared/contracts.ts";
import { settingsSchema } from "../shared/settings.ts";

type Handler = (input: any, context: any) => any;
test("real server entry translates a draft and only the final reply without sending or appending messages", async t => {
  const requests: any[] = [];
  const http = createServer(async (request, response) => {
    let body = ""; for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: requests.length === 1 ? "Hello" : "最终答复" }, finish_reason: "stop" }] }));
  });
  http.listen(0, "127.0.0.1"); await once(http, "listening");
  t.after(() => { http.closeAllConnections(); http.close(); delete process.env.PASEO_TRANSLATOR_ENTRY_TEST_KEY; });
  const address = http.address(); assert.ok(address && typeof address !== "string");
  process.env.PASEO_TRANSLATOR_ENTRY_TEST_KEY = "dummy-test-key";
  let config = settingsSchema.parse({ backend: "api", apiUrl: `http://127.0.0.1:${address.port}`, apiKeyEnv: "PASEO_TRANSLATOR_ENTRY_TEST_KEY" });
  const handlers = new Map<string, Handler>(); const hooks = new Map<string, Handler>();
  let settingsChanged: (() => void) | undefined;
  const cleanup = contribute({
    registerSettings: () => ({ read: async () => ({ status: "ready", revision: "1", values: config }), subscribe: (fn: () => void) => { settingsChanged = fn; return () => {}; } }),
    handle: (contract: { name: string }, handler: Handler) => { handlers.set(contract.name, handler); },
    on: (name: string, handler: Handler) => { hooks.set(name, handler); return () => { hooks.delete(name); }; },
    before: (name: string, handler: Handler) => { hooks.set(name, handler); return () => { hooks.delete(name); }; },
  } as unknown as PluginServerContext);
  t.after(cleanup);
  const translated = await handlers.get(translateDraftRpc.name)!({ text: "你好" }, {});
  assert.equal(translated.text, "Hello\n\nPlease respond in English.");
  const agent = { id: "agent", parentAgentId: null };
  const context = { paseo: { agents: { ref: () => ({ timeline: { refetch: async () => ({ entries: [
    { turnId: "turn", item: { type: "assistant_message", messageId: "middle", text: "Working" } },
    { turnId: "turn", item: { type: "assistant_message", messageId: "final", text: "Final reply" } },
  ], hasOlder: false }) } }) } } };
  await hooks.get("agent.turn_started")!({ agent, turnId: "turn" }, context);
  await hooks.get("agent.turn_ended")!({ agent, turnId: "turn", outcome: { kind: "completed" } }, context);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].messages[1].content, "Final reply");
  const result = await handlers.get(responsesRpc.name)!({ agentId: "agent" }, {});
  assert.deepEqual(result.entries.map((entry: any) => [entry.messageId, entry.text, entry.state]), [["final", "Final reply", { status: "ready", text: "最终答复" }]]);
  assert.equal((await handlers.get(retryResponseRpc.name)!({ agentId: "agent", messageId: "arbitrary", text: "not admitted" }, {})).accepted, false);
  // The fake context deliberately offers no send(), timeline.append() or history mutation.
  config = { ...config, enabled: false }; settingsChanged?.();
  await assert.rejects(() => handlers.get(translateDraftRpc.name)!({ text: "你好" }, {}), /停用/);
  assert.equal((await handlers.get(responsesRpc.name)!({ agentId: "agent" }, {})).entries.length, 0);
  cleanup(); assert.equal(hooks.size, 0);
});
test("disabling the plugin during a settings read cannot admit an old draft request", async t => {
  const handlers = new Map<string, Handler>();
  let changed!: () => void; let release!: (value: unknown) => void;
  const cleanup = contribute({
    registerSettings: () => ({ read: () => new Promise(resolve => { release = resolve; }), subscribe: (fn: () => void) => { changed = fn; return () => {}; } }),
    handle: (contract: { name: string }, handler: Handler) => handlers.set(contract.name, handler),
    on: () => () => {}, before: () => () => {},
  } as unknown as PluginServerContext);
  t.after(cleanup);
  const pending = handlers.get(translateDraftRpc.name)!({ text: "你好" }, {});
  changed();
  release({ status: "ready", revision: "old", values: settingsSchema.parse({ backend: "api", apiUrl: "http://127.0.0.1:1", apiKeyEnv: "PASEO_TRANSLATOR_MISSING_TEST_KEY" }) });
  await assert.rejects(pending, /设置已变更|取消/);
});
