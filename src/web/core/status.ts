import { FieldComparisonResult, FieldComparisonStatus, FieldStatusCounts, IdentityStatus } from "./types";

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

// Public (export and report) names of identity statuses.
export const IDENTITY_PUBLIC: Record<IdentityStatus, string> = {
  matched: "MATCHED",
  missing_left: "MISSING_LEFT",
  missing_right: "MISSING_RIGHT",
  duplicate_left: "DUPLICATE_LEFT",
  duplicate_right: "DUPLICATE_RIGHT",
  missing_identity_left: "MISSING_IDENTITY_LEFT",
  missing_identity_right: "MISSING_IDENTITY_RIGHT",
};
