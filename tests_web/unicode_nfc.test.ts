import { describe, expect, it } from "vitest";
import { buildContract } from "../src/web/core/contract_builder";
import { NORMALIZERS } from "../src/web/core/normalization";
import { ReconciliationEngine } from "../src/web/core/reconciliation";
import { ComparisonMode, Dataset } from "../src/web/core/types";

const PRECOMPOSED = "Müller";
const DECOMPOSED = "Müller";

function statusFor(mode: ComparisonMode): string {
  const contract = buildContract({
    contract_name: "c", left_name: "a", right_name: "b", left_identity: "id", right_identity: "id",
    fields: [{ left_column: "name", right_column: "name", mode }],
  });
  const left: Dataset = { name: "a", columns: ["id", "name"], records: [{ id: "1", name: PRECOMPOSED }] };
  const right: Dataset = { name: "b", columns: ["id", "name"], records: [{ id: "1", name: DECOMPOSED }] };
  const result = new ReconciliationEngine().reconcile({ contract, leftDataset: left, rightDataset: right });
  return [...result.fieldResults()][0].status;
}

describe("Unicode NFC", () => {
  it("provides an nfc normalizer", () => {
    expect(NORMALIZERS.resolve("nfc")(DECOMPOSED)).toBe(PRECOMPOSED);
  });

  it("runs nfc first in Normalized text mode", () => {
    const contract = buildContract({
      contract_name: "c", left_name: "a", right_name: "b", left_identity: "id", right_identity: "id",
      fields: [{ left_column: "name", right_column: "name", mode: "Normalized text" }],
    });
    expect(contract.fields[0].normalize).toEqual(["nfc", "trim", "collapse_whitespace", "casefold"]);
  });

  it("matches precomposed and decomposed text only in Normalized text mode", () => {
    expect(statusFor("Normalized text")).toBe("match_normalized");
    expect(statusFor("Exact")).toBe("mismatch");
  });
});
