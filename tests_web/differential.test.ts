import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseCsvContent } from "../src/web/analysis/csv";
import { generateReconciliationCsv, generateReconciliationJson } from "../src/web/core/export";
import { ReconciliationEngine } from "../src/web/core/reconciliation";
import { MappingConfig, ReconciliationContract } from "../src/web/core/types";

const fixtureDir = path.resolve(__dirname, "fixtures/python_reference/core_hr_vs_payroll");
function read(name: string): string { return fs.readFileSync(path.join(fixtureDir, name), "utf8"); }

function toTypeScriptContract(source: Record<string, any>): ReconciliationContract {
  const mappings: Record<string, MappingConfig> = Object.create(null);
  for (const [name, entries] of Object.entries(source.value_mappings ?? {})) {
    const mapping: MappingConfig = Object.create(null);
    for (const [canonical, values] of Object.entries(entries as Record<string, any>)) {
      mapping[canonical] = { left: [...values.left], right: [...values.right] };
    }
    mappings[name] = mapping;
  }
  return {
    name: source.name,
    left: { name: source.left.name }, right: { name: source.right.name },
    identity: source.identity,
    fields: source.fields.map((field: Record<string, any>) => ({
      name: field.name, left: field.left, right: field.right,
      normalize: field.normalize ?? [], valueMapping: field.value_mapping ?? null,
    })),
    valueMappings: mappings,
  };
}

describe("Python differential reference", () => {
  it("matches complete Python report and CSV exports", () => {
    const contract = toTypeScriptContract(JSON.parse(read("contract.json")));
    const left = parseCsvContent(read("core_hr.csv"), "core_hr");
    const right = parseCsvContent(read("payroll.csv"), "payroll");
    const result = new ReconciliationEngine().reconcile({ contract, leftDataset: left, rightDataset: right });
    const expectedReport = JSON.parse(read("report.json"));
    const actualReport = JSON.parse(generateReconciliationJson(contract, result));
    expectedReport.run_metadata.processing_mode = "browser";
    expect(actualReport).toEqual(expectedReport);
    expect(generateReconciliationCsv(result)).toBe(read("full.csv"));
    expect(generateReconciliationCsv(result, { mismatchesOnly: true })).toBe(read("mismatches.csv"));
  });

  it("covers every public identity and field status with Python-generated expectations", () => {
    const directory = path.resolve(__dirname, "fixtures/python_reference/status_matrix");
    const fixture = (name: string) => fs.readFileSync(path.join(directory, name), "utf8");
    const source = JSON.parse(fixture("contract.json"));
    const contract = toTypeScriptContract(source);
    const left = parseCsvContent(fixture("left.csv"), "left");
    const right = parseCsvContent(fixture("right.csv"), "right");
    const result = new ReconciliationEngine().reconcile({ contract, leftDataset: left, rightDataset: right });
    const expected = JSON.parse(fixture("report.json"));
    expected.run_metadata.processing_mode = "browser";
    expect(JSON.parse(generateReconciliationJson(contract, result))).toEqual(expected);
    expect(generateReconciliationCsv(result)).toBe(fixture("full.csv"));
    expect(generateReconciliationCsv(result, { mismatchesOnly: true })).toBe(fixture("mismatches.csv"));
    expect(Object.keys(expected.identity_summary)).toHaveLength(5);
    expect(Object.keys(expected.field_comparison_summary)).toHaveLength(9);
  });
});
