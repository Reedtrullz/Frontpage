#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const safeLabel = value => /^[a-zA-Z0-9._-]{1,80}$/.test(value ?? "") ? value : "unknown";

// sudo may put APT in a separate session; retain descendant birth times before signalling its monitor.
function descendants(pid, retained) {
  if (process.platform !== "linux") return;
  const rows = spawnSync("ps", ["-eo", "pid=,ppid="], { encoding: "utf8", timeout: 1000 }).stdout;
  if (!rows) throw new Error("Unable to inventory owned installer processes");
  const parents = rows.trim().split("\n").map(row => row.trim().split(/\s+/).map(Number));
  const owned = new Set();
  for (const [child, birth] of retained) {
    try { if (birthTime(child) === birth) owned.add(child); } catch { /* Process already exited. */ }
  }
  if (!retained.has(pid)) owned.add(pid);
  for (let changed = true; changed;) {
    changed = false;
    for (const [child, parent] of parents) if (owned.has(parent) && !owned.has(child)) { owned.add(child); changed = true; }
  }
  for (const child of owned) {
    try { if (!retained.has(child)) retained.set(child, birthTime(child)); } catch { /* Process already exited. */ }
  }
}
function birthTime(pid) {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
}
function signalOwned(pid, retained, signal) {
  descendants(pid, retained);
  const targets = [];
  for (const [child, birth] of retained) {
    try { if (birthTime(child) === birth) targets.push(String(child)); } catch { /* Process already exited. */ }
  }
  if (process.platform !== "linux") {
    try { process.kill(-pid, signal); } catch (error) { if (!["ESRCH", "EPERM"].includes(error.code)) throw error; }
  } else if (targets.length) {
    // The fixed owned targets cover root-owned APT children without elevating the installer itself.
    const kill = spawnSync(process.getuid() === 0 ? "kill" : "sudo", process.getuid() === 0
      ? [`-${signal}`, "--", ...targets] : ["-n", "kill", `-${signal}`, "--", ...targets], { timeout: 1000, stdio: "ignore" });
    if (kill.error) throw new Error("Owned installer cleanup failed");
  }
}

export function runInstaller({
  command = process.execPath,
  args = ["node_modules/playwright/cli.js", "install", "--with-deps", "chromium"],
  timeoutMs = 300_000,
  graceMs = 15_000,
  output = process.stdout,
  env = process.env,
} = {}) {
  if (process.platform === "win32" || !Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000
      || !Number.isInteger(graceMs) || graceMs < 1 || graceMs > 15_000) throw new Error("Invalid installer platform or deadline");
  const started = performance.now();
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const record = fields => output.write(`${JSON.stringify({ event: "browser-install", elapsed_ms: Math.round(performance.now() - started), ...fields })}\n`);
  record({ phase: "installer-start", node: process.version, playwright: lock.packages["node_modules/playwright-core"].version, image_os: safeLabel(env.ImageOS), image_version: safeLabel(env.ImageVersion), timeout_ms: timeoutMs, grace_ms: graceMs });
  return new Promise(resolve => {
    const child = spawn(command, args, { detached: true, stdio: ["ignore", "pipe", "pipe"], env });
    let phase = "installer-start", reason, code, escalation, finished = false;
    const retained = new Map();
    if (process.platform === "linux" && child.pid) retained.set(child.pid, birthTime(child.pid));
    const relay = chunk => {
      const text = chunk.toString();
      if (/Installing dependencies|Switching to root user|apt-get/.test(text)) phase = "os-acquisition";
      if (/Downloading (?:Chromium|Chrome|FFMPEG)/.test(text)) phase = "browser-acquisition";
      output.write(chunk);
    };
    child.stdout.on("data", relay); child.stderr.on("data", relay);
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline); clearTimeout(escalation);
      process.off("SIGTERM", cancel); process.off("SIGINT", interrupt);
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
      record({ phase, reason, code }); resolve({ phase, reason, code });
    };
    const stop = (why, exitCode) => {
      if (reason) return;
      reason = why; code = exitCode;
      clearTimeout(deadline);
      const stopped = performance.now();
      try { signalOwned(child.pid, retained, "SIGTERM"); } catch { record({ phase: "cleanup-failed" }); code = 1; }
      escalation = setTimeout(() => {
        try { signalOwned(child.pid, retained, "SIGKILL"); } catch { record({ phase: "cleanup-failed" }); code = 1; }
        finish();
      }, Math.max(0, graceMs - (performance.now() - stopped) - (process.platform === "linux" ? 2000 : 0)));
      if (!child.pid) finish();
    };
    const cancel = () => stop("cancelled", 143), interrupt = () => stop("cancelled", 130);
    process.once("SIGTERM", cancel); process.once("SIGINT", interrupt);
    const deadline = setTimeout(() => stop("timeout", 124), timeoutMs);
    child.once("error", () => { reason = "spawn-failed"; code = 1; finish(); });
    child.once("exit", (exitCode, signal) => {
      if (reason) return;
      if (exitCode !== 0) stop(signal ? "signal" : "exit", exitCode ?? 1);
    });
    child.once("close", exitCode => { if (!reason && exitCode === 0) { reason = "exit"; code = 0; finish(); } });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = (await runInstaller()).code; }
  catch { console.error("Browser installer failed before execution"); process.exitCode = 1; }
}
