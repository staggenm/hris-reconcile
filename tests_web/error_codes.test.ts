import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseCsvContent } from "../src/web/analysis/csv";
import { scoreIdentityPair } from "../src/web/analysis/suggestions";
import { buildContract } from "../src/web/core/contract_builder";
import { AppError, deserializeError, ERROR_CATALOGUE, errorCodeOf, serializeError } from "../src/web/core/errors";
import { MappingResolver } from "../src/web/core/mapping";
import { NORMALIZERS } from "../src/web/core/normalization";
import { ReconciliationEngine } from "../src/web/core/reconciliation";
import { Dataset, ReconciliationContract } from "../src/web/core/types";
import { selectionsFromRows } from "../src/web/ui/mapping_editor";

const SOURCE_ROOT = resolve(__dirname, "../src/web");
function sourceFiles(directory = SOURCE_ROOT): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).code;
  }
  throw new Error("expected the action to throw");
}

const base = { contract_name: "c", left_name: "a", right_name: "b", left_identity: "id", right_identity: "id" };
const dataset: Dataset = { name: "d", columns: ["id", "v"], records: [{ id: "1", v: "x" }] };
const contract: ReconciliationContract = {
  name: "c", left: { name: "d" }, right: { name: "d" }, identity: { left: "id", right: "id" },
  fields: [{ name: "v", left: "v", right: "v", normalize: [] }], valueMappings: {},
};
const utf8Invalid = new Uint8Array([0x69, 0x64, 0x0a, 0xff, 0x0a]);

describe("error codes", () => {
  it.each([
    ["CSV_EMPTY", () => parseCsvContent("", "x")],
    ["CSV_ENCODING", () => parseCsvContent(utf8Invalid, "x")],
    ["CSV_HEADER", () => parseCsvContent("a,,b\n1,2,3\n", "x")],
    ["CSV_DUP_HEADER", () => parseCsvContent("a,a\n1,2\n", "x")],
    ["CSV_ROW_WIDTH", () => parseCsvContent("a,b\n1\n", "x")],
    ["CONTRACT_INVALID", () => buildContract({ ...base, fields: [] })],
    ["MAPPING_CONFLICT", () => buildContract({ ...base, fields: [{ left_column: "v", right_column: "v", mode: "Value mapping", value_mappings: [
      { canonical_value: "A", left_values: ["x"], right_values: ["1"] }, { canonical_value: "B", left_values: ["x"], right_values: ["2"] },
    ] }] })],
    ["MAPPING_AMBIGUOUS", () => new MappingResolver({ A: { left: ["x"], right: ["1"] }, B: { left: ["x"], right: ["2"] } })],
    ["MAPPING_INCOMPLETE", () => selectionsFromRows("v", [])],
    ["MAPPING_NOT_FOUND", () => new ReconciliationEngine().reconcile({ contract: { ...contract, fields: [{ ...contract.fields[0], valueMapping: "nope" }] }, leftDataset: dataset, rightDataset: dataset })],
    ["NORMALIZER_UNKNOWN", () => NORMALIZERS.resolve("nope")],
    ["IDENTITY_NORMALIZER_UNSUPPORTED", () => buildContract({ ...base, identity_normalize: ["nope" as never], fields: [{ left_column: "v", right_column: "v", mode: "Exact" }] })],
    ["IDENTITY_COLUMN_UNKNOWN", () => scoreIdentityPair(dataset, dataset, { left_column: "nope", right_column: "id" })],
    ["COLUMNS_MISSING", () => new ReconciliationEngine().reconcile({ contract: { ...contract, identity: { left: "nope", right: "id" } }, leftDataset: dataset, rightDataset: dataset })],
  ])("%s", (code, action) => {
    expect(codeOf(action)).toBe(code);
  });

  it("keeps the existing message text", () => {
    expect(() => parseCsvContent("a,b\n1\n", "x")).toThrow("CSV row 2 has 1 values; expected 2");
    expect(() => parseCsvContent(utf8Invalid, "x")).toThrow(/^CSV must use UTF-8 encoding/);
  });

  it("round-trips the code through the worker message format", () => {
    const restored = deserializeError(serializeError(new AppError("CSV_ROW_WIDTH", "row 2 is short")));
    expect(restored).toBeInstanceOf(AppError);
    expect([restored.code, restored.message]).toEqual(["CSV_ROW_WIDTH", "row 2 is short"]);
    expect(deserializeError({ message: "odd", code: "NOT_A_CODE" }).code).toBe("UNKNOWN");
    expect(errorCodeOf(new TypeError("x"))).toBe("UNKNOWN");
  });

  it("uses one catalogue of unique UPPER_SNAKE codes that covers every code in the source", () => {
    const codes = Object.keys(ERROR_CATALOGUE);
    for (const code of codes) expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
    for (const description of Object.values(ERROR_CATALOGUE)) expect(description.length).toBeGreaterThan(10);
    const used = new Set(sourceFiles().flatMap((file) =>
      Array.from(readFileSync(file, "utf8").matchAll(/(?:AppError|CsvParseError|WizardConfigurationError)\(\s*"([A-Z_0-9]+)"/g), (m) => m[1])));
    expect(used.size).toBeGreaterThan(15);
    for (const code of used) expect(codes, code).toContain(code);
  });

  it("never constructs an uncoded error in application source", () => {
    for (const file of sourceFiles()) {
      if (file.endsWith("errors.ts")) continue;
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/new Error\(/);
      for (const match of text.matchAll(/throw new (\w+)/g)) {
        expect(["AppError", "CsvParseError", "WizardConfigurationError"], `${file}: ${match[0]}`).toContain(match[1]);
      }
    }
  });
});
