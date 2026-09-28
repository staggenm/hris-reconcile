import { describe, expect, it } from "vitest";
import { busyLabel, BUSY_LABELS } from "../src/web/ui/busy";

describe("busy labels", () => {
  it("is idle with nothing pending", () => {
    expect(busyLabel([])).toBeNull();
  });

  it("names the most recent pending operation", () => {
    expect(busyLabel(["parse"])).toBe("Reading and profiling the file…");
    expect(busyLabel(["parse", "suggest-identity"])).toBe("Suggesting employee identity fields…");
    expect(busyLabel(["reconcile", "identity-issues"])).toBe("Loading results…");
  });

  it("has a label for every worker operation", () => {
    for (const type of ["parse", "suggest-identity", "score-identity", "mapping-evidence", "reconcile", "export", "pairs", "details", "matching-details", "identity-issues"]) {
      expect(BUSY_LABELS[type as keyof typeof BUSY_LABELS], type).toMatch(/…$/);
    }
    expect(busyLabel(["something-new"])).toBe("Working…");
  });
});
