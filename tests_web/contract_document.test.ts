import { describe, expect, it } from "vitest";
import { buildContract, WizardConfiguration } from "../src/web/core/contract_builder";
import {
  CONTRACT_SCHEMA_VERSION,
  parseContractDocument,
  serializeContract,
  validateContractColumns,
  wizardStateFromContract,
} from "../src/web/core/contract_document";
import { AppError } from "../src/web/core/errors";
import { ReconciliationEngine } from "../src/web/core/reconciliation";
import { Dataset } from "../src/web/core/types";
import { selectionsFromRows } from "../src/web/ui/mapping_editor";
import { generateReconciliationCsv } from "./support/exports";

const wizard: WizardConfiguration = {
  contract_name: "hr_vs_payroll", left_name: "hr", right_name: "payroll",
  left_identity: "person_id", right_identity: "employee_number", identity_normalize: ["trim", "strip_leading_zeros"],
  fields: [
    { left_column: "name", right_column: "given_name", mode: "Normalized text" },
    { left_column: "status", right_column: "status_code", mode: "Value mapping", value_mappings: [
      { canonical_value: "Full", left_values: ["FT"], right_values: ["Full"] },
      { canonical_value: "Full", left_values: ["F"], right_values: ["Full"] },
      { canonical_value: "Part", left_values: ["PT"], right_values: ["Part", "P"] },
    ] },
    { left_column: "city", right_column: "town", mode: "Exact" },
  ],
};
const left: Dataset = {
  name: "hr", columns: ["person_id", "name", "status", "city"],
  records: [
    { person_id: "001", name: " Ada ", status: "FT", city: "Berlin" },
    { person_id: "002", name: "Grace", status: "PT", city: "Bonn" },
    { person_id: "003", name: "Linus", status: "X", city: "Köln" },
  ],
};
const right: Dataset = {
  name: "payroll", columns: ["employee_number", "given_name", "status_code", "town"],
  records: [
    { employee_number: "1", given_name: "ada", status_code: "Full", town: "Berlin" },
    { employee_number: "2", given_name: "Grace", status_code: "P", town: "Hamburg" },
    { employee_number: "3", given_name: "Linus", status_code: "Full", town: "Köln" },
  ],
};

function thrown(action: () => unknown): AppError {
  try {
    action();
  } catch (error) {
    return error as AppError;
  }
  throw new AppError("INTERNAL", "expected the action to throw");
}

describe("contract document", () => {
  const contract = buildContract(wizard);

  it("serializes with a schema_version, identity normalizers, modes, and grouped value mappings", () => {
    const document = serializeContract(contract);
    expect(document.schema_version).toBe(CONTRACT_SCHEMA_VERSION);
    expect(document.identity).toEqual({ left: "person_id", right: "employee_number", normalize: ["trim", "strip_leading_zeros"] });
    expect(document.fields.map((field) => [field.name, field.mode, field.normalize, field.value_mapping])).toEqual([
      ["name", "Normalized text", ["nfc", "trim", "collapse_whitespace", "casefold"], null],
      ["status", "Value mapping", [], "field_2_status"],
      ["city", "Exact", [], null],
    ]);
    expect(document.value_mappings.field_2_status).toEqual({ Full: { left: ["FT", "F"], right: ["Full"] }, Part: { left: ["PT"], right: ["Part", "P"] } });
  });

  it("round-trips export → JSON → import → identical reconciliation result", () => {
    const imported = parseContractDocument(JSON.parse(JSON.stringify(serializeContract(contract))));
    expect(imported).toEqual(contract);
    const before = new ReconciliationEngine().reconcile({ contract, leftDataset: left, rightDataset: right });
    const after = new ReconciliationEngine().reconcile({ contract: imported, leftDataset: left, rightDataset: right });
    expect(generateReconciliationCsv(after)).toBe(generateReconciliationCsv(before));
    expect(after.discrepancies.length).toBeGreaterThan(0);
  });

  it("pre-fills the wizard, and the wizard rebuilds the same contract", () => {
    const state = wizardStateFromContract(contract);
    expect(state.identity).toEqual({ left_column: "person_id", right_column: "employee_number", normalize: ["trim", "strip_leading_zeros"] });
    expect(state.fields).toEqual([
      { left_column: "name", right_column: "given_name", mode: "Normalized text" },
      { left_column: "status", right_column: "status_code", mode: "Value mapping" },
      { left_column: "city", right_column: "town", mode: "Exact" },
    ]);
    const rows = state.mappingRows.get("status")!;
    expect(rows.every((row) => row.accepted && row.assessment === "Imported")).toBe(true);
    const rebuilt = buildContract({
      ...wizard, identity_normalize: state.identity.normalize,
      fields: state.fields.map((field) => field.mode === "Value mapping"
        ? { ...field, value_mappings: selectionsFromRows(field.left_column, state.mappingRows.get(field.left_column)!) }
        : field),
    });
    expect(rebuilt).toEqual(contract);
  });

  it("validates the contract against the uploaded columns and names every missing column", () => {
    expect(() => validateContractColumns(contract, left.columns, right.columns)).not.toThrow();
    const error = thrown(() => validateContractColumns(contract, ["person_id", "name"], ["employee_number", "given_name", "status_code"]));
    expect(error.code).toBe("COLUMNS_MISSING");
    expect(error.message).toBe("the contract does not fit the uploaded files: Dataset A is missing 'status', 'city'; Dataset B is missing 'town'");
  });

  it("rejects malformed documents with clear, coded errors", () => {
    const valid = serializeContract(contract);
    const cases: Array<[string, unknown, string, RegExp]> = [
      ["not an object", "[]", "CONTRACT_INVALID", /not a contract document/],
      ["an unsupported schema version", { ...valid, schema_version: "9.0" }, "CONTRACT_INVALID", /schema_version '9.0' is not supported \(expected '1.0'\)/],
      ["a missing identity", { ...valid, identity: undefined }, "CONTRACT_INVALID", /identity/],
      ["an unknown normalizer", { ...valid, fields: [{ ...valid.fields[2], normalize: ["shout"] }] }, "NORMALIZER_UNKNOWN", /shout/],
      ["a mode that contradicts the normalizers", { ...valid, fields: [{ ...valid.fields[2], mode: "Normalized text" }] }, "CONTRACT_INVALID", /field 'city'.*mode/],
      ["a missing value mapping", { ...valid, value_mappings: {} }, "MAPPING_NOT_FOUND", /field_2_status/],
      ["an unsupported identity normalizer", { ...valid, identity: { ...valid.identity, normalize: ["uppercase"] } }, "IDENTITY_NORMALIZER_UNSUPPORTED", /uppercase/],
    ];
    for (const [label, input, code, message] of cases) {
      const error = thrown(() => parseContractDocument(typeof input === "string" ? JSON.parse(input) : input));
      expect([label, error.code]).toEqual([label, code]);
      expect(error.message, label).toMatch(message);
    }
  });

  it("parses contracts with custom normalizers but refuses to pre-fill them into the wizard", () => {
    const custom = parseContractDocument({
      ...serializeContract(contract),
      fields: [{ name: "name", left: "name", right: "given_name", mode: "Custom", normalize: ["trim", "casefold"], value_mapping: null }],
      value_mappings: {},
    });
    expect(custom.fields[0].normalize).toEqual(["trim", "casefold"]);
    const error = thrown(() => wizardStateFromContract(custom));
    expect([error.code, error.message]).toEqual(["CONTRACT_INVALID", "field 'name' uses normalizers trim, casefold, which the wizard cannot represent"]);
  });
});
