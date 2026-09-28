import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { validateJsonSchema } from "./support/json_schema";

const loadSchema = (file: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, "../schemas", file), "utf8"));
const schema = loadSchema("report-2.0.schema.json");
const goldenRoot = path.resolve(__dirname, "fixtures/golden");
const goldenReport = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(goldenRoot, name, "report.json"), "utf8"));

describe("web-owned JSON report schema 2.0", () => {
  it("is a draft 2020-12 schema for report format 2.0", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.properties.report_format_version.const).toBe("2.0");
  });

  it("keeps the 1.0 schema for reference", () => {
    const legacy = loadSchema("report-1.0.schema.json");
    expect(legacy.properties.run_metadata.properties.format_version.const).toBe("1.0");
    expect(legacy.description).toMatch(/superseded by report-2\.0\.schema\.json/);
  });

  for (const name of ["core_hr_vs_payroll", "status_matrix"]) {
    it(`accepts the ${name} golden report`, () => {
      expect(validateJsonSchema(schema, goldenReport(name))).toEqual([]);
    });
  }

  const mutations: Array<[string, (report: any) => void, RegExp]> = [
    ["an extra top-level property", (r) => { r.unexpected = 1; }, /\/unexpected: additional property/],
    ["a missing contract", (r) => { delete r.contract; }, /: missing required property 'contract'/],
    ["a wrong format version", (r) => { r.report_format_version = "1.0"; }, /\/report_format_version: expected const/],
    ["an unknown identity status", (r) => { r.details.identities[0].status = "matched"; }, /\/details\/identities\/0\/status: value not in enum/],
    ["a MATCHED identity in the details", (r) => { r.details.identities[0].status = "MATCHED"; }, /\/details\/identities\/0\/status: value not in enum/],
    ["a matching comparison in the details", (r) => { r.details.field_comparisons[0].status = "MATCH_EXACT"; }, /\/details\/field_comparisons\/0\/status: value not in enum/],
    ["a numeric raw value", (r) => { r.details.field_comparisons[0].left_raw_value = 1; }, /left_raw_value: expected type string,null/],
    ["a null identity on a keyed status", (r) => { r.details.identities[0].identity = null; }, /\/details\/identities\/0: matches no anyOf branch.*\/details\/identities\/0\/identity: expected type string/],
    ["a missing-identity status with a numeric identity", (r) => { r.details.identities[0] = { identity: 1, status: "MISSING_IDENTITY_LEFT", left_rows: [2], right_rows: [] }; }, /\/details\/identities\/0\/identity: expected type string,null/],
    ["a source row of 0", (r) => { r.details.field_comparisons[0].left_row = 0; }, /\/details\/field_comparisons\/0\/left_row: below minimum 1/],
    ["a malformed SHA-256", (r) => { r.sources.left.sha256 = "abc"; }, /\/sources\/left\/sha256: does not match pattern/],
    ["a non-UTC timestamp", (r) => { r.run_metadata.generated_at = "2026-01-01T01:00:00.000+01:00"; }, /\/run_metadata\/generated_at: does not match pattern/],
    ["a negative summary count", (r) => { r.identity_summary.MATCHED = -1; }, /\/identity_summary\/MATCHED: below minimum 0/],
    ["a missing summary status", (r) => { delete r.field_comparison_summary.MISMATCH; }, /missing required property 'MISMATCH'/],
    ["an unknown field mode in the contract", (r) => { r.contract.fields[0].mode = "Fuzzy"; }, /\/contract\/fields\/0\/mode: value not in enum/],
  ];
  for (const [label, mutate, expected] of mutations) {
    it(`rejects ${label}`, () => {
      const report = goldenReport("status_matrix");
      mutate(report);
      const errors = validateJsonSchema(schema, report);
      expect(errors.join("\n")).toMatch(expected);
    });
  }

  it("accepts a null identity only for a missing-identity status", () => {
    const report = goldenReport("status_matrix");
    report.details.identities[0] = { identity: null, status: "MISSING_IDENTITY_RIGHT", left_rows: [], right_rows: [9] };
    expect(validateJsonSchema(schema, report)).toEqual([]);
  });

  it("refuses schema keywords the validator does not implement", () => {
    expect(() => validateJsonSchema({ type: "string", oneOf: [] }, "a")).toThrow(/unsupported schema keyword 'oneOf'/);
  });
});
