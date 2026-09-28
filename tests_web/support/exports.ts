import { csvChunks, jsonChunks } from "../../src/web/core/export";
import { ReconciliationContract, ReconciliationResult } from "../../src/web/core/types";

// Test conveniences: the application only streams chunks into a Blob.
export function generateReconciliationCsv(
  result: ReconciliationResult,
  options: { mismatchesOnly?: boolean; excelSafe?: boolean } = {},
): string {
  return [...csvChunks(result, options)].join("");
}

export function generateReconciliationJson(contract: ReconciliationContract, result: ReconciliationResult): string {
  return [...jsonChunks(contract, result)].join("");
}
