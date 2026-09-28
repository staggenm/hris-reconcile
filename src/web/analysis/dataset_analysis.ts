import { casefold } from "../core/normalization";
import { Dataset } from "../core/types";
import { ColumnProfile, profileColumn } from "./profiling";

// One dataset plus lazily computed, cached per-column statistics. The worker
// keeps one per dataset per session, so identity suggestion and scoring never
// recompute a column.
export class DatasetAnalysis {
  private readonly profileCache = new Map<string, ColumnProfile>();
  private readonly valueCache = new Map<string, Set<string>>();

  constructor(readonly dataset: Dataset) {}

  profiles(): ColumnProfile[] {
    return this.dataset.columns.map((column) => this.profile(column)!);
  }

  profile(column: string): ColumnProfile | undefined {
    if (!this.dataset.columns.includes(column)) return undefined;
    let profile = this.profileCache.get(column);
    if (!profile) {
      profile = this.computeProfile(column);
      this.profileCache.set(column, profile);
    }
    return profile;
  }

  // Trimmed, casefolded, non-blank values: the conservative identity overlap basis.
  normalizedValues(column: string): Set<string> {
    let values = this.valueCache.get(column);
    if (!values) {
      values = this.computeNormalizedValues(column);
      this.valueCache.set(column, values);
    }
    return values;
  }

  computeProfile(column: string): ColumnProfile {
    return profileColumn(this.dataset, column);
  }

  computeNormalizedValues(column: string): Set<string> {
    const result = new Set<string>();
    for (const record of this.dataset.records) {
      const value = record[column];
      if (value !== null && value !== undefined && value.trim() !== "") {
        result.add(casefold(value.trim()));
      }
    }
    return result;
  }
}

export function analysisOf(input: Dataset | DatasetAnalysis): DatasetAnalysis {
  return input instanceof DatasetAnalysis ? input : new DatasetAnalysis(input);
}
