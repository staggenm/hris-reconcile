// SHA-256 of a source file's raw bytes (before decoding), for the report.
// crypto.subtle needs a secure context, which a Blob worker started from a
// file:// page does not have in every browser, so a small FIPS 180-4
// implementation is the fallback.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

export function sha256HexSync(bytes: Uint8Array): string {
  const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const words = new Uint32Array(64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The final 1–2 blocks: remaining bytes, 0x80 marker, zero padding, 64-bit bit length.
  const fullBlocks = Math.floor(bytes.byteLength / 64);
  const tailLength = bytes.byteLength - fullBlocks * 64;
  const tail = new Uint8Array(tailLength < 56 ? 64 : 128);
  tail.set(bytes.subarray(fullBlocks * 64));
  tail[tailLength] = 0x80;
  const tailView = new DataView(tail.buffer);
  const bitLength = bytes.byteLength * 8;
  tailView.setUint32(tail.length - 8, Math.floor(bitLength / 0x100000000));
  tailView.setUint32(tail.length - 4, bitLength >>> 0);

  const compress = (source: DataView, offset: number) => {
    for (let t = 0; t < 16; t++) words[t] = source.getUint32(offset + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(words[t - 15], 7) ^ rotr(words[t - 15], 18) ^ (words[t - 15] >>> 3);
      const s1 = rotr(words[t - 2], 17) ^ rotr(words[t - 2], 19) ^ (words[t - 2] >>> 10);
      words[t] = (words[t - 16] + s0 + words[t - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let t = 0; t < 64; t++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + words[t]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    hash[0] += a; hash[1] += b; hash[2] += c; hash[3] += d;
    hash[4] += e; hash[5] += f; hash[6] += g; hash[7] += h;
  };

  for (let block = 0; block < fullBlocks; block++) compress(view, block * 64);
  for (let offset = 0; offset < tail.length; offset += 64) compress(tailView, offset);
  return Array.from(hash, (word) => word.toString(16).padStart(8, "0")).join("");
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const digest = new Uint8Array(await subtle.digest("SHA-256", buffer));
      return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch {
      // Not a secure context: fall through to the portable implementation.
    }
  }
  return sha256HexSync(new Uint8Array(buffer));
}
