import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";

for (const hangStop of [false, true]) test(`isolated smoke verification reaps its own TERM-resistant daemon when stop ${hangStop ? "hangs" : "fails"}`, { skip: process.platform === "win32", timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "paseo-smoke-cleanup-test-"));
  const marker = join(directory, "daemon.json");
  const fake = join(directory, "paseo");
  await writeFile(fake, `#!${process.execPath}
import{readFileSync,writeFileSync}from'node:fs';
const args=process.argv.slice(2);
if(args[0]==='daemon'&&args[1]==='run'){
 writeFileSync(process.env.PASEO_TEST_DAEMON_MARKER,JSON.stringify({pid:process.pid,home:args[args.indexOf('--home')+1]}));
 process.on('SIGTERM',()=>{}); console.log('Listening on 127.0.0.1');setInterval(()=>{},1000);
}else if(args[0]==='daemon'&&args[1]==='stop'){
 if(process.env.PASEO_TEST_HANG_STOP==='true'){
  const metadata=JSON.parse(readFileSync(process.env.PASEO_TEST_DAEMON_MARKER,'utf8'));
  writeFileSync(process.env.PASEO_TEST_DAEMON_MARKER,JSON.stringify({...metadata,stopPid:process.pid}));
  process.on('SIGTERM',()=>{});setInterval(()=>{},1000);
 }else process.exitCode=1;
}
else console.log(JSON.stringify(args[1]==='ls'?[{id:'paseo-claude-interaction-translator',status:'running'}]:{id:'paseo-claude-interaction-translator',status:'running'}));
`);
  await chmod(fake, 0o755);
  const child = spawn(process.execPath, [new URL("../scripts/verify-paseo.mjs", import.meta.url).pathname], {
    env: { ...process.env, PASEO_CLI: fake, PASEO_TEST_DAEMON_MARKER: marker, PASEO_TEST_HANG_STOP: String(hangStop) }, stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  t.after(async () => {
    try {
      const metadata = JSON.parse(await readFile(marker, "utf8"));
      try { process.kill(-metadata.pid, "SIGKILL"); } catch { /* Already reaped by the subject. */ }
      if (metadata.stopPid) { try { process.kill(-metadata.stopPid, "SIGKILL"); } catch { try { process.kill(metadata.stopPid, "SIGKILL"); } catch { /* Already stopped. */ } } }
      if (String(metadata.home).startsWith(join(tmpdir(), "paseo-translator-smoke-"))) await rm(metadata.home, { recursive: true, force: true });
    } catch { /* Subject may fail before starting its daemon. */ }
    if (child.exitCode === null) child.kill("SIGKILL");
    child.stdout.destroy(); child.stderr.destroy(); await rm(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Fake host did not complete install/reload")), 8000);
    let stdout = "";
    child.stdout.on("data", chunk => {
      stdout += String(chunk);
      if (stdout.includes('"isolated": true')) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on("data", () => {});
    child.once("error", error => { clearTimeout(timer); reject(error); });
  });
  const timeout = new Promise<never>((_resolve, reject) => { const timer = setTimeout(() => reject(new Error("Smoke script left its owned daemon alive")), 5000); timer.unref(); });
  const [code] = await Promise.race([exited, timeout]);
  assert.equal(code, 0);
  const metadata = JSON.parse(await readFile(marker, "utf8"));
  assert.throws(() => process.kill(metadata.pid, 0), { code: "ESRCH" });
});
