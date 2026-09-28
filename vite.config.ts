import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "path";

export default defineConfig({
  root: "src/web",
  plugins: [
    {
      name: "html-conversion-entry-csp",
      transformIndexHtml: {
        order: "pre",
        handler(html, context) {
          const production = context.server === undefined;
          const csp = production
            ? "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; img-src data:; worker-src blob:; child-src 'none'; frame-src 'none';"
            : "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*; img-src data:; worker-src 'self' blob:; child-src 'none'; frame-src 'none';";
          return html
            .replace("__HRIS_PRODUCTION__", production ? "true" : "false")
            .replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(">)/, `$1${csp}$2`);
        },
      },
    },
    viteSingleFile(),
  ],
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: false,
  },
  test: {
    root: resolve(__dirname),
    include: ["tests_web/**/*.test.ts"],
    environment: "node",
  },
});
