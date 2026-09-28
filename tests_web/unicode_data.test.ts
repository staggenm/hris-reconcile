import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The casefold and whitespace tables are committed source with no generator.
// Any edit must be deliberate: update this hash and list the change in the phase report.
const PINNED_SHA256 = "4ba3618531dad76597b22db6d4e71e8971e087807329173db80235fdaf9d00cd";

describe("pinned Unicode data", () => {
  it("unicode_casefold.ts matches its pinned SHA-256", () => {
    const bytes = readFileSync(resolve(__dirname, "../src/web/core/unicode_casefold.ts"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(PINNED_SHA256);
  });
});
