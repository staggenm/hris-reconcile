import {
  FieldComparisonResult,
  FieldComparisonStatus,
  IdentityStatus,
  ReconciliationResult,
} from "../core/types";
import { compareCodePoints, compareNullableCodePoints } from "../core/compare";

import { DISCREPANCY_STATUSES, FIELD_STATUSES, isDiscrepancy } from "../core/status";

export { DISCREPANCY_STATUSES, isDiscrepancy };

export interface FieldMismatchSummary {
  field_name: string;
  mismatch_count: number;
  comparison_count: number;
  mismatch_rate_percentage: number;
}

export function aggregateMismatchesByField(
  result: ReconciliationResult,
): FieldMismatchSummary[] {
  const summaries: FieldMismatchSummary[] = [];
  for (const [field, counts] of result.fieldCounts) {
    let total = 0;
    let count = 0;
    for (const status of FIELD_STATUSES) {
      total += counts[status];
      if (DISCREPANCY_STATUSES.has(status)) count += counts[status];
    }
    if (count === 0) continue;
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
    return compareCodePoints(a.field_name, b.field_name);
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
  const details = result.discrepancies.filter(
    (item) => item.fieldName === options.fieldName,
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
    const key = JSON.stringify([item.leftRawValue, item.rightRawValue, item.status]);
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
    return (
      compareNullableCodePoints(a.left_value, b.left_value) ||
      compareNullableCodePoints(a.right_value, b.right_value) ||
      compareCodePoints(a.status, b.status)
    );
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
  return result.discrepancies.filter((item) => {
    if (item.fieldName !== options.fieldName) {
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
  missing_identities: number;
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
    missing_identity_left: 0,
    missing_identity_right: 0,
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

  for (const counts of result.fieldCounts.values()) {
    for (const status of FIELD_STATUSES) fieldCounts[status] += counts[status];
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
      missing_identities:
        identityCounts.missing_identity_left + identityCounts.missing_identity_right,
      field_matches: fieldMatches,
      field_discrepancies: fieldDiscrepancies,
      unmapped_values: fieldCounts.unmapped_left + fieldCounts.unmapped_right,
    },
  };
}

export interface ResultPage<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Matching comparisons are not stored; a page is recomputed by iterating the
// lazy comparison sequence and keeping only the requested window.
export function matchingDetailsPage(
  result: ReconciliationResult,
  options: { page: number; pageSize: number },
): ResultPage<FieldComparisonResult> {
  const start = options.page * options.pageSize;
  const end = start + options.pageSize;
  const rows: FieldComparisonResult[] = [];
  let total = 0;
  for (const item of result.fieldResults()) {
    if (isDiscrepancy(item)) continue;
    if (total >= start && total < end) rows.push(item);
    total++;
  }
  return { rows, total, page: options.page, pageSize: options.pageSize };
}
