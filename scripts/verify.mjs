#!/usr/bin/env node
// Verification pipeline: typecheck → vitest → build → playwright → dist
// comparison → working-tree check.
//
//   npm run verify     local: the fresh build must equal the working-tree
//                      dist/hris-reconcile.html (flow: edit → `npm run build` →
//                      verify → commit); the tree check ignores dist/.
//   npm run verify:ci  CI: the fresh build must equal the committed dist, and
//                      the working tree must be clean.
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ARTIFACT = "dist/hris-reconcile.html";
const ci = process.argv.includes("--ci");
const pathspec = ci ? ["."] : [".", ":(exclude)dist"];

function git(...args) {
  return execFileSync("git", args, { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });
}

// Status plus the content of every change, so an edit to an already-modified
// file is detected too.
function treeState() {
  const hash = createHash("sha256");
  hash.update(git("status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...pathspec));
  hash.update(git("diff", "--binary", "HEAD", "--", ...pathspec));
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z", "--", ...pathspec)
    .toString("utf8").split("\0").filter(Boolean);
  for (const file of untracked) hash.update(file).update(readFileSync(file));
  return hash.digest("hex");
}

function step(name, command, args) {
  console.log(`\n▶ ${name}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) fail(`${name} failed`);
}

function fail(message) {
  console.error(`\n✖ verify${ci ? ":ci" : ""}: ${message}`);
  process.exit(1);
}

console.log(`verify mode: ${ci ? "ci (committed dist, strict tree)" : "local (working-tree dist, tree check ignores dist/)"}`);
const before = treeState();

step("typecheck", "npx", ["tsc", "--noEmit"]);
step("vitest", "npx", ["vitest", "run"]);
// Fresh build into a temp directory; verify never writes into dist/.
const outDir = mkdtempSync(join(tmpdir(), "hris-verify-"));
process.on("exit", () => rmSync(outDir, { recursive: true, force: true }));
step("build (temp dir)", "npx", ["vite", "build", "--outDir", outDir, "--emptyOutDir"]);
// Playwright tests the artifact in dist/, which the comparison below proves equal to the fresh build.
step("playwright", "npx", ["playwright", "test"]);

const reference = ci ? `committed ${ARTIFACT}` : `working-tree ${ARTIFACT}`;
console.log(`\n▶ compare fresh build with ${reference}`);
const built = readFileSync(join(outDir, "hris-reconcile.html"));
const expected = ci ? git("show", `HEAD:${ARTIFACT}`) : readFileSync(ARTIFACT);
if (!built.equals(expected)) {
  fail(`the fresh build differs from the ${reference}; run \`npm run build\`${ci ? " and commit the result" : ""}`);
}
console.log("identical");

console.log("\n▶ working tree check");
if (treeState() !== before) fail("the verification run modified the working tree");
if (ci && git("status", "--porcelain").length > 0) fail("the working tree is dirty");
console.log("clean");
console.log(`\n✔ verify${ci ? ":ci" : ""} passed`);
