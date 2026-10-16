// Evidence-based defaults: which identity options and which comparison mode
// make the data line up. Every suggestion is measured on the uploaded rows
// (matched records, sampled) and explained in plain words; nothing is applied
// without being shown to the user first.

import { modeNormalizers } from "../core/contract_builder";
import { reconcileIdentities } from "../core/identity";
import { normalize } from "../core/normalization";
import { parseNumber } from "../core/numbers";
import { parseDate } from "../core/dates";
import { ComparisonMode, Dataset, IDENTITY_NORMALIZERS, IdentityNormalizerName, RecordRow, ValueFormat } from "../core/types";
import { suggestFieldMappings } from "./suggestions";

// ---------- Identity options ----------

export interface IdentityOptionsSuggestion {
  normalize: IdentityNormalizerName[];
  // Distinct non-blank keys per side, and keys found on both sides, with the suggested options.
  left_keys: number;
  right_keys: number;
  matched_keys: number;
  // Keys found on both sides with exact matching, for comparison.
  exact_matched_keys: number;
  // Keys found on both sides for every combination of options, so the UI can
  // report the effect of whatever the user ticks.
  by_options: Array<{ normalize: IdentityNormalizerName[]; left_keys: number; right_keys: number; matched_keys: number }>;
}

// Every subset of the identity options, smallest first.
const IDENTITY_OPTION_SETS: IdentityNormalizerName[][] = [0, 1, 2, 4, 3, 5, 6, 7].map((bits) =>
  IDENTITY_NORMALIZERS.filter((_, position) => bits & (1 << position)),
);

export const optionsKey = (names: readonly IdentityNormalizerName[]) => IDENTITY_NORMALIZERS.filter((name) => names.includes(name)).join(",");

function keySet(dataset: Dataset, column: string, normalizers: IdentityNormalizerName[]): Set<string> {
  const keys = new Set<string>();
  for (const record of dataset.records) {
    const value = record[column];
    if (value === null || value === undefined || value.trim() === "") continue;
    keys.add(normalize(value, normalizers));
  }
  return keys;
}

function overlap(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const key of left) if (right.has(key)) count++;
  return count;
}

// The smallest set of identity options that matches the most keys.
export function suggestIdentityOptions(left: Dataset, right: Dataset, leftColumn: string, rightColumn: string): IdentityOptionsSuggestion {
  const byOptions = IDENTITY_OPTION_SETS.map((options) => {
    const leftKeys = keySet(left, leftColumn, options);
    const rightKeys = keySet(right, rightColumn, options);
    return { normalize: options, left_keys: leftKeys.size, right_keys: rightKeys.size, matched_keys: overlap(leftKeys, rightKeys) };
  });
  let best = byOptions[0];
  for (const candidate of byOptions) if (candidate.matched_keys > best.matched_keys) best = candidate;
  // Trimming spaces is harmless, so it rides along with any other option.
  const suggested = best.normalize.length > 0 && !best.normalize.includes("trim")
    ? byOptions.find((candidate) => optionsKey(candidate.normalize) === optionsKey(["trim", ...best.normalize])) ?? best
    : best;
  return { ...suggested, exact_matched_keys: byOptions[0].matched_keys, by_options: byOptions };
}

// ---------- Comparison modes ----------

export interface ModeSuggestion {
  left_column: string;
  right_column: string;
  mode: ComparisonMode;
  format?: ValueFormat;
  // One sentence for people, e.g. "Same numbers written differently (“10,000” vs “10000”)."
  reason: string;
  // Share of sampled rows (with values on both sides) that match exactly, and with the suggested mode.
  exact_match_percentage: number;
  match_percentage: number;
  sampled_rows: number;
}

export const MODE_SAMPLE_ROWS = 2000;

interface Candidate {
  mode: ComparisonMode;
  format?: ValueFormat;
}

// Preference order: on equal results, the earlier (simpler) mode wins.
const CANDIDATES: Candidate[] = [
  { mode: "Exact" },
  { mode: "Normalized text" },
  { mode: "Number", format: "decimal_point" },
  { mode: "Number", format: "decimal_comma" },
  { mode: "Date", format: "dmy" },
  { mode: "Date", format: "mdy" },
];

const percentage = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const quote = (value: string) => `“${value.length > 24 ? `${value.slice(0, 23)}…` : value}”`;

function share(values: string[], test: (value: string) => boolean): number {
  if (values.length === 0) return 0;
  let count = 0;
  for (const value of values) if (test(value)) count++;
  return count / values.length;
}

const isNumber = (value: string) => parseNumber(value, ".") !== null || parseNumber(value, ",") !== null;
const isDate = (value: string) => parseDate(value, "dmy") !== null || parseDate(value, "mdy") !== null;

function matchesWith(pairs: Array<[string, string]>, candidate: Candidate): { count: number; example: [string, string] | null } {
  const chain = modeNormalizers(candidate.mode, candidate.format);
  let count = 0;
  let example: [string, string] | null = null;
  for (const [left, right] of pairs) {
    if (left === right) {
      count++;
    } else if (chain.length > 0 && normalize(left, chain) === normalize(right, chain)) {
      count++;
      example ??= [left, right];
    }
  }
  return { count, example };
}

// Share of rows whose value faces its most common partner, in the weaker of
// the two directions: 1 for a perfect translation, lower for noise.
function translationAgreement(pairs: Array<[string, string]>): number {
  const direction = (from: 0 | 1) => {
    const groups = new Map<string, Map<string, number>>();
    for (const pair of pairs) {
      const targets = groups.get(pair[from]) ?? new Map<string, number>();
      targets.set(pair[1 - from], (targets.get(pair[1 - from]) ?? 0) + 1);
      groups.set(pair[from], targets);
    }
    let dominant = 0;
    for (const targets of groups.values()) dominant += Math.max(...targets.values());
    return dominant / pairs.length;
  };
  return Math.min(direction(0), direction(1));
}

// Low-cardinality fields whose values pair up consistently ("F" opposite
// "Female", "G6" opposite "6") are code translations. A few genuine
// differences don't hide the pattern.
function looksLikeCodeTranslation(pairs: Array<[string, string]>): [string, string] | null {
  const leftValues = new Set(pairs.map(([left]) => left));
  const rightValues = new Set(pairs.map(([, right]) => right));
  if (leftValues.size > 50 || rightValues.size > 50 || pairs.length < 4) return null;
  if (translationAgreement(pairs) < 0.8) return null;
  const counts = new Map<string, number>();
  for (const [left, right] of pairs) {
    if (left === right) continue;
    const key = JSON.stringify([left, right]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let example: [string, string] | null = null;
  let best = 1;
  for (const [key, count] of counts) {
    if (count > best) {
      best = count;
      example = JSON.parse(key) as [string, string];
    }
  }
  return example;
}

function suggestMode(leftColumn: string, rightColumn: string, pairs: Array<[string, string]>): ModeSuggestion {
  const base = { left_column: leftColumn, right_column: rightColumn, sampled_rows: pairs.length };
  if (pairs.length === 0) {
    return { ...base, mode: "Exact", reason: "No matched rows have values on both sides, so values are compared exactly.", exact_match_percentage: 0, match_percentage: 0 };
  }
  const values = pairs.flat();
  const numeric = share(values, isNumber) >= 0.9;
  const dates = share(values, isDate) >= 0.9;

  const exact = matchesWith(pairs, CANDIDATES[0]).count;
  let best: { candidate: Candidate; count: number; example: [string, string] | null } = { candidate: CANDIDATES[0], count: exact, example: null };
  for (const candidate of CANDIDATES.slice(1)) {
    if (candidate.mode === "Number" && !numeric) continue;
    if (candidate.mode === "Date" && !dates) continue;
    const result = matchesWith(pairs, candidate);
    if (result.count > best.count) best = { candidate, ...result };
  }

  const exactPct = percentage(exact, pairs.length);
  const bestPct = percentage(best.count, pairs.length);
  const result = { ...base, exact_match_percentage: exactPct, match_percentage: bestPct };

  if (bestPct < 90) {
    const translation = looksLikeCodeTranslation(pairs);
    if (translation) {
      return {
        ...result, mode: "Value mapping", match_percentage: exactPct,
        reason: `The files use different codes for the same thing (${quote(translation[0])} vs ${quote(translation[1])}). Review the translations.`,
      };
    }
  }

  const { candidate, example } = best;
  const sample = example ? ` (${quote(example[0])} vs ${quote(example[1])})` : "";
  switch (candidate.mode) {
    case "Normalized text":
      return { ...result, mode: candidate.mode, reason: `Same text with different capitals or spacing${sample}.` };
    case "Number":
      return { ...result, mode: candidate.mode, format: candidate.format, reason: `Same numbers written differently${sample}.` };
    case "Date":
      return { ...result, mode: candidate.mode, format: candidate.format, reason: `Same dates written differently${sample}.` };
    default:
      // Numeric columns compare as numbers even when formats agree, so each
      // difference is shown as an amount (B − A).
      if (numeric) {
        const reason = exactPct === 100 ? "Numbers, identical in the rows checked." : `Numbers: ${exactPct}% already match; the difference is shown for the rest.`;
        return { ...result, mode: "Number", format: values.some((value) => parseNumber(value, ".") === null && parseNumber(value, ",") !== null) ? "decimal_comma" : "decimal_point", reason };
      }
      return { ...result, mode: "Exact", reason: exactPct === 100 ? "Identical in the rows checked." : `${exactPct}% of rows match exactly; the others look like real differences.` };
  }
}

interface IdentityOptions {
  leftIdentity: string;
  rightIdentity: string;
  identityNormalize?: IdentityNormalizerName[];
}

// The first `limit` matched record pairs, in key order (deterministic).
function matchedSample(left: Dataset, right: Dataset, options: IdentityOptions, limit: number): Array<{ left: RecordRow; right: RecordRow }> {
  const matched: Array<{ left: RecordRow; right: RecordRow }> = [];
  for (const identity of reconcileIdentities(left, right, { leftKey: options.leftIdentity, rightKey: options.rightIdentity, normalize: options.identityNormalize })) {
    if (identity.status !== "matched" || !identity.leftRecord || !identity.rightRecord) continue;
    matched.push({ left: identity.leftRecord, right: identity.rightRecord });
    if (matched.length >= limit) break;
  }
  return matched;
}

function valuePairs(sample: Array<{ left: RecordRow; right: RecordRow }>, leftColumn: string, rightColumn: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const row of sample) {
    const leftValue = row.left[leftColumn];
    const rightValue = row.right[rightColumn];
    if (leftValue !== null && leftValue !== undefined && rightValue !== null && rightValue !== undefined) pairs.push([leftValue, rightValue]);
  }
  return pairs;
}

export function suggestComparisonModes(
  left: Dataset,
  right: Dataset,
  options: IdentityOptions & { fields: Array<{ left_column: string; right_column: string }>; sampleRows?: number },
): ModeSuggestion[] {
  const sample = matchedSample(left, right, options, options.sampleRows ?? MODE_SAMPLE_ROWS);
  return options.fields.map((field) => suggestMode(field.left_column, field.right_column, valuePairs(sample, field.left_column, field.right_column)));
}

// ---------- Column pairs ----------

export interface FieldPairSuggestion {
  left_column: string;
  right_column: string;
  // "name": similar headers; "content": the values line up on matched rows.
  by: "name" | "content";
  reason: string;
}

export const PAIR_SAMPLE_ROWS = 500;
const CONTENT_PAIR_THRESHOLD = 0.8;

// Share of rows whose values agree, allowing formatting differences and
// consistent code translations ("F" ↔ "Female"). Constant columns never pair.
function contentAgreement(pairs: Array<[string, string]>): { score: number; translated: boolean } {
  if (pairs.length < 3) return { score: 0, translated: false };
  const leftDistinct = new Set(pairs.map(([value]) => value)).size;
  const rightDistinct = new Set(pairs.map(([, value]) => value)).size;
  if (leftDistinct < 2 || rightDistinct < 2) return { score: 0, translated: false };
  const values = pairs.flat();
  const numeric = share(values, isNumber) >= 0.9;
  const dates = share(values, isDate) >= 0.9;
  let best = 0;
  for (const candidate of CANDIDATES) {
    if ((candidate.mode === "Number" && !numeric) || (candidate.mode === "Date" && !dates)) continue;
    best = Math.max(best, matchesWith(pairs, candidate).count / pairs.length);
  }
  if (best >= CONTENT_PAIR_THRESHOLD || leftDistinct > 50 || rightDistinct > 50) return { score: best, translated: false };
  // Translation: each value on one side almost always faces the same value on the other.
  const translated = translationAgreement(pairs);
  return translated > best ? { score: translated, translated: true } : { score: best, translated: false };
}

// Columns paired by similar names first, then leftover columns by content.
export function suggestFieldPairs(left: Dataset, right: Dataset, options: IdentityOptions): FieldPairSuggestion[] {
  const byName = suggestFieldMappings(left.columns, right.columns, {
    excludedLeft: new Set([options.leftIdentity]),
    excludedRight: new Set([options.rightIdentity]),
  }).map((item): FieldPairSuggestion => ({
    left_column: item.left_column,
    right_column: item.right_column,
    by: "name",
    reason: item.left_column === item.right_column ? "Same column name" : "Similar column names",
  }));
  const usedLeft = new Set([options.leftIdentity, ...byName.map((item) => item.left_column)]);
  const usedRight = new Set([options.rightIdentity, ...byName.map((item) => item.right_column)]);
  const leftovers = { left: left.columns.filter((column) => !usedLeft.has(column)), right: right.columns.filter((column) => !usedRight.has(column)) };

  const candidates: Array<{ left: string; right: string; score: number; translated: boolean }> = [];
  if (leftovers.left.length > 0 && leftovers.right.length > 0 && leftovers.left.length * leftovers.right.length <= 2500) {
    const sample = matchedSample(left, right, options, PAIR_SAMPLE_ROWS);
    for (const leftColumn of leftovers.left) {
      for (const rightColumn of leftovers.right) {
        const agreement = contentAgreement(valuePairs(sample, leftColumn, rightColumn));
        if (agreement.score >= CONTENT_PAIR_THRESHOLD) candidates.push({ left: leftColumn, right: rightColumn, ...agreement });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score || leftovers.left.indexOf(a.left) - leftovers.left.indexOf(b.left) || leftovers.right.indexOf(a.right) - leftovers.right.indexOf(b.right));
  const byContent: FieldPairSuggestion[] = [];
  for (const candidate of candidates) {
    if (usedLeft.has(candidate.left) || usedRight.has(candidate.right)) continue;
    usedLeft.add(candidate.left);
    usedRight.add(candidate.right);
    const agreement = `${Math.round(candidate.score * 100)}%`;
    byContent.push({
      left_column: candidate.left,
      right_column: candidate.right,
      by: "content",
      reason: candidate.translated ? `Different names, but the values correspond in ${agreement} of rows` : `Different names, but the values agree in ${agreement} of rows`,
    });
  }
  // In File A's column order, so the list reads like the file.
  return [...byName, ...byContent].sort((a, b) => left.columns.indexOf(a.left_column) - left.columns.indexOf(b.left_column));
}
