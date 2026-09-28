import { describe, expect, it } from "vitest";
import { analyzeObservedPairs } from "../src/web/analysis/mapping_analysis";
import { aggregateMismatchesByPair, mismatchDetails } from "../src/web/analysis/results_analysis";
import { Dataset, FieldComparisonResult } from "../src/web/core/types";
import { resultFromComparisons } from "./support/results";

// Pairs whose old template-string keys ("<null>" sentinel, "|||" separator) collided.
const COLLIDING: Array<[string | null, string | null]> = [
  ["<null>", "X"],
  [null, "X"],
  ["a|||b", "c"],
  ["a", "b|||c"],
];

describe("collision-free composite keys", () => {
  it("keeps sentinel-like and separator-containing values apart in mapping evidence", () => {
    const left: Dataset = { name: "l", columns: ["id", "v"], records: COLLIDING.map(([value], i) => ({ id: String(i), v: value })) };
    const right: Dataset = { name: "r", columns: ["id", "v"], records: COLLIDING.map(([, value], i) => ({ id: String(i), v: value })) };
    const evidence = analyzeObservedPairs(left, right, { left_identity: "id", right_identity: "id", left_field: "v", right_field: "v" });
    expect(evidence).toHaveLength(4);
    expect(evidence.every((pair) => pair.count === 1)).toBe(true);
    expect(evidence.map((pair) => [pair.left_value, pair.right_value])).toEqual(expect.arrayContaining(COLLIDING));
  });

  it("keeps sentinel-like and separator-containing values apart in mismatch pairs", () => {
    const fieldResults: FieldComparisonResult[] = COLLIDING.map(([leftValue, rightValue], i) => ({
      identity: String(i), fieldName: "v",
      leftRawValue: leftValue, rightRawValue: rightValue,
      leftNormalizedValue: leftValue, rightNormalizedValue: rightValue,
      leftCanonicalValue: null, rightCanonicalValue: null,
      leftLine: i + 2, rightLine: i + 2, status: leftValue === null ? "left_null" : "mismatch", mappingName: null,
    }));
    const result = resultFromComparisons(fieldResults);
    const pairs = aggregateMismatchesByPair(result, { fieldName: "v" });
    expect(pairs).toHaveLength(4);
    expect(pairs.every((pair) => pair.employee_count === 1)).toBe(true);
    const nullPair = pairs.find((pair) => pair.left_value === null)!;
    expect(nullPair.right_value).toBe("X");
    expect(mismatchDetails(result, { fieldName: "v", leftValue: null, rightValue: "X", filterLeft: true, filterRight: true })
      .map((item) => item.identity)).toEqual(["1"]);
  });
});
