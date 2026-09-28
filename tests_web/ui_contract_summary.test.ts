import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildContract } from "../src/web/core/contract_builder";
import { parseContractDocument } from "../src/web/core/contract_document";
import { canPrefillWizard, contractSummary } from "../src/web/ui/contract_summary";
import { reachSkipping, stepStates } from "../src/web/ui/steps";

const golden = parseContractDocument(JSON.parse(readFileSync(resolve(__dirname, "fixtures/golden/status_matrix/contract.json"), "utf8")));

describe("contract summary", () => {
  it("knows when the wizard cannot represent a contract", () => {
    expect(canPrefillWizard(golden)).toBe(false);
    expect(canPrefillWizard(buildContract({
      contract_name: "c", left_name: "a", right_name: "b", left_identity: "id", right_identity: "id",
      fields: [{ left_column: "v", right_column: "v", mode: "Normalized text" }],
    }))).toBe(true);
  });

  it("summarizes identity, fields with modes and normalizers, and mapping counts", () => {
    expect(contractSummary(golden)).toEqual({
      name: "status_matrix",
      identity: "id ↔ id (exact)",
      fields: [
        { name: "text", columns: "text ↔ text", mode: "Custom", normalizers: "trim, casefold", mapping: "—" },
        { name: "mapped", columns: "mapped ↔ mapped", mode: "Value mapping", normalizers: "—", mapping: "codes: 1 canonical value, 1 Dataset A value, 1 Dataset B value" },
      ],
    });
  });
});

describe("skipping wizard steps", () => {
  it("runs an imported contract straight to results with the wizard steps hidden", () => {
    expect(stepStates(reachSkipping("results", ["fields", "mappings", "run"]))).toEqual({
      upload: "done", identity: "done", fields: "hidden", mappings: "hidden", run: "hidden", results: "active",
    });
  });
});
