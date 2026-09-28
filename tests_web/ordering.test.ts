import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCsvContent } from "../src/web/analysis/csv";
import { analyzeObservedPairs } from "../src/web/analysis/mapping_analysis";
import { aggregateMismatchesByField, aggregateMismatchesByPair } from "../src/web/analysis/results_analysis";
import { suggestFieldMappings, suggestIdentity } from "../src/web/analysis/suggestions";
import { compareCodePoints, compareNullableCodePoints } from "../src/web/core/compare";
import { reconcileIdentities } from "../src/web/core/identity";
import { ReconciliationEngine } from "../src/web/core/reconciliation";
import { Dataset, FieldComparisonResult } from "../src/web/core/types";
import { resultFromComparisons } from "./support/results";

// Code-point order: "B" (U+42) < "a" (U+61) < "z" (U+7A) < "ä" (U+E4) < U+FFFD < U+1F600.
// Locale collation puts a/B and ä/z the other way; UTF-16 code-unit order puts
// U+1F600 (surrogate 0xD83D) before U+FFFD.
const CODE_POINT_ORDER = ["B", "a", "z", "ä", "�", "\u{1F600}"];
const SHUFFLED = ["\u{1F600}", "ä", "a", "�", "z", "B"];

beforeEach(() => {
  // Any locale-dependent comparison fails loudly, so results cannot vary by locale.
  vi.spyOn(String.prototype, "localeCompare").mockImplementation(() => {
    throw new Error("localeCompare must not be used");
  });
});
afterEach(() => vi.restoreAllMocks());

const dataset = (name: string, key: string, ids: string[]): Dataset =>
  ({ name, columns: [key, "v"], records: ids.map((id) => ({ [key]: id, v: id })) });

const mismatch = (fieldName: string, left: string | null, right: string | null): FieldComparisonResult => ({
  identity: "1", fieldName, leftRawValue: left, rightRawValue: right,
  leftNormalizedValue: left, rightNormalizedValue: right,
  leftCanonicalValue: null, rightCanonicalValue: null,
  status: left === null ? "left_null" : "mismatch", mappingName: null,
});
const resultOf = (fieldResults: FieldComparisonResult[]) => resultFromComparisons(fieldResults);

describe("shared code-point comparator", () => {
  it("orders by Unicode code point, not locale or UTF-16 code unit", () => {
    expect([...SHUFFLED].sort(compareCodePoints)).toEqual(CODE_POINT_ORDER);
    expect(compareCodePoints("a", "ab")).toBeLessThan(0);
    expect(compareCodePoints("ab", "a")).toBeGreaterThan(0);
    expect(compareCodePoints("x\u{1F600}", "x\u{1F600}")).toBe(0);
  });

  it("orders null before every string", () => {
    expect([null, "", "a", null].sort(compareNullableCodePoints)).toEqual([null, null, "", "a"]);
  });
});

describe("deterministic, locale-independent output order", () => {
  it("identity results", () => {
    const results = reconcileIdentities(dataset("l", "id", SHUFFLED), dataset("r", "id", SHUFFLED), { leftKey: "id", rightKey: "id" });
    expect(results.map((item) => item.identity)).toEqual(CODE_POINT_ORDER);
  });

  it("mapping evidence", () => {
    const evidence = analyzeObservedPairs(dataset("l", "id", SHUFFLED), dataset("r", "id", SHUFFLED),
      { left_identity: "id", right_identity: "id", left_field: "v", right_field: "v" });
    expect(evidence.map((pair) => pair.left_value)).toEqual(CODE_POINT_ORDER);
  });

  it("mismatch fields and mismatch pairs", () => {
    const byField = aggregateMismatchesByField(resultOf(SHUFFLED.map((name) => mismatch(name, "x", "y"))));
    expect(byField.map((row) => row.field_name)).toEqual(CODE_POINT_ORDER);
    const byPair = aggregateMismatchesByPair(resultOf([...SHUFFLED, null].map((value) => mismatch("f", value, "y"))), { fieldName: "f" });
    expect(byPair.map((row) => row.left_value)).toEqual([null, ...CODE_POINT_ORDER]);
  });

  it("identity and field suggestions", () => {
    const columns = ["id_b", "id_a", "id_B"];
    const left: Dataset = { name: "l", columns, records: [{ id_b: "1", id_a: "1", id_B: "1" }] };
    expect(suggestIdentity(left, left).candidates!.slice(0, 3).map((c) => [c.left_column, c.right_column]))
      .toEqual([["id_B", "id_B"], ["id_B", "id_b"], ["id_a", "id_a"]]);
    expect(suggestFieldMappings(["b", "B"], ["b", "B"]).map((s) => s.left_column)).toEqual(["B", "b"]);
  });

  it("error messages that list names", () => {
    expect(() => parseCsvContent("a,\u{1F600},�,\u{1F600},�,a\n1,2,3,4,5,6\n", "x"))
      .toThrow("CSV contains duplicate column names: a, �, \u{1F600}");
    const engine = new ReconciliationEngine();
    const empty: Dataset = { name: "d", columns: [], records: [] };
    expect(() => engine.reconcile({
      contract: { name: "c", left: { name: "d" }, right: { name: "d" }, identity: { left: "\u{1F600}", right: "x" },
        fields: [{ name: "f", left: "�", right: "x", normalize: [] }], valueMappings: {} },
      leftDataset: empty, rightDataset: { name: "r", columns: ["x"], records: [] },
    })).toThrow("missing required columns: �, \u{1F600}");
  });
});
