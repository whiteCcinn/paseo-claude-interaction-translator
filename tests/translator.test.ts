import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TranslationSettings } from "../shared/settings";
import { Translator } from "../server/translator";

const defaults: TranslationSettings = {
  enabled: true, backend: "api", promptLanguage: "en", outputLanguage: "zh-CN",
  requestReplyLanguage: true, autoFinal: true, apiUrl: "", apiModel: "test-model",
  apiKeyEnv: "PASEO_TRANSLATOR_TEST_KEY", codexPath: "codex", codexModel: "",
  codexReasoning: "default", timeoutMs: 5000,
};
process.env.PASEO_TRANSLATOR_TEST_KEY = "test-private-key-never-log";

async function api(handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) {
  const server = createServer((request, response) => { void Promise.resolve(handler(request, response)).catch(() => response.destroy()); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    settings: { ...defaults, apiUrl: `http://127.0.0.1:${address.port}/chat/completions` },
    close: async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); },
  };
}
async function requestBody(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function answer(response: ServerResponse, content: string, finishReason = "stop") {
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] }));
}
async function fakeCli(program: string) {
  const directory = await mkdtemp(join(tmpdir(), "paseo translator "));
  const executable = join(directory, "fake codex");
  await writeFile(executable, `#!${process.execPath}\n${program}\n`);
  await chmod(executable, 0o700);
  return { directory, executable, close: () => rm(directory, { recursive: true, force: true }) };
}
const readStdin = `let source = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => source += chunk); process.stdin.on('end', () => {`;

test("API uses server environment credentials and restores protected text", async () => {
  const fixture = await api(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, "Bearer test-private-key-never-log");
    const body = await requestBody(request);
    assert.equal(body.model, "test-model");
    assert.equal(body.stream, false);
    assert.match(body.messages[0].content, /English/);
    assert.doesNotMatch(body.messages[1].content, /const secret|example\.test/);
    answer(response, body.messages[1].content.replace("解释", "Explain"));
  });
  const translator = new Translator();
  try {
    const source = '解释 `const secret = 1` 和 https://example.test/path';
    assert.equal(await translator.translate(source, "en", fixture.settings), source.replace("解释", "Explain"));
  } finally { translator.dispose(); await fixture.close(); }
});

test("skips content made entirely of protected spans and punctuation", async () => {
  const translator = new Translator();
  try {
    const source = '```ts\nconst a = 1;\n```\n`x` /tmp/file.ts https://example.test';
    assert.equal(await translator.translate(source, "en", { ...defaults, apiKeyEnv: "ABSENT_TEST_KEY" }), source);
  } finally { translator.dispose(); }
});

test("rejects missing or duplicated placeholders before exposing a result", async () => {
  for (const result of ["Translation without code", "__PASEO_KEEP_0____PASEO_KEEP_0__"]) {
    const fixture = await api((_request, response) => answer(response, result));
    const translator = new Translator();
    try { await assert.rejects(translator.translate("解释 `code`", "en", fixture.settings), /保护|placeholder|翻译/); }
    finally { translator.dispose(); await fixture.close(); }
  }
});

test("validates source size and backend configuration without leaking credentials", async () => {
  const translator = new Translator();
  try {
    for (const settings of [
      { ...defaults, apiUrl: "file:///tmp/secret" },
      { ...defaults, apiUrl: "https://user:secret@example.test" },
      { ...defaults, apiUrl: "https://example.test", apiModel: " " },
      { ...defaults, apiUrl: "https://example.test", apiKeyEnv: "ABSENT_TEST_KEY" },
      { ...defaults, backend: "codex-cli" as const, codexPath: " " },
    ]) await assert.rejects(translator.translate("解释", "en", settings), (error: Error) => !/secret|test-private-key-never-log/.test(error.message));
    await assert.rejects(translator.translate("a".repeat(64001), "en", defaults), /过长|大小|size|long/);
  } finally { translator.dispose(); }
});

test("rejects API errors, malformed JSON, truncation and oversized bodies safely", async () => {
  const handlers = [
    (_request: IncomingMessage, response: ServerResponse) => { response.statusCode = 401; response.end("test-private-key-never-log: backend secret"); },
    (_request: IncomingMessage, response: ServerResponse) => response.end("secret malformed body"),
    (_request: IncomingMessage, response: ServerResponse) => answer(response, "partial", "length"),
    (_request: IncomingMessage, response: ServerResponse) => answer(response, "a".repeat(64001)),
    (_request: IncomingMessage, response: ServerResponse) => response.end("a".repeat(512 * 1024 + 1)),
  ];
  for (const handler of handlers) {
    const fixture = await api(handler);
    const translator = new Translator();
    try { await assert.rejects(translator.translate("解释", "en", fixture.settings), (error: Error) => !/secret|test-private-key-never-log/.test(error.message)); }
    finally { translator.dispose(); await fixture.close(); }
  }
});

test("times out and cancels an API request", async () => {
  const fixture = await api(() => {});
  const translator = new Translator();
  try {
    await assert.rejects(translator.translate("解释", "en", { ...fixture.settings, timeoutMs: 40 }), /超时|timeout/);
    const controller = new AbortController();
    const pending = translator.translate("解释", "en", fixture.settings, controller.signal);
    controller.abort();
    await assert.rejects(pending, /取消|cancel/);
  } finally { translator.dispose(); await fixture.close(); }
});

test("CLI passes read-only argv and stdin without invoking a shell", async () => {
  const fixture = await fakeCli(`${readStdin} require('fs').writeFileSync(process.argv[1] + '.capture', JSON.stringify({ argv: process.argv.slice(2), source })); process.stdout.write(source.replace('解释', 'Explain')); });`);
  const translator = new Translator();
  try {
    const source = '解释 $(touch /tmp/not-created) 和 `code`';
    const settings = { ...defaults, backend: "codex-cli" as const, codexPath: fixture.executable, codexModel: "model; literal", codexReasoning: "low" as const };
    assert.equal(await translator.translate(source, "en", settings), source.replace("解释", "Explain"));
    const capture = JSON.parse(await readFile(fixture.executable + ".capture", "utf8"));
    assert.equal(capture.argv[0], "exec");
    for (const flag of ["--ephemeral", "--skip-git-repo-check", "read-only", "project_doc_max_bytes=0", "features.shell_tool=false", "model; literal", 'model_reasoning_effort="low"']) assert.ok(capture.argv.includes(flag), flag);
    assert.equal(capture.argv.at(-1), "-");
    assert.ok(!capture.argv.includes(source));
    assert.match(capture.source, /解释/);
    assert.doesNotMatch(capture.source, /`code`/);
  } finally { translator.dispose(); await fixture.close(); }
});

test("CLI rejects exit errors, empty output and bounded output without revealing stderr", async () => {
  for (const program of [
    `process.stderr.write('test-private-key-never-log: backend secret'); process.exit(2);`,
    `process.exit(0);`,
    `process.stdout.write('a'.repeat(64001));`,
    `process.stderr.write('x'.repeat(512 * 1024)); setTimeout(() => {}, 5000);`,
  ]) {
    const fixture = await fakeCli(program);
    const translator = new Translator();
    try { await assert.rejects(translator.translate("解释", "en", { ...defaults, backend: "codex-cli", codexPath: fixture.executable }), (error: Error) => !/secret|test-private-key-never-log/.test(error.message)); }
    finally { translator.dispose(); await fixture.close(); }
  }
});

test("CLI timeout and explicit cancellation terminate owned processes", async () => {
  const fixture = await fakeCli(`require('fs').writeFileSync(process.argv[1] + '.pid', String(process.pid)); setInterval(() => {}, 1000);`);
  const translator = new Translator();
  try {
    await assert.rejects(translator.translate("解释", "en", { ...defaults, backend: "codex-cli", codexPath: fixture.executable, timeoutMs: 2000 }), /超时|timeout/);
    const pid = Number(await readFile(fixture.executable + ".pid", "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
    const controller = new AbortController();
    const pending = translator.translate("解释", "en", { ...defaults, backend: "codex-cli", codexPath: fixture.executable }, controller.signal);
    await rm(fixture.executable + ".pid", { force: true });
    const startedAt = Date.now();
    while (true) {
      try { await readFile(fixture.executable + ".pid", "utf8"); break; }
      catch { if (Date.now() - startedAt > 4000) throw new Error("fake CLI did not start"); }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    controller.abort();
    await assert.rejects(pending, /取消|cancel/);
    const abortedPid = Number(await readFile(fixture.executable + ".pid", "utf8"));
    await waitForProcessExit(abortedPid);
  } finally { translator.dispose(); await fixture.close(); }
});

test("limits concurrency to two, rejects excess queue and lets queued work abort", async () => {
  let active = 0;
  let peak = 0;
  const responses: ServerResponse[] = [];
  const fixture = await api(async (request, response) => {
    await requestBody(request);
    active += 1; peak = Math.max(peak, active); responses.push(response);
    response.once("close", () => { active -= 1; });
  });
  const translator = new Translator();
  try {
    const queuedAbort = new AbortController();
    const work = Array.from({ length: 18 }, (_, index) => translator.translate(`解释 ${index}`, "en", fixture.settings, index === 17 ? queuedAbort.signal : undefined));
    const settled = work.map((pending) => pending.catch((error: unknown) => error));
    await assert.rejects(translator.translate("超额请求", "en", fixture.settings), /繁忙|busy|queue/);
    queuedAbort.abort();
    assert.match(String(await settled[17]), /取消|cancel/);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(responses.length, 2);
    assert.equal(peak, 2);
    translator.dispose();
    const results = await Promise.all(settled);
    assert.ok(results.every((result) => result instanceof Error));
    await assert.rejects(translator.translate("解释", "en", fixture.settings), /卸载|disposed|关闭/);
  } finally { translator.dispose(); await fixture.close(); }
});

test("continues queued work after active translations finish", async () => {
  let active = 0; let peak = 0;
  const fixture = await api(async (request, response) => {
    const body = await requestBody(request);
    active += 1; peak = Math.max(peak, active);
    setTimeout(() => { active -= 1; answer(response, body.messages[1].content.replace("解释", "Explain")); }, 15);
  });
  const translator = new Translator();
  try {
    assert.deepEqual(await Promise.all(Array.from({ length: 5 }, (_, index) => translator.translate(`解释 ${index}`, "en", fixture.settings))), Array.from({ length: 5 }, (_, index) => `Explain ${index}`));
    assert.equal(peak, 2);
  } finally { translator.dispose(); await fixture.close(); }
});

test("rejects a serialized API request over 512 KiB before making a request", async () => {
  let requests = 0;
  const fixture = await api(async (request, response) => {
    requests += 1;
    const body = await requestBody(request);
    answer(response, body.messages[1].content);
  });
  const translator = new Translator();
  try {
    // Short paths expand to long placeholders; JSON escapes the control
    // characters. Source stays within the public 64K character limit.
    const source = "解释 " + "/a\u0000".repeat(21332);
    await assert.rejects(translator.translate(source, "en", fixture.settings), /过长|大小|size|long/);
    assert.equal(requests, 0);
  } finally { translator.dispose(); await fixture.close(); }
});

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 500;
  for (;;) {
    try { process.kill(pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    if (Date.now() > deadline) throw new Error("owned process remained alive");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function waitForFile(path: string): Promise<string> {
  const deadline = Date.now() + 4000;
  for (;;) {
    try { return await readFile(path, "utf8"); }
    catch { if (Date.now() > deadline) throw new Error("fake CLI did not start"); }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
async function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("translation did not settle promptly")), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

test("aborting CLI descendants that inherit pipes releases both active slots", { skip: process.platform === "win32" }, async () => {
  const fixture = await fakeCli(`${readStdin}
    if (source === '继续') { process.stdout.write('continued'); return; }
    const descendant = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'inherit'] });
    require('fs').writeFileSync(process.argv[1] + '.' + source, JSON.stringify({ parent: process.pid, descendant: descendant.pid }));
    setInterval(() => {}, 1000);
  });`);
  const translator = new Translator();
  const processes: number[] = [];
  const settings = { ...defaults, backend: "codex-cli" as const, codexPath: fixture.executable };
  const controllers = [new AbortController(), new AbortController()];
  const pending = controllers.map((controller, index) => translator.translate(`block${index}`, "en", settings, controller.signal));
  // Attach handlers before a cancellation can reject either request.
  const settled = pending.map((promise) => promise.catch((error: unknown) => error));
  const continued = translator.translate("继续", "en", settings);
  void continued.catch(() => {});
  try {
    for (let index = 0; index < 2; index += 1) {
      const ids = JSON.parse(await waitForFile(fixture.executable + `.block${index}`));
      processes.push(ids.parent, ids.descendant);
    }
    controllers.forEach((controller) => controller.abort());
    const errors = await withDeadline(Promise.all(settled), 700);
    assert.ok(errors.every((error) => error instanceof Error && /取消|cancel/.test(error.message)));
    assert.equal(await withDeadline(continued, 2000), "continued");
    for (const pid of processes) await waitForProcessExit(pid);
  } finally {
    translator.dispose();
    // Cleanup also makes a failing reproduction safe on the original code.
    for (const pid of processes) { try { process.kill(pid, "SIGKILL"); } catch {} }
    await Promise.all(settled);
    await fixture.close();
  }
});

for (const exitCode of [0, 2]) {
  test(`CLI exit ${exitCode} cleans ignored-stdio descendants before request ownership ends`, { skip: process.platform === "win32" }, async () => {
    const fixture = await fakeCli(`${readStdin}
      const helper = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      helper.unref();
      require('fs').writeFileSync(process.argv[1] + '.helper', String(helper.pid));
      process.stdout.write('Hello');
      process.exit(${exitCode});
    });`);
    const translator = new Translator();
    let helperPid: number | undefined;
    try {
      const pending = translator.translate("解释", "en", { ...defaults, backend: "codex-cli", codexPath: fixture.executable });
      if (exitCode === 0) assert.equal(await pending, "Hello");
      else await assert.rejects(pending, /CLI 执行失败/);
      helperPid = Number(await waitForFile(fixture.executable + ".helper"));
      translator.dispose();
      await waitForProcessExit(helperPid);
    } finally {
      translator.dispose();
      if (helperPid) { try { process.kill(helperPid, "SIGKILL"); } catch {} }
      await fixture.close();
    }
  });
}
