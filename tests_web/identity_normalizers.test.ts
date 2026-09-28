import { describe, expect, it } from "vitest";
import { analyzeObservedPairs } from "../src/web/analysis/mapping_analysis";
import { buildContract } from "../src/web/core/contract_builder";
import { reconcileIdentities } from "../src/web/core/identity";
import { stripLeadingZeros } from "../src/web/core/normalization";
import { ReconciliationEngine } from "../src/web/core/reconciliation";
import { Dataset, IdentityNormalizerName, ReconciliationContract } from "../src/web/core/types";

const dataset = (name: string, ids: Array<string | null>): Dataset =>
  ({ name, columns: ["id", "v"], records: ids.map((id, index) => ({ id, v: `v${index}` })) });

function statuses(left: Array<string | null>, right: Array<string | null>, normalize?: IdentityNormalizerName[]) {
  return reconcileIdentities(dataset("l", left), dataset("r", right), { leftKey: "id", rightKey: "id", normalize })
    .map((item) => [item.status, item.identity]);
}

describe("identity normalizers", () => {
  it("strips leading zeros but keeps at least one character", () => {
    expect(["0", "000", "007", "00012345", "00A", "A00", " 007", ""].map(stripLeadingZeros))
      .toEqual(["0", "0", "7", "12345", "A", "A00", " 007", ""]);
  });

  it("matches identities exactly by default", () => {
    expect(statuses(["00012345"], ["12345"])).toEqual([["missing_right", "00012345"], ["missing_left", "12345"]]);
  });

  it("matches on the normalized key when strip_leading_zeros is selected", () => {
    expect(statuses(["00012345"], ["12345"], ["strip_leading_zeros"])).toEqual([["matched", "12345"]]);
  });

  it("applies trim and casefold in the declared order", () => {
    expect(statuses([" AB012 "], ["ab012"], ["trim", "casefold"])).toEqual([["matched", "ab012"]]);
    expect(statuses([" 007"], ["7"], ["trim", "strip_leading_zeros"])).toEqual([["matched", "7"]]);
  });

  it("detects duplicates after normalization", () => {
    expect(statuses(["00012345", "12345"], ["12345"], ["strip_leading_zeros"])).toEqual([["duplicate_left", "12345"]]);
    expect(statuses(["Ab", "aB"], ["ab"], ["casefold"])).toEqual([["duplicate_left", "ab"]]);
  });

  it("still reports blank identities as missing, whatever the normalizers", () => {
    expect(statuses(["  ", null], [], ["trim", "strip_leading_zeros"])).toEqual([
      ["missing_identity_left", "  "], ["missing_identity_left", null],
    ]);
  });

  it("records identity normalizers in the wizard contract in canonical order", () => {
    const base = {
      contract_name: "c", left_name: "a", right_name: "b", left_identity: "id", right_identity: "id",
      fields: [{ left_column: "v", right_column: "v", mode: "Exact" as const }],
    };
    expect(buildContract(base).identity).toEqual({ left: "id", right: "id", normalize: [] });
    expect(buildContract({ ...base, identity_normalize: ["casefold", "trim", "strip_leading_zeros", "trim"] }).identity.normalize)
      .toEqual(["trim", "strip_leading_zeros", "casefold"]);
    expect(() => buildContract({ ...base, identity_normalize: ["uppercase" as IdentityNormalizerName] }))
      .toThrow(/unsupported identity normalizer 'uppercase'/);
  });

  it("uses the contract's identity normalizers in the engine and rejects unsupported ones", () => {
    const contract: ReconciliationContract = {
      name: "c", left: { name: "l" }, right: { name: "r" },
      identity: { left: "id", right: "id", normalize: ["strip_leading_zeros"] },
      fields: [{ name: "v", left: "v", right: "v", normalize: [] }], valueMappings: {},
    };
    const result = new ReconciliationEngine().reconcile({ contract, leftDataset: dataset("l", ["0042"]), rightDataset: dataset("r", ["42"]) });
    expect(result.fieldResults.map((item) => [item.identity, item.status])).toEqual([["42", "match_exact"]]);
    const bad = { ...contract, identity: { ...contract.identity, normalize: ["lowercase" as IdentityNormalizerName] } };
    expect(() => new ReconciliationEngine().reconcile({ contract: bad, leftDataset: dataset("l", ["1"]), rightDataset: dataset("r", ["1"]) }))
      .toThrow(/unsupported identity normalizer 'lowercase'/);
  });

  it("uses identity normalizers when collecting mapping evidence", () => {
    const evidence = analyzeObservedPairs(dataset("l", ["001", "002"]), dataset("r", ["1", "2"]), {
      left_identity: "id", right_identity: "id", left_field: "v", right_field: "v", identity_normalize: ["strip_leading_zeros"],
    });
    expect(evidence.reduce((total, pair) => total + pair.count, 0)).toBe(2);
  });
});
