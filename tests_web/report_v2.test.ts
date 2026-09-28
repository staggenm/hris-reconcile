import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsvContent } from "../src/web/analysis/csv";
import { buildContract } from "../src/web/core/contract_builder";
import { contractSha256, serializeContract } from "../src/web/core/contract_document";
import { buildReportMetadata } from "../src/web/core/export";
import { DEFAULT_LIMITS } from "../src/web/core/limits";
import { ReconciliationEngine } from "../src/web/core/reconciliation";
import { APP_VERSION } from "../src/web/core/version";
import { validateJsonSchema } from "./support/json_schema";
import { generateReconciliationCsv, generateReconciliationJson } from "./support/exports";

const schema = JSON.parse(readFileSync(resolve(__dirname, "../schemas/report-2.0.schema.json"), "utf8"));
const contractSchema = JSON.parse(readFileSync(resolve(__dirname, "../schemas/contract-1.0.schema.json"), "utf8"));

const contract = buildContract({
  contract_name: "v2", left_name: "hr", right_name: "pay", left_identity: "id", right_identity: "id",
  fields: [{ left_column: "v", right_column: "v", mode: "Exact" }, { left_column: "w", right_column: "w", mode: "Normalized text" }],
});
const left = parseCsvContent("id,v,w\n1,a,x\n2,b,y\n2,b,y\n,c,z\n4,d,q\n", "hr");
const right = parseCsvContent("id,v,w\n1,a,X\n3,c,z\n4,D,q\n", "pay");
const result = new ReconciliationEngine().reconcile({ contract, leftDataset: left, rightDataset: right });
const source = (fileName: string, byteLength: number) => ({ fileName, encoding: "utf-8" as const, sha256: "a".repeat(64), byteLength });
const metadata = buildReportMetadata({
  sources: { left: source("hr.csv", 41), right: source("pay.csv", 30) },
  excelSafe: false,
  now: new Date(Date.UTC(2026, 8, 28, 12, 30, 5, 7)),
});
const report = JSON.parse(generateReconciliationJson(contract, result, metadata));

describe("JSON report format 2.0", () => {
  it("carries format and run metadata: app version, UTC timestamp, excelSafe, limits", () => {
    expect(report.report_format_version).toBe("2.0");
    expect(report.run_metadata).toEqual({
      app_version: APP_VERSION,
      generated_at: "2026-09-28T12:30:05.007Z",
      contract_sha256: contractSha256(contract),
      processing_mode: "browser",
      excel_safe: false,
      limits: {
        max_file_bytes: DEFAULT_LIMITS.maxFileBytes, max_rows: DEFAULT_LIMITS.maxRows, max_columns: DEFAULT_LIMITS.maxColumns,
        max_cells: DEFAULT_LIMITS.maxCells, max_comparisons: DEFAULT_LIMITS.maxComparisons, max_discrepancies: DEFAULT_LIMITS.maxDiscrepancies,
      },
    });
  });

  it("reads the app version from package.json", () => {
    expect(APP_VERSION).toBe(JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")).version);
  });

  it("describes each source file: name, encoding, SHA-256, size, and shape", () => {
    expect(report.sources.left).toEqual({ name: "hr", file_name: "hr.csv", encoding: "utf-8", sha256: "a".repeat(64), byte_length: 41, record_count: 5, column_count: 3 });
    expect(report.sources.right.file_name).toBe("pay.csv");
  });

  it("embeds the full contract document", () => {
    expect(report.contract).toEqual(JSON.parse(JSON.stringify(serializeContract(contract))));
    expect(validateJsonSchema(contractSchema, report.contract)).toEqual([]);
  });

  it("lists only identity issues and discrepancies, with source rows, and says so in detail_scope", () => {
    expect(report.detail_scope.kind).toBe("discrepancies_and_identity_issues");
    expect(report.detail_scope.description).toMatch(/full\.csv/);
    expect(report.details.identities).toEqual([
      { identity: "2", status: "DUPLICATE_LEFT", left_rows: [3, 4], right_rows: [] },
      { identity: "3", status: "MISSING_LEFT", left_rows: [], right_rows: [3] },
      { identity: null, status: "MISSING_IDENTITY_LEFT", left_rows: [5], right_rows: [] },
    ]);
    expect(report.details.field_comparisons.map((item: Record<string, unknown>) => [item.identity, item.field_name, item.status, item.left_row, item.right_row]))
      .toEqual([["4", "v", "MISMATCH", 6, 4]]);
    expect(report.identity_summary.MATCHED).toBe(2);
    expect(report.field_comparison_summary.MATCH_NORMALIZED).toBe(1);
  });

  it("validates against the 2.0 schema", () => {
    expect(validateJsonSchema(schema, report)).toEqual([]);
  });

  it("keeps the report's contract definition identical to the contract schema", () => {
    const { $schema, $id, title, description, ...contractBody } = contractSchema;
    expect([$schema, typeof $id, typeof title, typeof description]).toEqual(["https://json-schema.org/draft/2020-12/schema", "string", "string", "string"]);
    expect(schema.$defs.contract).toEqual(contractBody);
  });

  it("adds source row columns to both CSV exports", () => {
    const csv = generateReconciliationCsv(result).split("\n");
    expect(csv[0].endsWith(",identity_status,left_source_rows,right_source_rows")).toBe(true);
    expect(csv).toContain("identity,2,,,,,,,,,,DUPLICATE_LEFT,3;4,");
    expect(csv).toContain("identity,,,,,,,,,,,MISSING_IDENTITY_LEFT,5,");
    expect(csv).toContain("field_comparison,4,v,d,D,d,D,,,,MISMATCH,,6,4");
    expect(generateReconciliationCsv(result, { mismatchesOnly: true })).toContain("field_comparison,4,v,d,D,d,D,,,,MISMATCH,,6,4\n");
  });
});
