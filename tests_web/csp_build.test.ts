import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";

// Builds the production artifact into a temp directory (never into the
// working tree) and checks the emitted Content-Security-Policy against it.
let html = "";
let directives = new Map<string, string[]>();

const blocks = (tag: "script" | "style") =>
  Array.from(html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g")), (match) => match[1]);
const sha256 = (text: string) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

beforeAll(async () => {
  const outDir = mkdtempSync(join(tmpdir(), "hris-csp-"));
  try {
    await build({
      configFile: resolve(__dirname, "../vite.config.ts"),
      logLevel: "silent",
      build: { outDir, emptyOutDir: true },
    });
    html = readFileSync(join(outDir, "index.html"), "utf8");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
  const metas = Array.from(html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g));
  expect(metas).toHaveLength(1);
  directives = new Map(metas[0][1].split(";").map((part) => part.trim()).filter(Boolean)
    .map((part) => { const [name, ...values] = part.split(/\s+/); return [name, values]; }));
}, 120_000);

describe("production CSP", () => {
  it("lists exactly the sha256 hashes of the emitted script and style blocks", () => {
    const scripts = blocks("script");
    const styles = blocks("style");
    expect(scripts.length).toBeGreaterThan(0);
    expect(styles.length).toBeGreaterThan(0);
    expect([...directives.get("script-src")!].sort()).toEqual([...new Set(scripts.map(sha256))].sort());
    expect([...directives.get("style-src")!].sort()).toEqual([...new Set(styles.map(sha256))].sort());
  });

  it("has no unsafe keywords and locks down base, forms, network, and workers", () => {
    const policy = [...directives.entries()].map(([name, values]) => [name, ...values].join(" "));
    expect(policy.join("; ")).not.toMatch(/unsafe-/);
    expect(directives.get("default-src")).toEqual(["'none'"]);
    expect(directives.get("connect-src")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'none'"]);
    expect(directives.get("form-action")).toEqual(["'none'"]);
    // Vite's ?worker&inline wrapper falls back to a data: URL if Blob URLs fail;
    // worker-src blob: (no data:) keeps that fallback inert.
    expect(directives.get("worker-src")).toEqual(["blob:"]);
  });

  it("declares the policy before any script or style and has no inline handlers or style attributes", () => {
    const policyAt = html.indexOf('http-equiv="Content-Security-Policy"');
    expect(policyAt).toBeGreaterThan(-1);
    expect(policyAt).toBeLessThan(Math.min(html.indexOf("<script"), html.indexOf("<style")));
    const markup = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, "");
    expect(markup).not.toMatch(/\son[a-z]+=/i);
    expect(markup).not.toMatch(/\sstyle=/i);
  });

  it("strips the source-only guard from the production build", () => {
    expect(html).not.toContain("__HRIS_PRODUCTION__");
    expect(html).not.toContain('"true" !== "true"');
    expect(html).not.toContain("source-only");
  });
});
