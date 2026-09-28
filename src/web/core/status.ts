import { FieldComparisonResult, FieldComparisonStatus, FieldStatusCounts } from "./types";

export const FIELD_STATUSES: readonly FieldComparisonStatus[] = [
  "match_exact",
  "match_normalized",
  "match_mapped",
  "both_null",
  "left_null",
  "right_null",
  "unmapped_left",
  "unmapped_right",
  "mismatch",
];

export const DISCREPANCY_STATUSES = new Set<FieldComparisonStatus>([
  "mismatch",
  "left_null",
  "right_null",
  "unmapped_left",
  "unmapped_right",
]);

export function isDiscrepancy(result: FieldComparisonResult): boolean {
  return DISCREPANCY_STATUSES.has(result.status);
}

export function emptyFieldCounts(): FieldStatusCounts {
  const counts = Object.create(null) as FieldStatusCounts;
  for (const status of FIELD_STATUSES) counts[status] = 0;
  return counts;
}
