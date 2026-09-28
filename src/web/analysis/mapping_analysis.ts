import { Dataset, IdentityNormalizerName } from "../core/types";
import { reconcileIdentities } from "../core/identity";
import { compareNullableCodePoints } from "../core/compare";

export interface ObservedPair {
  left_value: string | null;
  right_value: string | null;
  count: number;
  matched_percentage: number;
  consistency_percentage: number;
  suggested: boolean;
}

export function analyzeObservedPairs(
  left: Dataset,
  right: Dataset,
  options: {
    left_identity: string;
    right_identity: string;
    left_field: string;
    right_field: string;
    identity_normalize?: IdentityNormalizerName[];
  },
): ObservedPair[] {
  const identities = reconcileIdentities(left, right, {
    leftKey: options.left_identity,
    rightKey: options.right_identity,
    normalize: options.identity_normalize,
  });

  const pairs: [string | null, string | null][] = [];

  for (const identity of identities) {
    if (identity.status !== "matched") continue;
    if (!identity.leftRecord || !identity.rightRecord) {
      throw new Error("matched identity must contain both records");
    }
    pairs.push([
      identity.leftRecord[options.left_field] ?? null,
      identity.rightRecord[options.right_field] ?? null,
    ]);
  }

  const pairCounts = new Map<string, { left: string | null; right: string | null; count: number }>();
  const leftCounts = new Map<string | null, number>();
  const rightCounts = new Map<string | null, number>();

  for (const [l, r] of pairs) {
    const key = JSON.stringify([l, r]);
    const existing = pairCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      pairCounts.set(key, { left: l, right: r, count: 1 });
    }

    leftCounts.set(l, (leftCounts.get(l) || 0) + 1);
    rightCounts.set(r, (rightCounts.get(r) || 0) + 1);
  }

  const total = pairs.length;
  const evidence: ObservedPair[] = [];

  for (const item of pairCounts.values()) {
    const lCount = leftCounts.get(item.left) || 1;
    const rCount = rightCounts.get(item.right) || 1;
    const consistency = Math.min(item.count / lCount, item.count / rCount);

    const matchedPercentage =
      total > 0 ? Math.round((item.count / total) * 10000) / 100 : 0.0;
    const consistencyPercentage = Math.round(consistency * 10000) / 100;
    const suggested =
      item.left !== null &&
      item.right !== null &&
      item.count >= 2 &&
      consistency >= 0.95;

    evidence.push({
      left_value: item.left,
      right_value: item.right,
      count: item.count,
      matched_percentage: matchedPercentage,
      consistency_percentage: consistencyPercentage,
      suggested,
    });
  }

  evidence.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return (
      compareNullableCodePoints(a.left_value, b.left_value) ||
      compareNullableCodePoints(a.right_value, b.right_value)
    );
  });

  return evidence;
}
