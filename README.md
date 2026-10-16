# HRIS Reconcile

An internal, browser-based tool for IT and business colleagues to validate and
reconcile HRIS, payroll, and related business data. It compares two CSV files
using an explicit reconciliation contract and produces downloadable CSV and
JSON results.

## Use the standalone tool

Open `dist/hris-reconcile.html` in a supported desktop browser, then:

1. **Load files**: drop the two CSV exports (File A and File B). The text
   encoding is detected automatically.
2. **Match settings**: the key column, the column pairs and the way each pair
   is compared are filled in from the data, each with a plain-language reason:
   numbers that are formatted differently (`10,000` vs `10000`), dates in
   different formats, capitals and spacing, or codes that need translating
   (`F` vs `Female`). Review, adjust, and press **Compare files**.
3. **Results**: the tiles filter the table (matched, differ, only in A, only
   in B, key warnings). When differences look like formatting only, the tool
   offers a one-click fix. Export the differences or a side-by-side comparison
   as CSV for Excel, a printable HTML report, or a copyable summary; the JSON
   audit report and raw CSVs are under "For audits".

Settings can be saved and loaded again for the next run. The file is
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
