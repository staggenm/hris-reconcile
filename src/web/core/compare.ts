// Shared ordering for all user-visible output. Compares Unicode code points
// (not UTF-16 code units, not locale collation), so results are identical in
// every browser and locale.
export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  let index = 0;
  for (const character of a) {
    if (index >= b.length) return 1;
    const left = character.codePointAt(0)!;
    const right = b.codePointAt(index)!;
    if (left !== right) return left < right ? -1 : 1;
    index += character.length;
  }
  return index < b.length ? -1 : 0;
}

// null sorts before every string.
export function compareNullableCodePoints(a: string | null, b: string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  return compareCodePoints(a, b);
}
