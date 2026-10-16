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

## Security and privacy

What the file guarantees:

- **No network.** A Content Security Policy blocks every connection (fetch,
  XHR, WebSocket, beacons, images, frames, form posts), including from the
  processing worker. There is no code that sends data anywhere.
- **No local copies.** Data lives only in the tab's memory. Nothing is written
  to browser storage (no localStorage, IndexedDB, caches or cookies); inputs
  have autofill, form-state restore and spellcheck turned off; page
  translation is disabled; a file dropped outside the drop zones is ignored.
  "Start over" or closing the tab discards everything. Files reach the disk
  only when the operator downloads an export or saved settings.
- **No injection.** File contents are only ever displayed as text; exported
  CSVs neutralize spreadsheet formulas by default; the HTML report contains
  no scripts and has its own blocking policy.

What the operator's environment must provide, because no web page can
control it:

- Only use a browser without extensions that are allowed to access file
  URLs (in Chrome and Edge this is off by default; it can be enforced by policy).
- Disable crash-report uploads and cloud spellcheck/translation by browser
  policy where data rules require it.
- Treat exports like the source files: the Downloads folder, Excel's
  AutoRecover, printing and the clipboard ("Copy summary" contains counts and
  column names, not row values) create copies outside the browser.
- Distribute the HTML from a trusted, read-only location. If the file is
  altered, these guarantees no longer hold; publish its SHA-256 alongside it
  (`shasum -a 256 dist/hris-reconcile.html`).

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
