import { emptyFieldCounts, isDiscrepancy } from "../../src/web/core/status";
import { FieldComparisonResult, FieldStatusCounts, IdentityResult, ReconciliationResult } from "../../src/web/core/types";

// Builds a summary-first result from an explicit comparison list (for tests).
export function resultFromComparisons(
  fieldResults: FieldComparisonResult[],
  identityResults: IdentityResult[] = [],
): ReconciliationResult {
  const fieldCounts = new Map<string, FieldStatusCounts>();
  for (const item of fieldResults) {
    if (!fieldCounts.has(item.fieldName)) fieldCounts.set(item.fieldName, emptyFieldCounts());
    fieldCounts.get(item.fieldName)![item.status]++;
  }
  return {
    leftDataset: { name: "l", recordCount: 0, columnCount: 0 },
    rightDataset: { name: "r", recordCount: 0, columnCount: 0 },
    identityResults,
    discrepancies: fieldResults.filter(isDiscrepancy),
    fieldCounts,
    fieldResults: () => fieldResults,
  };
}
