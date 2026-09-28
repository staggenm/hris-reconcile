import { MappingConfig, NormalizerName } from "./types";
import { normalize } from "./normalization";

export type MappingStatus = "mapped" | "unmapped" | "null";

export interface MappingResolution {
  status: MappingStatus;
  canonicalValue: string | null;
}

export class MappingResolver {
  private leftIndex: Map<string, string> = new Map();
  private rightIndex: Map<string, string> = new Map();

  constructor(mapping: MappingConfig, mappingName = "mapping") {
    validateMapping(mappingName, mapping);
    for (const [canonical, values] of Object.entries(mapping)) {
      for (const val of values.left) {
        this.leftIndex.set(val, canonical);
      }
      for (const val of values.right) {
        this.rightIndex.set(val, canonical);
      }
    }
  }

  resolve(value: string | null, side: "left" | "right"): MappingResolution {
    if (value === null) {
      return { status: "null", canonicalValue: null };
    }
    const index = side === "left" ? this.leftIndex : this.rightIndex;
    const canonical = index.get(value);
    if (canonical === undefined) {
      return { status: "unmapped", canonicalValue: null };
    }
    return { status: "mapped", canonicalValue: canonical };
  }
}

export function validateMapping(
  mappingName: string,
  mapping: MappingConfig,
  normalizers: NormalizerName[] = [],
): void {
  for (const side of ["left", "right"] as const) {
    const seen = new Map<string, string>();
    for (const [canonical, values] of Object.entries(mapping)) {
      const uniqueWithinEntry = new Set<string>();
      for (const rawAlias of values[side]) {
        const alias = normalize(rawAlias, normalizers);
        const prior = seen.get(alias);
        if (prior !== undefined) {
          throw new Error(
            `value mapping '${mappingName}' has ambiguous ${side} alias '${rawAlias}' between canonical entries '${prior}' and '${canonical}'`,
          );
        }
        // Repeated aliases in one entry are also rejected (legacy rule).
        if (uniqueWithinEntry.has(alias)) {
          throw new Error(
            `value mapping '${mappingName}' has ambiguous ${side} alias '${rawAlias}' within canonical entry '${canonical}'`,
          );
        }
        uniqueWithinEntry.add(alias);
        seen.set(alias, canonical);
      }
    }
  }
}

export function normalizedResolver(
  mappingName: string,
  mapping: MappingConfig,
  normalizers: NormalizerName[],
): MappingResolver {
  validateMapping(mappingName, mapping, normalizers);
  const normalized: MappingConfig = Object.create(null) as MappingConfig;
  for (const [canonical, values] of Object.entries(mapping)) {
    normalized[canonical] = {
      left: values.left.map((value) => normalize(value, normalizers)),
      right: values.right.map((value) => normalize(value, normalizers)),
    };
  }
  return new MappingResolver(normalized, mappingName);
}
