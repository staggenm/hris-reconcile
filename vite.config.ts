import { defineConfig, Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";

const APP_VERSION: string = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")).version;

// The build's single output: `npm run build` updates the tracked artifact directly.
const ARTIFACT = "hris-reconcile.html";
const SCRIPT_HASHES = "__CSP_SCRIPT_HASHES__";
const STYLE_HASHES = "__CSP_STYLE_HASHES__";

// Production policy. Script and style hashes are filled in after inlining.
// worker-src is blob: only: Vite's ?worker&inline wrapper falls back to a
// data: URL when Blob URLs fail, and that fallback is inert under this policy.
const PRODUCTION_CSP = [
  "default-src 'none'",
  `script-src ${SCRIPT_HASHES}`,
  `style-src ${STYLE_HASHES}`,
  "connect-src 'none'",
  "img-src data:",
  "worker-src blob:",
  "child-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ") + ";";

const DEVELOPMENT_CSP = "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*; img-src data:; worker-src 'self' blob:; child-src 'none'; frame-src 'none';";

function hashBlocks(html: string, tag: "script" | "style"): string {
  const hashes = new Set<string>();
  for (const match of html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g"))) {
    hashes.add(`'sha256-${createHash("sha256").update(match[1], "utf8").digest("base64")}'`);
  }
  if (hashes.size === 0) throw new Error(`CSP: no inline <${tag}> blocks to hash`);
  return [...hashes].join(" ");
}

function entryCsp(): Plugin {
  return {
    name: "html-conversion-entry-csp",
    transformIndexHtml: {
      order: "pre",
      handler(html, context) {
        const production = context.server === undefined;
        if (production) {
          const stripped = html.replace(/\s*<!-- source-only-guard:[\s\S]*?<!-- \/source-only-guard -->/, "");
          if (stripped === html) throw new Error("CSP: source-only guard markers not found");
          html = stripped;
        }
        return html.replace(
          /(<meta http-equiv="Content-Security-Policy" content=")[^"]*(">)/,
          `$1${production ? PRODUCTION_CSP : DEVELOPMENT_CSP}$2`,
        );
      },
    },
  };
}

// Runs after vite-plugin-singlefile has inlined every script and style, so the
// hashes cover the exact emitted blocks.
function cspHashes(): Plugin {
  return {
    name: "csp-inline-hashes",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== "asset" || !asset.fileName.endsWith(".html")) continue;
        const html = String(asset.source);
        if (!html.includes(SCRIPT_HASHES) || !html.includes(STYLE_HASHES)) {
          throw new Error(`CSP: hash placeholders missing in ${asset.fileName}`);
        }
        asset.source = html
          .replace(SCRIPT_HASHES, hashBlocks(html, "script"))
          .replace(STYLE_HASHES, hashBlocks(html, "style"));
        if (asset.fileName === "index.html") asset.fileName = ARTIFACT;
      }
    },
  };
}

export default defineConfig({
  root: "src/web",
  plugins: [entryCsp(), viteSingleFile(), cspHashes()],
  define: {
    __HRIS_BENCH__: JSON.stringify(process.env.HRIS_BENCH === "1"),
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: false,
    // The polyfill contains an (unused) fetch() path; the app makes no requests.
    modulePreload: { polyfill: false },
  },
  test: {
    root: resolve(__dirname),
    include: ["tests_web/**/*.test.ts"],
    environment: "node",
  },
});
