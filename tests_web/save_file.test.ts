import { describe, expect, it, vi } from "vitest";
import { saveBlob } from "../src/web/ui/save_file";

const blob = new Blob(["employee data"], { type: "text/csv" });

describe("saveBlob", () => {
  it("uses the save picker, preserves its folder id, and waits for the write to close", async () => {
    const calls: unknown[][] = [];
    const env = {
      showSaveFilePicker: vi.fn(async (options) => {
        calls.push(["picker", options]);
        return {
          createWritable: async () => ({
            write: async (value: Blob) => { calls.push(["write", value]); },
            close: async () => { calls.push(["close"]); },
            abort: async () => { calls.push(["abort"]); },
          }),
        };
      }),
      createObjectURL: vi.fn(() => { throw new Error("picker path must not make an object URL"); }),
      revokeObjectURL: vi.fn(() => {}),
      download: vi.fn(() => { throw new Error("picker path must not create an anchor download"); }),
      defer: vi.fn(() => { throw new Error("picker path must not schedule URL revocation"); }),
    };

    const result = await saveBlob(blob, "audit.csv", env);

    expect(result).toBe("saved");
    expect(calls).toEqual([
      ["picker", { suggestedName: "audit.csv", id: "hris-reconcile-export" }],
      ["write", blob],
      ["close"],
    ]);
  });

  it("falls back to a blob URL download and revokes it afterwards", async () => {
    const calls: unknown[][] = [];
    let revoke!: () => void;
    const env = {
      createObjectURL: vi.fn((value: Blob) => {
        calls.push(["create", value]);
        return "blob:test-export";
      }),
      revokeObjectURL: vi.fn((url: string) => calls.push(["revoke", url])),
      download: vi.fn((url: string, filename: string) => calls.push(["download", url, filename])),
      defer: vi.fn((callback: () => void) => { revoke = callback; }),
    };

    const result = await saveBlob(blob, "raw.csv", env);

    expect(result).toBe("saved");
    expect(calls).toEqual([
      ["create", blob],
      ["download", "blob:test-export", "raw.csv"],
    ]);
    revoke();
    expect(calls.at(-1)).toEqual(["revoke", "blob:test-export"]);
  });

  it("returns cancelled when the user aborts the picker without starting a write", async () => {
    const error = Object.assign(new Error("user cancelled"), { name: "AbortError" });
    const env = {
      showSaveFilePicker: vi.fn(async () => { throw error; }),
      createObjectURL: vi.fn(() => { throw new Error("cancelled picker must not fall back"); }),
      revokeObjectURL: vi.fn(() => {}),
      download: vi.fn(() => { throw new Error("cancelled picker must not download"); }),
      defer: vi.fn(() => {}),
    };

    await expect(saveBlob(blob, "audit.json", env)).resolves.toBe("cancelled");
    expect(env.showSaveFilePicker).toHaveBeenCalledOnce();
  });

  it("wraps write failures with EXPORT_WRITE_FAILED and aborts the incomplete write", async () => {
    const calls: string[] = [];
    const cause = new Error("disk full");
    const env = {
      showSaveFilePicker: vi.fn(async () => ({
        createWritable: async () => ({
          write: async () => { throw cause; },
          close: async () => { calls.push("close"); },
          abort: async () => { calls.push("abort"); },
        }),
      })),
      createObjectURL: vi.fn(() => { throw new Error("write failures must not fall back"); }),
      revokeObjectURL: vi.fn(() => {}),
      download: vi.fn(() => { throw new Error("write failures must not download"); }),
      defer: vi.fn(() => {}),
    };

    await expect(saveBlob(blob, "audit.json", env)).rejects.toMatchObject({
      code: "EXPORT_WRITE_FAILED",
      cause,
    });
    expect(calls).toEqual(["abort"]);
  });
});
