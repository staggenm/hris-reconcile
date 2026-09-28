import { buildReportMetadata, csvChunks, jsonChunks, ReportMetadata } from "../../src/web/core/export";
import { ReconciliationContract, ReconciliationResult } from "../../src/web/core/types";

// Deterministic metadata for tests that do not care about sources or time.
export const TEST_METADATA: ReportMetadata = buildReportMetadata({
  sources: {
    left: { fileName: "left.csv", encoding: "utf-8", sha256: "0".repeat(64), byteLength: 0 },
    right: { fileName: "right.csv", encoding: "utf-8", sha256: "0".repeat(64), byteLength: 0 },
  },
  excelSafe: true,
  now: new Date(Date.UTC(2026, 0, 1)),
});

// Test conveniences: the application only streams chunks into a Blob.
export function generateReconciliationCsv(
  result: ReconciliationResult,
  options: { mismatchesOnly?: boolean; excelSafe?: boolean } = {},
): string {
  return [...csvChunks(result, options)].join("");
}

export function generateReconciliationJson(
  contract: ReconciliationContract,
  result: ReconciliationResult,
  metadata: ReportMetadata = TEST_METADATA,
): string {
  return [...jsonChunks(contract, result, metadata)].join("");
}
