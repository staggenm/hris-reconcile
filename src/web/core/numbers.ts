// Number normalization: "10,000", "10000", "$10,000.00", "(1,000)" and the
// SAP-style trailing minus "1,000-" all reduce to one canonical decimal string.
// Parsing is string-based (no floating point), so canonical values are exact.

export type DecimalSeparator = "." | ",";

const SPACES = /[\s   ]/g;
const CURRENCY_SYMBOL = /^[$€£¥₹₩₽₺]|[$€£¥₹₩₽₺]$/u;
const CURRENCY_CODE = /^(?:[A-Z]{3})(?=[\s\d(+\-−.,])|(?<=[\d\s)])(?:[A-Z]{3})$/;
const MINUS = /^[-−]/;
const TRAILING_MINUS = /[-−]$/;

// Grouping characters allowed for each decimal convention. Spaces and
// apostrophes (Swiss) are valid in both.
const GROUPING: Record<DecimalSeparator, string[]> = {
  ".": [",", " ", "'", "’"],
  ",": [".", " ", "'", "’"],
};

function stripAffixes(value: string): { body: string; negative: boolean; } | null {
  let body = value.trim();
  let negative = false;
  let signs = 0;
  const parenthesized = /^\((.*)\)$/s.exec(body);
  if (parenthesized) {
    body = parenthesized[1].trim();
    negative = true;
    signs++;
  }
  // Currency, sign and percent may come in either order, at either end.
  for (let pass = 0; pass < 4; pass++) {
    const before = body;
    body = body.replace(CURRENCY_SYMBOL, "").replace(CURRENCY_CODE, "").trim();
    if (body.endsWith("%")) body = body.slice(0, -1).trim();
    if (MINUS.test(body)) {
      body = body.slice(1).trim();
      negative = true;
      signs++;
    } else if (body.startsWith("+")) {
      body = body.slice(1).trim();
      signs++;
    } else if (TRAILING_MINUS.test(body)) {
      body = body.slice(0, -1).trim();
      negative = true;
      signs++;
    }
    if (body === before) break;
  }
  if (signs > 1 || body === "") return null;
  return { body, negative };
}

function splitBody(body: string, decimal: DecimalSeparator): { integer: string; fraction: string; exponent: number } | null {
  let exponent = 0;
  const exponentMatch = /^(.*?)[eE]([+-]?\d{1,3})$/.exec(body);
  if (exponentMatch) {
    body = exponentMatch[1];
    exponent = Number(exponentMatch[2]);
    // Scientific notation only on plain digits ("1.5E+05"), never with grouping.
    if (!new RegExp(`^\\d*\\${decimal}?\\d*$`).test(body)) return null;
  }
  const decimalAt = body.lastIndexOf(decimal);
  let integer = decimalAt === -1 ? body : body.slice(0, decimalAt);
  const fraction = decimalAt === -1 ? "" : body.slice(decimalAt + 1);
  if (!/^\d*$/.test(fraction)) return null;

  if (!/^\d*$/.test(integer)) {
    // Grouped integer part: one grouping character, 1–3 leading digits, then groups of exactly 3.
    const separator = GROUPING[decimal].find((candidate) => integer.includes(candidate));
    if (separator === undefined) return null;
    const groups = integer.split(separator);
    if (!/^\d{1,3}$/.test(groups[0]) || !groups.slice(1).every((group) => /^\d{3}$/.test(group))) return null;
    integer = groups.join("");
  }
  if (integer === "" && fraction === "") return null;
  return { integer, fraction, exponent };
}

// The canonical decimal string for `value`, or null if it is not a number in
// the given convention. Canonical form: optional "-", no leading zeros, no
// trailing fractional zeros, "." as the decimal point ("1000", "-0.5").
export function parseNumber(value: string, decimal: DecimalSeparator = "."): string | null {
  const affixes = stripAffixes(value.replace(SPACES, " "));
  if (!affixes) return null;
  const parts = splitBody(affixes.body, decimal);
  if (!parts) return null;
  let digits = parts.integer + parts.fraction;
  let point = parts.integer.length + parts.exponent;
  if (point < 0) {
    digits = "0".repeat(-point) + digits;
    point = 0;
  } else if (point > digits.length) {
    digits += "0".repeat(point - digits.length);
  }
  const integer = digits.slice(0, point).replace(/^0+/, "") || "0";
  const fraction = digits.slice(point).replace(/0+$/, "");
  const magnitude = fraction ? `${integer}.${fraction}` : integer;
  return affixes.negative && magnitude !== "0" ? `-${magnitude}` : magnitude;
}

export function isCanonicalNumber(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value);
}

// Exact difference b − a of two canonical numbers, as a canonical string.
export function subtractCanonical(a: string, b: string): string {
  const scale = Math.max(fractionDigits(a), fractionDigits(b));
  const result = toScaled(b, scale) - toScaled(a, scale);
  return fromScaled(result, scale);
}

export function absCanonicalAtMost(value: string, limit: number): boolean {
  return Math.abs(Number(value)) <= limit + 1e-9 * Math.max(1, limit);
}

function fractionDigits(value: string): number {
  const at = value.indexOf(".");
  return at === -1 ? 0 : value.length - at - 1;
}

function toScaled(value: string, scale: number): bigint {
  const negative = value.startsWith("-");
  const [integer, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const scaled = BigInt(integer + fraction.padEnd(scale, "0"));
  return negative ? -scaled : scaled;
}

function fromScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const integer = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, "");
  const magnitude = fraction ? `${integer}.${fraction}` : integer;
  return negative && magnitude !== "0" ? `-${magnitude}` : magnitude;
}

// "1234567.5" → "1,234,567.5" (display only).
export function groupThousands(canonical: string): string {
  const negative = canonical.startsWith("-");
  const [integer, fraction] = (negative ? canonical.slice(1) : canonical).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "−" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}
