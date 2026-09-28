import { describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { sha256Hex, sha256HexSync } from "../src/web/core/sha256";

const reference = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
// Boundary lengths around the 55/56/64-byte padding edges, plus a larger buffer.
const INPUTS = [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 1000, 1024 * 1024 + 7].map((length) => new Uint8Array(randomBytes(length)));

describe("SHA-256", () => {
  it("matches the known vector for 'abc'", () => {
    expect(sha256HexSync(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it.each(INPUTS.map((bytes) => [bytes.length, bytes] as const))("pure implementation matches node:crypto for %i bytes", (_, bytes) => {
    expect(sha256HexSync(bytes)).toBe(reference(bytes));
  });

  it("hashes an ArrayBuffer through the platform path with the same result", async () => {
    const bytes = INPUTS[INPUTS.length - 1];
    expect(await sha256Hex(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).toBe(reference(bytes));
  });
});
