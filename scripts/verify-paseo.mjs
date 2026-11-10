import { spawn, execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { once } from "node:events";

// Uses an explicitly selected CLI and a disposable daemon; never loads ~/.paseo.
const cli = process.env.PASEO_CLI;
if (!cli) throw new Error("请设置 PASEO_CLI 为 Paseo 0.15.4 CLI 的绝对路径。");
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const home = await mkdtemp(join(tmpdir(), "paseo-translator-smoke-"));
// Each management command also owns a process group: even a stuck `stop`
// must settle and allow the daemon cleanup below to run.
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: options.env, cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true });
    let stdout = "", stderr = "", size = 0, settled = false;
    const terminate = () => {
      if (!child.pid) return;
      if (process.platform !== "win32") signalOwnedGroup(child, "SIGKILL");
      else if (child.exitCode === null && child.signalCode === null) {
        execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"],
          { timeout: 2000, killSignal: "SIGKILL", windowsHide: true }, () => {});
        child.kill("SIGKILL");
      }
    };
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      try { terminate(); } catch { error ??= new Error("无法清理隔离验证命令。"); }
      child.stdout.destroy(); child.stderr.destroy();
      error ? reject(error) : resolve({ stdout, stderr });
    };
    const timer = setTimeout(() => finish(new Error("隔离验证命令超时。")), options.timeout ?? 45000);
    const collect = (chunk, output) => {
      size += Buffer.byteLength(chunk, "utf8");
      if (size > (options.maxBuffer ?? 1024 * 1024)) { finish(new Error("隔离验证命令输出过大。")); return; }
      if (output) stdout += String(chunk); else stderr += String(chunk);
    };
    child.stdout.setEncoding("utf8").on("data", chunk => collect(chunk, true));
    child.stderr.setEncoding("utf8").on("data", chunk => collect(chunk, false));
    child.once("error", () => finish(new Error("无法启动隔离验证命令。")));
    child.once("close", code => finish(code === 0 ? undefined : new Error(`隔离验证命令退出码：${code}`)));
  });
}
const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
const address = reservation.address();
if (!address || typeof address === "string") throw new Error("无法分配测试端口。");
await new Promise(resolve => reservation.close(resolve));
const env = { ...process.env, PASEO_HOME: home, PASEO_LISTEN: `127.0.0.1:${address.port}`,
  PASEO_RELAY_ENABLED: "false", PASEO_WEB_UI_ENABLED: "false", PASEO_SERVICE_PROXY_ENABLED: "false",
  PASEO_VOICE_MODE_ENABLED: "false", PASEO_DICTATION_ENABLED: "false",
  CODEX_HOME: join(home, "codex"), CLAUDE_CONFIG_DIR: join(home, "claude"),
};
delete env.PASEO_HOST; delete env.PASEO_PASSWORD; delete env.PASEO_DESKTOP_MANAGED;
await writeFile(join(home, "config.json"), JSON.stringify({ daemon: { listen: env.PASEO_LISTEN, relay: { enabled: false }, mcp: { enabled: false } }, pluginsEnabled: true }), { mode: 0o600 });
let daemon;
async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise(resolve => {
    const done = result => { clearTimeout(timer); child.removeListener("exit", exited); resolve(result); };
    const exited = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    child.once("exit", exited);
  });
}
function signalOwnedGroup(child, signal) {
  try { process.kill(-child.pid, signal); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
}
try {
  daemon = spawn(cli, ["daemon", "run", "--home", home], { env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("隔离 daemon 启动超时。")), 45000);
    const ready = chunk => {
      if (String(chunk).includes("Listening on")) { clearTimeout(timeout); resolve(); }
    };
    daemon.stdout.on("data", ready);
    daemon.stderr.on("data", () => {});
    daemon.once("error", error => { clearTimeout(timeout); reject(error); });
    daemon.once("exit", code => { clearTimeout(timeout); reject(new Error(`隔离 daemon 提前退出：${code}`)); });
  });
  const options = { env, cwd: root, timeout: 45000, maxBuffer: 1024 * 1024 };
  const installed = await run(cli, ["plugin", "install", root, "--home", home, "--json"], options);
  const listed = await run(cli, ["plugin", "ls", "--home", home, "--json"], options);
  const result = JSON.parse(listed.stdout);
  const rows = Array.isArray(result) ? result : result.plugins;
  const plugin = rows?.find(row => row.id === "paseo-claude-interaction-translator");
  if (!plugin || plugin.status !== "running") throw new Error(`插件未运行：${JSON.stringify(result)}`);
  const reloaded = await run(cli, ["plugin", "reload", "paseo-claude-interaction-translator", "--home", home, "--json"], options);
  console.log(JSON.stringify({ install: JSON.parse(installed.stdout), plugin, reload: JSON.parse(reloaded.stdout), isolated: true }, null, 2));
} finally {
  try { await run(cli, ["daemon", "stop", "--home", home, "--json"], { env, timeout: 2000 }); } catch { /* Only this disposable home was targeted. */ }
  if (daemon?.pid) {
    if (process.platform !== "win32") {
      signalOwnedGroup(daemon, "SIGTERM");
      await waitForExit(daemon, 1000);
      // The group can retain helpers even after the CLI parent exits.
      signalOwnedGroup(daemon, "SIGKILL");
    } else if (daemon.exitCode === null && daemon.signalCode === null) {
      try { await run("taskkill", ["/PID", String(daemon.pid), "/T", "/F"], { timeout: 3000, windowsHide: true }); }
      catch { daemon.kill("SIGKILL"); }
    }
    const exited = await waitForExit(daemon, 1000);
    daemon.stdout.destroy(); daemon.stderr.destroy();
    if (!exited) throw new Error(`无法停止自己的隔离 daemon；保留临时目录：${home}`);
  }
  await rm(home, { recursive: true, force: true });
}
