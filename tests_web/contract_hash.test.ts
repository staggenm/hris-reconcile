import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildContract } from "../src/web/core/contract_builder";
import { canonicalContractJson, contractSha256, parseContractDocument, serializeContract } from "../src/web/core/contract_document";
import { ReconciliationEngine } from "../src/web/core/reconciliation";
import { generateReconciliationJson } from "./support/exports";

const base = {
  contract_name: "c", left_name: "a", right_name: "b", left_identity: "id", right_identity: "id",
  fields: [
    { left_column: "v", right_column: "v", mode: "Exact" as const },
    { left_column: "s", right_column: "s", mode: "Value mapping" as const, value_mappings: [
      { canonical_value: "FULL", left_values: ["FT"], right_values: ["Full"] },
      { canonical_value: "PART", left_values: ["PT"], right_values: ["Part"] },
    ] },
  ],
};

describe("contract_sha256", () => {
  it("is the SHA-256 of the canonical contract JSON (sorted keys, no whitespace)", () => {
    const contract = buildContract(base);
    const canonical = canonicalContractJson(contract);
    expect(canonical).not.toMatch(/\s(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    expect(canonical.startsWith('{"fields":[{"left":"v","mode":"Exact","name":"v","normalize":[],"right":"v","value_mapping":null}')).toBe(true);
    expect(contractSha256(contract)).toBe(createHash("sha256").update(canonical, "utf8").digest("hex"));
  });

  it("gives identical contracts identical hashes, regardless of key order", () => {
    const document = serializeContract(buildContract(base));
    const reordered = JSON.parse(JSON.stringify({
      value_mappings: { field_2_s: { PART: document.value_mappings.field_2_s.PART, FULL: document.value_mappings.field_2_s.FULL } },
      fields: document.fields.map(({ value_mapping, normalize, mode, right, left, name }) => ({ value_mapping, normalize, mode, right, left, name })),
      identity: { normalize: [], right: "id", left: "id" }, right: { name: "b" }, left: { name: "a" }, name: "c", schema_version: "1.0",
    }));
    expect(contractSha256(parseContractDocument(reordered))).toBe(contractSha256(buildContract(base)));
  });

  it("changes when the contract changes", () => {
    const changed = buildContract({ ...base, identity_normalize: ["trim"] });
    expect(contractSha256(changed)).not.toBe(contractSha256(buildContract(base)));
  });

  it("is recorded in the report's run_metadata", () => {
    const contract = buildContract(base);
    const empty = { name: "d", columns: ["id", "v", "s"], records: [] };
    const result = new ReconciliationEngine().reconcile({ contract, leftDataset: empty, rightDataset: empty });
    expect(JSON.parse(generateReconciliationJson(contract, result)).run_metadata.contract_sha256).toBe(contractSha256(contract));
  });
});
