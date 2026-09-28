import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsvContent } from "../src/web/analysis/csv";
import { AppError } from "../src/web/core/errors";

const fixture = new Uint8Array(readFileSync(resolve(__dirname, "fixtures/encoding/umlauts_windows1252.csv")));

describe("CSV encoding", () => {
  it("rejects Windows-1252 bytes as UTF-8 and suggests Windows-1252", () => {
    let error: AppError | undefined;
    try {
      parseCsvContent(fixture, "legacy");
    } catch (caught) {
      error = caught as AppError;
    }
    expect(error?.code).toBe("CSV_ENCODING");
    expect(error?.message).toBe(
      "CSV must use UTF-8 encoding. The file may be Windows-1252 (common for Excel exports): choose Windows-1252 as the encoding and upload it again.",
    );
  });

  it("decodes Windows-1252 when selected, including the euro sign", () => {
    const dataset = parseCsvContent(fixture, "legacy", { encoding: "windows-1252" });
    expect(dataset.records.map((record) => [record.name, record.city])).toEqual([
      ["Müller", "Köln"], ["Jäger", "Straße"], ["€uro", "Zürich"],
    ]);
  });

  it("keeps UTF-8 as the default and still strips a UTF-8 BOM", () => {
    const bytes = new TextEncoder().encode("﻿id,name\n1,Müller\n");
    expect(parseCsvContent(bytes, "utf8").columns).toEqual(["id", "name"]);
    expect(parseCsvContent(bytes, "utf8", { encoding: "utf-8" }).records[0].name).toBe("Müller");
  });
});
