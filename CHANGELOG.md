# Changelog

## 2.1.1 — 2026-11-09

- Reconciled the approved save-location picker into the TypeScript source. The
  browser uses the picker where available and a Blob URL download elsewhere;
  save completion is awaited, cancellation is silent, and failures use the
  `EXPORT_WRITE_FAILED` error code.
- Replaced export toasts with a persistent, dismissible, assertive red warning
  for data exports, clipboard summaries, and saved settings. Saved contracts
  may contain mapped employee data values.
- Updated the printable report footer and README with the approved-location,
  approved-channel, and intended-purpose deletion reminder.
- Added unit and Playwright coverage for saving, warnings, CSP, browser
  downloads, dismissal, persistence, and light/dark presentation.
