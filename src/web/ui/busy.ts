// Progress labels for pending worker operations. The newest pending request
// names the work the user is waiting for.
export const BUSY_LABELS = {
  parse: "Reading the file…",
  "suggest-identity": "Looking for the key column…",
  "identity-options": "Checking how the keys line up…",
  "suggest-fields": "Pairing columns…",
  "suggest-modes": "Working out how to compare each column…",
  "mapping-evidence": "Collecting the values to translate…",
  "build-contract": "Checking the settings…",
  reconcile: "Comparing the files…",
  "result-rows": "Loading rows…",
  pairs: "Loading the most common differences…",
  export: "Preparing the download…",
  "import-contract": "Reading the saved settings…",
  "serialize-contract": "Preparing the settings file…",
} as const;

export function busyLabel(pendingTypes: readonly string[]): string | null {
  if (pendingTypes.length === 0) return null;
  const latest = pendingTypes[pendingTypes.length - 1];
  return Object.prototype.hasOwnProperty.call(BUSY_LABELS, latest) ? BUSY_LABELS[latest as keyof typeof BUSY_LABELS] : "Working…";
}
