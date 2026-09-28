import { describe, expect, it } from "vitest";
import {
  confirmStep,
  EDITS,
  INITIAL_PROGRESS,
  invalidate,
  invalidationNote,
  nextStep,
  reach,
  STEP_IDS,
  stepStates,
} from "../src/web/ui/steps";

describe("step state machine", () => {
  it("starts with only the upload step, active", () => {
    expect(stepStates(INITIAL_PROGRESS)).toEqual({
      upload: "active", identity: "hidden", fields: "hidden", mappings: "hidden", run: "hidden", results: "hidden",
    });
  });

  it("confirming a step marks it done and activates the next one", () => {
    let progress = INITIAL_PROGRESS;
    for (const step of STEP_IDS.slice(0, -1)) progress = confirmStep(progress, step);
    expect(stepStates(progress)).toEqual({
      upload: "done", identity: "done", fields: "done", mappings: "done", run: "done", results: "active",
    });
    expect(nextStep("run")).toBe("results");
    expect(nextStep("results")).toBeNull();
  });

  it("can jump to a step (loading a contract reaches Run comparison)", () => {
    expect(stepStates(reach("run"))).toMatchObject({ upload: "done", mappings: "done", run: "active", results: "hidden" });
  });
});

describe("invalidation rules", () => {
  const atResults = reach("results");

  it.each([
    ["left-file", "upload", "the Dataset A file"],
    ["right-file", "upload", "the Dataset B file"],
    ["left-encoding", "upload", "the Dataset A encoding"],
    ["right-encoding", "upload", "the Dataset B encoding"],
    ["dataset-name", "run", "a dataset name"],
    ["identity-columns", "identity", "the identity fields"],
    ["identity-normalizers", "identity", "identity normalization"],
    ["field-mappings", "fields", "the field mappings"],
    ["value-mappings", "mappings", "the value mappings"],
  ] as const)("%s resets from the %s step because %s changed", (kind, step, reason) => {
    expect(EDITS[kind]).toEqual({ step, reason });
    const { progress, invalidation } = invalidate(atResults, kind);
    expect(invalidation?.trigger).toBe(step);
    expect(invalidation?.reason).toBe(reason);
    expect(invalidation?.cleared).toEqual(STEP_IDS.slice(STEP_IDS.indexOf(step) + 1));
    expect(stepStates(progress)[step]).toBe("stale");
    for (const later of invalidation!.cleared) expect(stepStates(progress)[later]).toBe("hidden");
  });

  it("does nothing when the edited step is the current one (nothing downstream to reset)", () => {
    const atFields = reach("fields");
    const { progress, invalidation } = invalidate(atFields, "field-mappings");
    expect(invalidation).toBeNull();
    expect(progress).toBe(atFields);
    expect(stepStates(progress).fields).toBe("active");
  });

  it("clears only what was reached", () => {
    const { invalidation } = invalidate(reach("mappings"), "identity-columns");
    expect(invalidation?.cleared).toEqual(["fields", "mappings"]);
  });

  it("confirming the stale step clears the stale state", () => {
    const { progress } = invalidate(atResults, "value-mappings");
    expect(stepStates(confirmStep(progress, "mappings"))).toMatchObject({ mappings: "done", run: "active" });
  });

  it("explains a reset in one sentence, naming results when they were lost", () => {
    expect(invalidationNote(invalidate(atResults, "value-mappings").invalidation!)).toBe("Results reset because the value mappings changed.");
    expect(invalidationNote(invalidate(reach("mappings"), "identity-columns").invalidation!)).toBe("Later steps reset because the identity fields changed.");
  });
});
