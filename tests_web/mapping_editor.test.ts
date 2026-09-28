import { describe, expect, it } from "vitest";
import { ObservedPair } from "../src/web/analysis/mapping_analysis";
import { buildContract, ValueMappingSelection } from "../src/web/core/contract_builder";
import {
  inputFromValue,
  MappingEditorRow,
  rowsFromEvidence,
  selectionsFromRows,
  valueFromInput,
} from "../src/web/ui/mapping_editor";

const pair = (left_value: string | null, right_value: string | null, suggested = true): ObservedPair => ({
  left_value, right_value, count: 2, matched_percentage: 50, consistency_percentage: 100, suggested,
});
const contractWith = (value_mappings: ValueMappingSelection[]) => ({
  contract_name: "c", left_name: "a", right_name: "b", left_identity: "id", right_identity: "id",
  fields: [{ left_column: "status", right_column: "status", mode: "Value mapping" as const, value_mappings }],
});
const row = (left: string | null, right: string | null, canonical: string, accepted = true): MappingEditorRow => ({
  left, right, canonical, accepted, count: 0, consistency_percentage: 0, assessment: "Manual",
});

describe("mapping editor data model", () => {
  it("stores raw evidence values, including null, without display sentinels", () => {
    const rows = rowsFromEvidence([pair("DE01", "1000"), pair(null, "2000", false)]);
    expect(rows.map((item) => [item.left, item.right, item.accepted, item.assessment])).toEqual([
      ["DE01", "1000", true, "High confidence"],
      [null, "2000", false, "Review"],
    ]);
  });

  it("defaults the canonical value to the Dataset B value, falling back to Dataset A", () => {
    const rows = rowsFromEvidence([pair("DE01", "1000"), pair("FT", null, false), pair(null, null, false)]);
    expect(rows.map((item) => item.canonical)).toEqual(["1000", "FT", ""]);
  });

  it("accepts N:1 evidence with default canonicals and no manual edits", () => {
    const rows = rowsFromEvidence([pair("FT", "Full"), pair("F", "Full")]);
    expect(buildContract(contractWith(selectionsFromRows("status", rows))).valueMappings.field_1_status)
      .toEqual({ Full: { left: ["FT", "F"], right: ["Full"] } });
  });

  it("names the field and the conflicting rows for a genuine 1:N conflict", () => {
    const rows = rowsFromEvidence([pair("FT", "Full"), pair("FT", "Full time")]);
    expect(() => buildContract(contractWith(selectionsFromRows("status", rows)))).toThrow(
      "value mapping for field 'status': rows 'FT' ↔ 'Full' → 'Full' and 'FT' ↔ 'Full time' → 'Full time' map Dataset A value 'FT' to different canonical values",
    );
  });

  it("maps empty input to null and preserves every other string exactly", () => {
    expect(valueFromInput("")).toBeNull();
    expect(valueFromInput(" ")).toBe(" ");
    expect(valueFromInput("<missing>")).toBe("<missing>");
    expect(inputFromValue(null)).toBe("");
    expect(inputFromValue("<null>")).toBe("<null>");
  });

  it("accepts a real value that looks like a display sentinel", () => {
    expect(selectionsFromRows("status", [row("<missing>", "<null>", "ODD")])).toEqual([
      { canonical_value: "ODD", left_values: ["<missing>"], right_values: ["<null>"] },
    ]);
  });

  it("rejects an accepted row with a null side by type and ignores unaccepted ones", () => {
    expect(() => selectionsFromRows("status", [row(null, "X", "ONE")])).toThrow(/'status'.*value on both sides/);
    expect(() => selectionsFromRows("status", [row("A", null, "ONE")])).toThrow(/value on both sides/);
    expect(selectionsFromRows("status", [row(null, "X", "ONE", false), row("A", "X", "ONE")])).toHaveLength(1);
  });

  it("requires a canonical value and at least one accepted row", () => {
    expect(() => selectionsFromRows("status", [row("A", "X", "  ")])).toThrow(/canonical value/);
    expect(() => selectionsFromRows("status", [row("A", "X", "ONE", false)])).toThrow(/confirm at least one value mapping for 'status'/);
  });

  it("lets rows share a canonical value so the contract groups them", () => {
    const selections = selectionsFromRows("status", [row("FT", "Full", "FULL"), row("F", "Full", "FULL")]);
    const contract = buildContract(contractWith(selections));
    expect(contract.valueMappings.field_1_status).toEqual({ FULL: { left: ["FT", "F"], right: ["Full"] } });
  });
});
