import { describe, expect, it } from "vitest";
import { isDiscrepancy, matchingDetailsPage } from "../src/web/analysis/results_analysis";
import { ReconciliationEngine } from "../src/web/core/reconciliation";
import { Dataset, ReconciliationContract } from "../src/web/core/types";

const EMPLOYEES = 1000;
const dataset = (name: string, mismatchEvery: number): Dataset => ({
  name, columns: ["id", "a", "b"],
  records: Array.from({ length: EMPLOYEES }, (_, i) => ({
    id: String(i).padStart(4, "0"), a: "same", b: mismatchEvery && i % mismatchEvery === 0 ? `${name}-${i}` : "same",
  })),
});
const contract: ReconciliationContract = {
  name: "c", left: { name: "l" }, right: { name: "r" }, identity: { left: "id", right: "id" },
  fields: [{ name: "a", left: "a", right: "a", normalize: [] }, { name: "b", left: "b", right: "b", normalize: [] }],
  valueMappings: {},
};
const run = () => new ReconciliationEngine().reconcile({ contract, leftDataset: dataset("l", 100), rightDataset: dataset("r", 100) });

describe("summary-first results", () => {
  it("stores full records only for non-matching comparisons", () => {
    const result = run();
    expect(Object.keys(result).sort()).toEqual(["discrepancies", "fieldCounts", "fieldResults", "identityResults", "leftDataset", "rightDataset"]);
    expect(result.discrepancies).toHaveLength(10);
    expect(result.discrepancies.every(isDiscrepancy)).toBe(true);
  });

  it("stores matches as per-field status counts in contract field order", () => {
    const counts = run().fieldCounts;
    expect([...counts.keys()]).toEqual(["a", "b"]);
    expect(counts.get("a")!.match_exact).toBe(EMPLOYEES);
    expect(counts.get("b")!.match_exact).toBe(EMPLOYEES - 10);
    expect(counts.get("b")!.mismatch).toBe(10);
  });

  it("recomputes the full comparison sequence lazily, in canonical order, on every iteration", () => {
    const result = run();
    const all = [...result.fieldResults()];
    expect(all).toHaveLength(EMPLOYEES * 2);
    expect(all.slice(0, 2).map((item) => [item.identity, item.fieldName, item.status])).toEqual([
      ["0000", "a", "match_exact"], ["0000", "b", "mismatch"],
    ]);
    expect(all.filter(isDiscrepancy)).toEqual(result.discrepancies);
    expect([...result.fieldResults()]).toEqual(all);
  });

  it("pages matching details by recomputing them from the datasets and contract", () => {
    const result = run();
    const expected = [...result.fieldResults()].filter((item) => !isDiscrepancy(item));
    const page = matchingDetailsPage(result, { page: 2, pageSize: 7 });
    expect(page.total).toBe(EMPLOYEES * 2 - 10);
    expect(page.rows).toEqual(expected.slice(14, 21));
    expect(matchingDetailsPage(result, { page: 1000, pageSize: 7 }).rows).toEqual([]);
  });
});
