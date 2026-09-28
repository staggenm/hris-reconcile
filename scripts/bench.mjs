#!/usr/bin/env node
// Benchmark: `npm run bench [-- --tiers 10000,100000,200000] [--mismatch-rate 0.05]`.
// Not part of verify or CI.
//
// Builds a benchmark copy of the workbench with the volume limits lifted
// (HRIS_BENCH=1), generates synthetic datasets (employee_id + 30 fields, about
// 5% differing comparisons), drives the real UI in Chromium, and measures
// parse, identity suggestion, reconcile and export times plus the peak JS heap
// of the page and the worker (sampled over CDP every 100 ms).
import { spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const FIELDS = 30;
const rateArg = process.argv.indexOf("--mismatch-rate");
// Share of differing comparisons; `--mismatch-rate 1` is the worst case (every comparison kept as a record).
const MISMATCH_RATE = rateArg > 0 ? Number(process.argv[rateArg + 1]) : 0.05;
const STEP_TIMEOUT = 20 * 60 * 1000;
const tiersArg = process.argv.indexOf("--tiers");
const TIERS = tiersArg > 0 ? process.argv[tiersArg + 1].split(",").map(Number) : [10_000, 100_000, 200_000];

const work = mkdtempSync(join(tmpdir(), "hris-bench-"));
process.on("exit", () => rmSync(work, { recursive: true, force: true }));

// 1. Benchmark build (limits lifted).
const outDir = join(work, "build");
const built = spawnSync("npx", ["vite", "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "warn"], {
  stdio: "inherit", env: { ...process.env, HRIS_BENCH: "1" }, shell: process.platform === "win32",
});
if (built.status !== 0) throw new Error("benchmark build failed");
const artifact = pathToFileURL(join(outDir, "hris-reconcile.html")).href;

// 2. Synthetic data.
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WORDS = ["Active", "Berlin", "Payroll", "Full time", "Sales", "DE01", "Manager", "Grade 7", "Monthly", "Remote"];
const header = ["employee_id", ...Array.from({ length: FIELDS }, (_, j) => `field_${String(j + 1).padStart(2, "0")}`)].join(",");

async function writeCsv(path, rows, side) {
  const random = mulberry32(rows * 31 + 7);
  const out = createWriteStream(path);
  const write = (text) => (out.write(text) ? null : new Promise((done) => out.once("drain", done)));
  await write(`${header}\n`);
  for (let i = 0; i < rows; i++) {
    const cells = [`E${String(i).padStart(7, "0")}`];
    for (let j = 0; j < FIELDS; j++) {
      const value = `${WORDS[(i + j) % WORDS.length]} ${(i * 7919 + j * 104729) % 100000}`;
      const differs = random() < MISMATCH_RATE;
      cells.push(side === "right" && differs ? `${value}*` : value);
    }
    await write(`${cells.join(",")}\n`);
  }
  await new Promise((done) => out.end(done));
}

// 3. Heap sampling over a second CDP connection (the worker has its own heap).
class HeapSampler {
  constructor(port, path) {
    this.nextId = 1;
    this.pending = new Map();
    this.sessions = new Map(); // sessionId -> "page" | "worker"
    this.peaks = { page: 0, worker: 0 };
    this.phase = "idle";
    this.phasePeaks = {};
    this.socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    this.socket.onmessage = (event) => this.onMessage(JSON.parse(event.data));
  }
  async open() {
    await new Promise((done, fail) => { this.socket.onopen = done; this.socket.onerror = fail; });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((done, fail) => this.pending.set(id, { done, fail }));
  }
  onMessage(message) {
    if (message.id && this.pending.has(message.id)) {
      const { done, fail } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) fail(new Error(message.error.message)); else done(message.result);
    } else if (message.method === "Target.attachedToTarget") {
      const { sessionId, targetInfo } = message.params;
      if (targetInfo.type === "worker") this.sessions.set(sessionId, "worker");
      this.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
    } else if (message.method === "Target.detachedFromTarget") {
      this.sessions.delete(message.params.sessionId);
    }
  }
  async attachPage(url) {
    const { targetInfos } = await this.send("Target.getTargets");
    const page = targetInfos.find((target) => target.type === "page" && target.url === url);
    const { sessionId } = await this.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
    this.sessions.set(sessionId, "page");
    await this.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
    this.timer = setInterval(() => this.sample(), 100);
  }
  async sample() {
    for (const [sessionId, kind] of this.sessions) {
      try {
        const { usedSize } = await this.send("Runtime.getHeapUsage", {}, sessionId);
        this.peaks[kind] = Math.max(this.peaks[kind], usedSize);
        const key = `${this.phase}:${kind}`;
        this.phasePeaks[key] = Math.max(this.phasePeaks[key] ?? 0, usedSize);
      } catch {
        // target went away between listing and sampling
      }
    }
  }
  // Forces a GC in each target, then reads what is still retained.
  async retained() {
    const retained = {};
    for (const [sessionId, kind] of this.sessions) {
      try {
        await this.send("HeapProfiler.collectGarbage", {}, sessionId);
        retained[kind] = (await this.send("Runtime.getHeapUsage", {}, sessionId)).usedSize;
      } catch {
        // target gone
      }
    }
    return retained;
  }
  close() {
    clearInterval(this.timer);
    this.socket.close();
  }
}

// 4. Drive the UI.
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;
const seconds = (ms) => (ms === null ? "—" : `${(ms / 1000).toFixed(2)} s`);

async function runTier(context, port, path, rows) {
  const leftPath = join(work, `left-${rows}.csv`);
  const rightPath = join(work, `right-${rows}.csv`);
  await writeCsv(leftPath, rows, "left");
  await writeCsv(rightPath, rows, "right");
  const result = {
    rows, fields: FIELDS, comparisons: rows * FIELDS, fileSize: statSync(leftPath).size,
    times: {}, retainedWorker: {}, downloads: {}, metrics: {}, failure: null,
  };

  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT);
  await page.goto(artifact);
  const sampler = new HeapSampler(port, path);
  await sampler.open();
  await sampler.attachPage(artifact);

  // `since` times a step that the UI starts by itself (identity suggestion
  // begins when dataset B is parsed); `retain: false` skips the forced GC so it
  // does not overlap that automatic work.
  let lastEnd = performance.now();
  const step = async (name, action, { since = null, retain = true } = {}) => {
    if (result.failure) return;
    sampler.phase = name;
    const started = since ?? performance.now();
    try {
      await action();
      const code = await page.locator("#error:not(.hidden)").getAttribute("data-code", { timeout: 1 }).catch(() => null);
      if (code) throw new Error(`${code}: ${await page.locator("#error").textContent()}`);
      lastEnd = performance.now();
      result.times[name] = lastEnd - started;
      if (retain) result.retainedWorker[name] = (await sampler.retained()).worker ?? 0;
    } catch (error) {
      result.failure = `${name}: ${String(error.message ?? error).split("\n")[0]}`;
    }
    process.stdout.write(`  ${rows} rows · ${name}: ${result.failure && result.failure.startsWith(name) ? "FAILED" : seconds(result.times[name])}\n`);
  };

  await step("parse A", async () => {
    await page.locator("#left-file").setInputFiles(leftPath);
    await page.locator("#left-dataset").getByText(`${rows} rows`).waitFor();
  });
  await step("parse B", async () => {
    await page.locator("#right-file").setInputFiles(rightPath);
    await page.locator("#right-dataset").getByText(`${rows} rows`).waitFor();
  }, { retain: false });
  await step("identity suggestion", async () => {
    await page.locator("#step-identity").waitFor();
    await page.locator("#identity-evidence").getByText("overlap").waitFor();
  }, { since: lastEnd });
  await step("wizard", async () => {
    await page.locator("#confirm-identity").click();
    await page.locator("#confirm-fields").click();
    await page.locator("#confirm-mappings").click();
    await page.locator("#step-run").waitFor();
  });
  await step("reconcile", async () => {
    await page.locator("#run-reconciliation").click();
    await page.locator("#step-results").waitFor();
  });
  for (const label of ["Matched employees", "Field matches", "Field discrepancies"]) {
    result.metrics[label] = await page.locator(".metric", { hasText: label }).locator("strong").textContent().catch(() => null);
  }
  for (const [label, button] of [["export full.csv", "Full results CSV"], ["export mismatches.csv", "Mismatches only CSV"], ["export report.json", "JSON report"]]) {
    await step(label, async () => {
      const download = page.waitForEvent("download", { timeout: STEP_TIMEOUT });
      await page.getByRole("button", { name: button }).click();
      const file = await download;
      result.downloads[label] = statSync(await file.path()).size;
      await file.delete();
    });
  }
  await new Promise((done) => setTimeout(done, 300));
  sampler.close();
  result.peakHeap = sampler.peaks;
  result.phasePeaks = sampler.phasePeaks;
  await page.close();
  rmSync(leftPath, { force: true });
  rmSync(rightPath, { force: true });
  return result;
}

const profile = join(work, "profile");
const context = await chromium.launchPersistentContext(profile, {
  headless: true, acceptDownloads: true, args: ["--remote-debugging-port=0"],
});
const [portLine, pathLine] = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n");
const results = [];
try {
  for (const rows of TIERS) {
    console.log(`\n▶ ${rows} rows × ${FIELDS} fields`);
    results.push(await runTier(context, portLine.trim(), pathLine.trim(), rows));
  }
} finally {
  await context.close();
}

// 5. Report.
const columns = ["parse A", "parse B", "identity suggestion", "reconcile", "export full.csv", "export mismatches.csv", "export report.json"];
const exports = ["export full.csv", "export mismatches.csv", "export report.json"];
const lines = [
  `Mismatch rate: ${MISMATCH_RATE * 100}% · Machine: ${cpus()[0].model}, ${cpus().length} cores, ${mb(totalmem())} RAM · Node ${process.version} · Chromium ${context.browser()?.version() ?? "(persistent)"}`,
  "",
  `| Rows | File size | Comparisons | ${columns.join(" | ")} | Peak heap (worker / page) | Result |`,
  `|---|---|---|${columns.map(() => "---").join("|")}|---|---|`,
  ...results.map((r) => `| ${r.rows.toLocaleString("en")} | ${mb(r.fileSize)} | ${r.comparisons.toLocaleString("en")} | ${columns.map((c) => seconds(r.times[c] ?? null)).join(" | ")} | ${mb(r.peakHeap.worker)} / ${mb(r.peakHeap.page)} | ${r.failure ?? "ok"} |`),
  "",
  `| Rows | Worker heap retained after reconcile | after exports | Matched / field matches / discrepancies | ${exports.map((e) => e.replace("export ", "")).join(" | ")} |`,
  `|---|---|---|---|${exports.map(() => "---").join("|")}|`,
  ...results.map((r) => `| ${r.rows.toLocaleString("en")} | ${mb(r.retainedWorker.reconcile ?? 0)} | ${mb(r.retainedWorker["export report.json"] ?? 0)} | ${Object.values(r.metrics).join(" / ")} | ${exports.map((e) => (r.downloads[e] === undefined ? "—" : mb(r.downloads[e]))).join(" | ")} |`),
];
console.log(`\n${lines.join("\n")}`);
const reportDir = resolve("test-results/bench");
mkdirSync(reportDir, { recursive: true });
writeFileSync(join(reportDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
writeFileSync(join(reportDir, "results.md"), `${lines.join("\n")}\n`);
console.log(`\nSaved to ${join(reportDir, "results.md")}`);
