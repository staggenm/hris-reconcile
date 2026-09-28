import { NormalizerName } from "./types";
import { CASEFOLD_TABLE, PYTHON_WHITESPACE_CODEPOINTS } from "./unicode_casefold";

export type Normalizer = (value: string) => string;

export function trim(value: string): string {
  const chars = Array.from(value);
  let start = 0;
  let end = chars.length;
  while (start < end && PYTHON_WHITESPACE.has(chars[start])) start++;
  while (end > start && PYTHON_WHITESPACE.has(chars[end - 1])) end--;
  return chars.slice(start, end).join("");
}

export function uppercase(value: string): string {
  return value.toUpperCase();
}

export function lowercase(value: string): string {
  return value.toLowerCase();
}

export function casefold(value: string): string {
  let result = "";
  for (const character of value) result += CASEFOLD_TABLE[character] ?? character;
  return result;
}

export function collapseWhitespace(value: string): string {
  return replacePythonWhitespace(value, " ").replace(/ +/g, " ");
}

// Python 3.12 str.isspace() code points. Keep this definition aligned with
// the generated Unicode data provenance in scripts/generate_web_unicode_data.py.
const PYTHON_WHITESPACE = new Set(
  PYTHON_WHITESPACE_CODEPOINTS.map((codepoint) => String.fromCodePoint(codepoint)),
);

function replacePythonWhitespace(value: string, replacement: string): string {
  let out = "";
  for (const char of value) out += PYTHON_WHITESPACE.has(char) ? replacement : char;
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
  trim,
  uppercase,
  lowercase,
  casefold,
  collapse_whitespace: collapseWhitespace,
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
