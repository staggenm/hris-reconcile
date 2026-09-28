import { NormalizerName } from "./types";
import { CASEFOLD_TABLE, WHITESPACE_CODEPOINTS } from "./unicode_casefold";

export type Normalizer = (value: string) => string;

export function nfc(value: string): string {
  return value.normalize("NFC");
}

export function trim(value: string): string {
  const chars = Array.from(value);
  let start = 0;
  let end = chars.length;
  while (start < end && WHITESPACE.has(chars[start])) start++;
  while (end > start && WHITESPACE.has(chars[end - 1])) end--;
  return chars.slice(start, end).join("");
}

// Removes leading "0" characters but never empties the value: "000" -> "0".
export function stripLeadingZeros(value: string): string {
  return value.replace(/^0+(?=.)/su, "");
}

export function uppercase(value: string): string {
  return value.toUpperCase();
}

export function lowercase(value: string): string {
  return value.toLowerCase();
}

export function casefold(value: string): string {
  let result = "";
  for (const character of value) result += CASEFOLD.get(character) ?? character;
  return result;
}

export function collapseWhitespace(value: string): string {
  return replaceWhitespace(value, " ").replace(/ +/g, " ");
}

const CASEFOLD = new Map(Object.entries(CASEFOLD_TABLE));

// Whitespace set pinned in unicode_casefold.ts (origin documented there).
const WHITESPACE = new Set(
  WHITESPACE_CODEPOINTS.map((codepoint) => String.fromCodePoint(codepoint)),
);

function replaceWhitespace(value: string, replacement: string): string {
  let out = "";
  for (const char of value) out += WHITESPACE.has(char) ? replacement : char;
  return out;
}

export class NormalizerRegistry {
  private normalizers: Map<string, Normalizer>;

  constructor(normalizers: Record<string, Normalizer>) {
    this.normalizers = new Map(Object.entries(normalizers));
  }

  resolve(name: string): Normalizer {
    const fn = this.normalizers.get(name);
    if (!fn) {
      throw new Error(`unknown normalizer: ${name}`);
    }
    return fn;
  }
}

export const NORMALIZERS = new NormalizerRegistry({
  nfc,
  trim,
  uppercase,
  lowercase,
  casefold,
  collapse_whitespace: collapseWhitespace,
  strip_leading_zeros: stripLeadingZeros,
});

export function normalize(
  value: string,
  names: Iterable<NormalizerName | string>,
  registry: NormalizerRegistry = NORMALIZERS,
): string {
  let result = value;
  for (const name of names) {
    result = registry.resolve(name)(result);
  }
  return result;
}
