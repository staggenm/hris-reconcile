// Progress labels for pending worker operations. The newest pending request
// names the work the user is waiting for.
export const BUSY_LABELS = {
  parse: "Reading and profiling the file…",
  "suggest-identity": "Suggesting employee identity fields…",
  "score-identity": "Checking identity overlap…",
  "mapping-evidence": "Collecting value-mapping evidence…",
  reconcile: "Reconciling…",
  export: "Preparing the download…",
  pairs: "Loading results…",
  details: "Loading results…",
  "matching-details": "Loading results…",
  "identity-issues": "Loading results…",
} as const;

export function busyLabel(pendingTypes: readonly string[]): string | null {
  if (pendingTypes.length === 0) return null;
  const latest = pendingTypes[pendingTypes.length - 1];
  return Object.prototype.hasOwnProperty.call(BUSY_LABELS, latest) ? BUSY_LABELS[latest as keyof typeof BUSY_LABELS] : "Working…";
}
