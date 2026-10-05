# HRIS Reconcile

An internal, browser-based tool for IT and business colleagues to validate and
reconcile HRIS, payroll, and related business data. It compares two CSV files
using an explicit reconciliation contract and produces downloadable CSV and
JSON results.

## Use the standalone tool

Open `dist/hris-reconcile.html` in a supported desktop browser. The file is
self-contained; processing stays in the browser and the application makes no
network requests. Uploaded data remains in the browser tab and is only written
to disk if a user downloads an export.

Treat downloaded reports and source files according to the sensitivity of the
data they contain.

## Build from source

Requires Node.js 24.21.0 and npm.

```bash
npm ci
npm run build
```

The build writes `dist/hris-reconcile.html`. For local development, run
`npm run dev` and open the local address printed by Vite. The app source and
styling are in `src/web/`.

## License

This repository is for internal organizational use under the terms in
[`LICENSE`](LICENSE). Third-party dependencies retain their own licenses.
