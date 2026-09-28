/// <reference types="vite/client" />

// true only in `npm run bench` builds (HRIS_BENCH=1), which lift the volume limits.
declare const __HRIS_BENCH__: boolean;
// package.json "version", injected at build time.
declare const __APP_VERSION__: string;
