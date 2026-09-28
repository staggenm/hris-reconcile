// Minimal JSON Schema (draft 2020-12) validator for the keywords used by
// schemas/*.schema.json. It throws on any other keyword so a schema can never
// rely on a rule that is silently not checked.

type Schema = Record<string, any>;

const ANNOTATIONS = new Set(["$schema", "$id", "$defs", "title", "description"]);
const ASSERTIONS = new Set(["$ref", "anyOf", "type", "properties", "required", "additionalProperties", "items", "enum", "const", "minimum", "pattern"]);

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  return actual === type || (type === "number" && actual === "integer");
}

function escapePointer(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

function resolveRef(root: Schema, ref: string): Schema {
  const match = /^#\/\$defs\/([^/]+)$/.exec(ref);
  const target = match ? root.$defs?.[match[1]] : undefined;
  if (!target) throw new Error(`unresolvable $ref '${ref}'`);
  return target;
}

export function validateJsonSchema(schema: Schema, value: unknown): string[] {
  const visit = (node: Schema, data: unknown, pointer: string, errors: string[]): void => {
    for (const keyword of Object.keys(node)) {
      if (!ANNOTATIONS.has(keyword) && !ASSERTIONS.has(keyword)) {
        throw new Error(`unsupported schema keyword '${keyword}'`);
      }
    }
    if (node.$ref !== undefined) visit(resolveRef(schema, node.$ref), data, pointer, errors);
    if (node.anyOf !== undefined) {
      const branches = (node.anyOf as Schema[]).map((branch) => {
        const branchErrors: string[] = [];
        visit(branch, data, pointer, branchErrors);
        return branchErrors;
      });
      if (branches.every((branchErrors) => branchErrors.length > 0)) {
        errors.push(`${pointer}: matches no anyOf branch [${branches.map((e) => e.join("; ")).join(" | ")}]`);
      }
    }
    if (node.type !== undefined) {
      const types: string[] = Array.isArray(node.type) ? node.type : [node.type];
      if (!types.some((type) => matchesType(data, type))) {
        errors.push(`${pointer}: expected type ${types.join(",")}, got ${typeOf(data)}`);
        return;
      }
    }
    if (node.const !== undefined && data !== node.const) {
      errors.push(`${pointer}: expected const ${JSON.stringify(node.const)}`);
    }
    if (node.enum !== undefined && !node.enum.includes(data)) {
      errors.push(`${pointer}: value not in enum`);
    }
    if (node.pattern !== undefined && typeof data === "string" && !new RegExp(node.pattern, "u").test(data)) {
      errors.push(`${pointer}: does not match pattern ${node.pattern}`);
    }
    if (node.minimum !== undefined && typeof data === "number" && data < node.minimum) {
      errors.push(`${pointer}: below minimum ${node.minimum}`);
    }
    if (typeOf(data) === "object") {
      const object = data as Record<string, unknown>;
      for (const key of node.required ?? []) {
        if (!Object.prototype.hasOwnProperty.call(object, key)) {
          errors.push(`${pointer}: missing required property '${key}'`);
        }
      }
      const properties: Schema = node.properties ?? {};
      for (const [key, child] of Object.entries(object)) {
        const childPointer = `${pointer}/${escapePointer(key)}`;
        if (Object.prototype.hasOwnProperty.call(properties, key)) {
          visit(properties[key], child, childPointer, errors);
        } else if (node.additionalProperties === false) {
          errors.push(`${childPointer}: additional property`);
        } else if (typeof node.additionalProperties === "object") {
          visit(node.additionalProperties, child, childPointer, errors);
        }
      }
    }
    if (typeOf(data) === "array" && node.items !== undefined) {
      (data as unknown[]).forEach((item, index) => visit(node.items, item, `${pointer}/${index}`, errors));
    }
  };
  const errors: string[] = [];
  visit(schema, value, "", errors);
  return errors;
}
