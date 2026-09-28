import { Dataset } from "../core/types";
import { casefold } from "../core/normalization";
import { compareCodePoints } from "../core/compare";
import { ColumnProfile, profileDataset } from "./profiling";

const FIELD_ALIASES = new Map<string, number>([
  ["firstname|givenname", 0.92],
  ["givenname|firstname", 0.92],
  ["lastname|surname", 0.92],
  ["surname|lastname", 0.92],
  ["standardhours|weeklyhours", 0.9],
  ["weeklyhours|standardhours", 0.9],
  ["personid|employeenumber", 0.88],
  ["employeenumber|personid", 0.88],
  ["company|companycode", 0.85],
  ["companycode|company", 0.85],
]);

function headerParts(value: string): [string, string[]] {
  const spaced = value.replace(/(?<=[a-z0-9])(?=[A-Z])/g, " ");
  const folded = casefold(spaced);
  const tokens = folded.split(/[^a-z0-9]+/).filter(Boolean);
  return [tokens.join(""), tokens];
}

function getMatchingBlocks(a: string, b: string): number {
  function findLongest(
    alo: number,
    ahi: number,
    blo: number,
    bhi: number,
  ): { alo: number; blo: number; length: number } {
    let bestAlo = alo;
    let bestBlo = blo;
    let bestLength = 0;
    for (let i = alo; i < ahi; i++) {
      for (let j = blo; j < bhi; j++) {
        let k = 0;
        while (i + k < ahi && j + k < bhi && a[i + k] === b[j + k]) {
          k++;
        }
        if (k > bestLength) {
          bestAlo = i;
          bestBlo = j;
          bestLength = k;
        }
      }
    }
    return { alo: bestAlo, blo: bestBlo, length: bestLength };
  }

  function countMatches(alo: number, ahi: number, blo: number, bhi: number): number {
    const match = findLongest(alo, ahi, blo, bhi);
    if (match.length === 0) return 0;
    let total = match.length;
    if (alo < match.alo && blo < match.blo) {
      total += countMatches(alo, match.alo, blo, match.blo);
    }
    if (match.alo + match.length < ahi && match.blo + match.length < bhi) {
      total += countMatches(match.alo + match.length, ahi, match.blo + match.length, bhi);
    }
    return total;
  }

  return countMatches(0, a.length, 0, b.length);
}

export function sequenceMatcherRatio(a: string, b: string): number {
  if (a.length + b.length === 0) return 1.0;
  return (2.0 * getMatchingBlocks(a, b)) / (a.length + b.length);
}

export function scoreFieldPair(leftColumn: string, rightColumn: string): number {
  const [leftCompact, leftTokens] = headerParts(leftColumn);
  const [rightCompact, rightTokens] = headerParts(rightColumn);

  if (leftCompact === rightCompact) {
    return 1.0;
  }

  const characterScore = sequenceMatcherRatio(leftCompact, rightCompact);

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);

  let intersectionCount = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersectionCount++;
    }
  }

  const unionSize = new Set([...leftTokens, ...rightTokens]).size;
  const tokenScore = unionSize > 0 ? intersectionCount / unionSize : 0.0;

  const aliasKey = `${leftCompact}|${rightCompact}`;
  const aliasScore = FIELD_ALIASES.get(aliasKey) ?? 0.0;

  return Math.round(Math.max(characterScore, tokenScore, aliasScore) * 10000) / 10000;
}

function normalizedValues(dataset: Dataset, column: string): Set<string> {
  const result = new Set<string>();
  for (const record of dataset.records) {
    const value = record[column];
    if (value !== null && value !== undefined && value.trim() !== "") {
      result.add(casefold(value.trim()));
    }
  }
  return result;
}

function population(profile: ColumnProfile): number {
  return profile.row_count > 0 ? profile.non_null_count / profile.row_count : 0.0;
}

function identityHeaderAffinity(column: string): number {
  const [compact, tokens] = headerParts(column);
  const tokenSet = new Set(tokens);
  if (
    tokenSet.has("id") ||
    tokenSet.has("identifier") ||
    tokenSet.has("key") ||
    tokenSet.has("number")
  ) {
    return 1.0;
  }
  if (compact.endsWith("id") || compact.includes("personnelnumber")) {
    return 1.0;
  }
  return 0.0;
}

export interface IdentityCandidate {
  left_column: string;
  right_column: string;
  score: number;
  header_similarity: number;
  overlap_percentage: number;
  left_population_percentage: number;
  right_population_percentage: number;
  left_uniqueness_percentage: number;
  right_uniqueness_percentage: number;
  confident: boolean;
  reasons: string[];
  candidates?: IdentityCandidate[];
}

export function buildIdentityCandidate(
  left: Dataset,
  right: Dataset,
  leftProfile: ColumnProfile,
  rightProfile: ColumnProfile,
): IdentityCandidate {
  const headerScore = scoreFieldPair(leftProfile.column_name, rightProfile.column_name);
  const leftValues = normalizedValues(left, leftProfile.column_name);
  const rightValues = normalizedValues(right, rightProfile.column_name);

  let overlapIntersection = 0;
  for (const val of leftValues) {
    if (rightValues.has(val)) {
      overlapIntersection++;
    }
  }

  const maxValuesLen = Math.max(leftValues.size, rightValues.size);
  const overlap = maxValuesLen > 0 ? overlapIntersection / maxValuesLen : 0.0;

  const leftPop = population(leftProfile);
  const rightPop = population(rightProfile);
  const uniqueness =
    Math.min(leftProfile.uniqueness_percentage, rightProfile.uniqueness_percentage) /
    100;
  const identityAffinity = Math.min(
    identityHeaderAffinity(leftProfile.column_name),
    identityHeaderAffinity(rightProfile.column_name),
  );

  const score =
    Math.round(
      (0.2 * headerScore +
        0.15 * Math.min(leftPop, rightPop) +
        0.2 * uniqueness +
        0.35 * overlap +
        0.1 * identityAffinity) *
        10000,
    ) / 10000;

  const confident = score >= 0.72 && overlap >= 0.5 && uniqueness >= 0.8;

  const reasons = [
    `header similarity: ${(headerScore * 100).toFixed(1)}%`,
    `conservative value overlap: ${(overlap * 100).toFixed(1)}%`,
    `lowest population: ${(Math.min(leftPop, rightPop) * 100).toFixed(1)}%`,
    `lowest uniqueness: ${(uniqueness * 100).toFixed(1)}%`,
    `identifier header signal: ${(identityAffinity * 100).toFixed(0)}%`,
  ];

  return {
    left_column: leftProfile.column_name,
    right_column: rightProfile.column_name,
    score,
    header_similarity: Math.round(headerScore * 10000) / 100,
    overlap_percentage: Math.round(overlap * 10000) / 100,
    left_population_percentage: Math.round(leftPop * 10000) / 100,
    right_population_percentage: Math.round(rightPop * 10000) / 100,
    left_uniqueness_percentage: leftProfile.uniqueness_percentage,
    right_uniqueness_percentage: rightProfile.uniqueness_percentage,
    confident,
    reasons,
  };
}

export function suggestIdentity(left: Dataset, right: Dataset): IdentityCandidate {
  const leftProfiles = profileDataset(left);
  const rightProfiles = profileDataset(right);

  const candidates: IdentityCandidate[] = [];
  for (const lp of leftProfiles) {
    for (const rp of rightProfiles) {
      candidates.push(buildIdentityCandidate(left, right, lp, rp));
    }
  }

  if (candidates.length === 0) {
    throw new Error("both datasets must contain at least one column");
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (
      compareCodePoints(a.left_column, b.left_column) ||
      compareCodePoints(a.right_column, b.right_column)
    );
  });

  const best = candidates[0];
  return {
    ...best,
    candidates,
  };
}

export function scoreIdentityPair(
  left: Dataset,
  right: Dataset,
  options: { left_column: string; right_column: string },
): IdentityCandidate {
  const leftProfiles = profileDataset(left);
  const rightProfiles = profileDataset(right);

  const lp = leftProfiles.find((p) => p.column_name === options.left_column);
  if (!lp) throw new Error(`unknown identity column: ${options.left_column}`);

  const rp = rightProfiles.find((p) => p.column_name === options.right_column);
  if (!rp) throw new Error(`unknown identity column: ${options.right_column}`);

  return buildIdentityCandidate(left, right, lp, rp);
}

export interface FieldSuggestion {
  left_column: string;
  right_column: string;
  score: number;
  confident: boolean;
  reason: string;
}

export function suggestFieldMappings(
  leftColumns: string[],
  rightColumns: string[],
  options: {
    excludedLeft?: Set<string>;
    excludedRight?: Set<string>;
    minimumScore?: number;
  } = {},
): FieldSuggestion[] {
  const excludedLeft = options.excludedLeft || new Set<string>();
  const excludedRight = options.excludedRight || new Set<string>();
  const minScore = options.minimumScore ?? 0.65;

  const candidates: FieldSuggestion[] = [];

  for (const leftCol of leftColumns) {
    if (excludedLeft.has(leftCol)) continue;
    for (const rightCol of rightColumns) {
      if (excludedRight.has(rightCol)) continue;
      const score = scoreFieldPair(leftCol, rightCol);
      candidates.push({
        left_column: leftCol,
        right_column: rightCol,
        score,
        confident: score >= 0.8,
        reason: "deterministic header-name similarity",
      });
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (
      compareCodePoints(a.left_column, b.left_column) ||
      compareCodePoints(a.right_column, b.right_column)
    );
  });

  const selected: FieldSuggestion[] = [];
  const usedLeft = new Set<string>();
  const usedRight = new Set<string>();

  for (const cand of candidates) {
    if (cand.score < minScore) continue;
    if (usedLeft.has(cand.left_column) || usedRight.has(cand.right_column)) continue;
    selected.push(cand);
    usedLeft.add(cand.left_column);
    usedRight.add(cand.right_column);
  }

  return selected;
}
