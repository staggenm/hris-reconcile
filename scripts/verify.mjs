#!/usr/bin/env node
// Full verification pipeline, used locally (`npm run verify`) and in CI:
// typecheck → vitest → build → byte-compare dist with the committed build →
// playwright → fail if the run changed the working tree.
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const ARTIFACT = "dist/hris-reconcile.html";
const ci = Boolean(process.env.CI);

function git(...args) {
  return execFileSync("git", args, { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });
}

// Status plus the content of every change, so an edit to an already-modified
// file is detected too.
function treeState() {
  const hash = createHash("sha256");
  hash.update(git("status", "--porcelain=v1", "-z", "--untracked-files=all"));
  hash.update(git("diff", "--binary", "HEAD"));
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z").toString("utf8").split("\0").filter(Boolean);
  for (const file of untracked) hash.update(file).update(readFileSync(file));
  return hash.digest("hex");
}

function step(name, command, args) {
  console.log(`\n▶ ${name}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) fail(`${name} failed`);
}

function fail(message) {
  console.error(`\n✖ verify: ${message}`);
  process.exit(1);
}

const before = treeState();

step("typecheck", "npx", ["tsc", "--noEmit"]);
step("vitest", "npx", ["vitest", "run"]);
step("build", "npx", ["vite", "build"]);

console.log(`\n▶ byte-compare dist/index.html with committed ${ARTIFACT}`);
const built = readFileSync("dist/index.html");
const committed = git("show", `HEAD:${ARTIFACT}`);
if (!built.equals(committed)) {
  fail(`the build differs from the committed ${ARTIFACT}; run \`npm run build\` and commit the result`);
}
console.log("identical");

step("playwright", "npx", ["playwright", "test"]);

console.log("\n▶ working tree check");
if (treeState() !== before) fail("the verification run modified the working tree");
if (ci && git("status", "--porcelain").length > 0) fail("the working tree is dirty");
console.log("clean");
console.log("\n✔ verify passed");
