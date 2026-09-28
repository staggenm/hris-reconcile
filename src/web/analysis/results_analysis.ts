import {
  FieldComparisonResult,
  FieldComparisonStatus,
  IdentityStatus,
  ReconciliationResult,
} from "../core/types";

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

export interface FieldMismatchSummary {
  field_name: string;
  mismatch_count: number;
  comparison_count: number;
  mismatch_rate_percentage: number;
}

export function aggregateMismatchesByField(
  result: ReconciliationResult,
): FieldMismatchSummary[] {
  const totals = new Map<string, number>();
  const mismatches = new Map<string, number>();

  for (const item of result.fieldResults) {
    totals.set(item.fieldName, (totals.get(item.fieldName) || 0) + 1);
    if (isDiscrepancy(item)) {
      mismatches.set(item.fieldName, (mismatches.get(item.fieldName) || 0) + 1);
    }
  }

  const summaries: FieldMismatchSummary[] = [];
  for (const [field, count] of mismatches.entries()) {
    const total = totals.get(field) || count;
    summaries.push({
      field_name: field,
      mismatch_count: count,
      comparison_count: total,
      mismatch_rate_percentage: Math.round((count / total) * 10000) / 100,
    });
  }

  summaries.sort((a, b) => {
    if (b.mismatch_count !== a.mismatch_count) {
      return b.mismatch_count - a.mismatch_count;
    }
    return a.field_name.localeCompare(b.field_name);
  });

  return summaries;
}

export interface PairMismatchSummary {
  field_name: string;
  left_value: string | null;
  right_value: string | null;
  status: FieldComparisonStatus;
  employee_count: number;
  percentage: number;
}

export function aggregateMismatchesByPair(
  result: ReconciliationResult,
  options: { fieldName: string },
): PairMismatchSummary[] {
  const details = result.fieldResults.filter(
    (item) => item.fieldName === options.fieldName && isDiscrepancy(item),
  );

  const counts = new Map<
    string,
    {
      left: string | null;
      right: string | null;
      status: FieldComparisonStatus;
      count: number;
    }
  >();

  for (const item of details) {
    const key = `${item.leftRawValue ?? "<null>"}|||${item.rightRawValue ?? "<null>"}|||${item.status}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count++;
    } else {
      counts.set(key, {
        left: item.leftRawValue,
        right: item.rightRawValue,
        status: item.status,
        count: 1,
      });
    }
  }

  const total = details.length;
  const summaries: PairMismatchSummary[] = [];

  for (const item of counts.values()) {
    summaries.push({
      field_name: options.fieldName,
      left_value: item.left,
      right_value: item.right,
      status: item.status,
      employee_count: item.count,
      percentage: total > 0 ? Math.round((item.count / total) * 10000) / 100 : 0.0,
    });
  }

  summaries.sort((a, b) => {
    if (b.employee_count !== a.employee_count) {
      return b.employee_count - a.employee_count;
    }
    const aLeft = a.left_value || "";
    const bLeft = b.left_value || "";
    if (aLeft !== bLeft) return aLeft.localeCompare(bLeft);
    const aRight = a.right_value || "";
    const bRight = b.right_value || "";
    if (aRight !== bRight) return aRight.localeCompare(bRight);
    return a.status.localeCompare(b.status);
  });

  return summaries;
}

export function mismatchDetails(
  result: ReconciliationResult,
  options: {
    fieldName: string;
    leftValue?: string | null;
    rightValue?: string | null;
    filterLeft?: boolean;
    filterRight?: boolean;
  },
): FieldComparisonResult[] {
  return result.fieldResults.filter((item) => {
    if (item.fieldName !== options.fieldName || !isDiscrepancy(item)) {
      return false;
    }
    if (options.filterLeft && item.leftRawValue !== (options.leftValue ?? null)) {
      return false;
    }
    if (options.filterRight && item.rightRawValue !== (options.rightValue ?? null)) {
      return false;
    }
    return true;
  });
}

export interface ResultsMetrics {
  matched_employees: number;
  missing_left: number;
  missing_right: number;
  duplicate_identities: number;
  field_matches: number;
  field_discrepancies: number;
  unmapped_values: number;
}

export interface ResultsSummary {
  datasets: {
    left: { name: string; record_count: number; column_count: number };
    right: { name: string; record_count: number; column_count: number };
  };
  identity_counts: Record<IdentityStatus, number>;
  field_counts: Record<FieldComparisonStatus, number>;
  metrics: ResultsMetrics;
}

export function computeResultsSummary(result: ReconciliationResult): ResultsSummary {
  const identityCounts: Record<IdentityStatus, number> = {
    matched: 0,
    missing_left: 0,
    missing_right: 0,
    duplicate_left: 0,
    duplicate_right: 0,
  };

  for (const item of result.identityResults) {
    identityCounts[item.status]++;
  }

  const fieldCounts: Record<FieldComparisonStatus, number> = {
    match_exact: 0,
    match_normalized: 0,
    match_mapped: 0,
    both_null: 0,
    left_null: 0,
    right_null: 0,
    unmapped_left: 0,
    unmapped_right: 0,
    mismatch: 0,
  };

  for (const item of result.fieldResults) {
    fieldCounts[item.status]++;
  }

  const fieldMatches =
    fieldCounts.match_exact +
    fieldCounts.match_normalized +
    fieldCounts.match_mapped +
    fieldCounts.both_null;

  let fieldDiscrepancies = 0;
  for (const status of DISCREPANCY_STATUSES) {
    fieldDiscrepancies += fieldCounts[status];
  }

  return {
    datasets: {
      left: {
        name: result.leftDataset.name,
        record_count: result.leftDataset.recordCount,
        column_count: result.leftDataset.columnCount,
      },
      right: {
        name: result.rightDataset.name,
        record_count: result.rightDataset.recordCount,
        column_count: result.rightDataset.columnCount,
      },
    },
    identity_counts: identityCounts,
    field_counts: fieldCounts,
    metrics: {
      matched_employees: identityCounts.matched,
      missing_left: identityCounts.missing_left,
      missing_right: identityCounts.missing_right,
      duplicate_identities:
        identityCounts.duplicate_left + identityCounts.duplicate_right,
      field_matches: fieldMatches,
      field_discrepancies: fieldDiscrepancies,
      unmapped_values: fieldCounts.unmapped_left + fieldCounts.unmapped_right,
    },
  };
}
