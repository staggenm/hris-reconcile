// Exports written for people: plain column headers named after the files,
// one status word per row, signed number differences, and a printable HTML
// report. The technical exports (export.ts) stay unchanged for audits.

import { aggregateMismatchesByField, aggregateMismatchesByPair } from "../analysis/results_analysis";
import { ResultIndex, RowStatus } from "../analysis/result_rows";
import { contractSha256, fieldFormat, fieldMode } from "./contract_document";
import { batched, escapeCsvCell, ReportMetadata } from "./export";
import { groupThousands } from "./numbers";
import { FieldComparisonStatus, FieldConfig, ReconciliationContract } from "./types";
import { count, IDENTITY_OPTION_LABELS, modeChoice, percent, plural, ROW_STATUS } from "../ui/labels";

// Excel reads UTF-8 CSV correctly (accents, umlauts) only with a byte-order mark.
const BOM = "﻿";

interface Names {
  a: string;
  b: string;
  key: string;
}

function namesOf(contract: ReconciliationContract): Names {
  const { left, right } = contract.identity;
  return { a: contract.left.name, b: contract.right.name, key: left === right ? left : `${left} / ${right}` };
}

export function fieldLabel(field: FieldConfig): string {
  return field.left === field.right ? field.left : `${field.left} / ${field.right}`;
}

function statusWords(status: RowStatus, side: "a" | "b" | null, names: Names): string {
  const file = side === "b" ? names.b : names.a;
  switch (status) {
    case "only_a": return `Only in ${names.a}`;
    case "only_b": return `Only in ${names.b}`;
    case "duplicate": return `Duplicate key in ${file}`;
    case "blank_key": return `Blank key in ${file}`;
    default: return ROW_STATUS[status].label;
  }
}

function differenceWords(status: FieldComparisonStatus, names: Names): string {
  switch (status) {
    case "left_null": return `Empty in ${names.a}`;
    case "right_null": return `Empty in ${names.b}`;
    case "unmapped_left": return `No translation for the ${names.a} value`;
    case "unmapped_right": return `No translation for the ${names.b} value`;
    default: return "Different";
  }
}

function rowNote(status: RowStatus, side: "a" | "b" | null, leftLines: number[], rightLines: number[], names: Names): string {
  if (status === "only_a") return `Not found in ${names.b}`;
  if (status === "only_b") return `Not found in ${names.a}`;
  const lines = side === "b" ? rightLines : leftLines;
  const file = side === "b" ? names.b : names.a;
  if (status === "duplicate") return `The key appears on rows ${lines.join(", ")} of ${file}`;
  if (status === "blank_key") return `Row ${lines.join(", ")} of ${file} has no key`;
  return "";
}

// One line per difference: a field that differs, or a key found in one file only.
export function differencesCsvChunks(index: ResultIndex, options: { excelSafe: boolean }): Generator<string> {
  const names = namesOf(index.contract);
  const fields = new Map(index.contract.fields.map((field) => [field.name, field]));
  const cell = (value: string | null | undefined) => escapeCsvCell(value, options.excelSafe);
  const line = (values: Array<string | null | undefined>) => `${values.map(cell).join(",")}\r\n`;
  return batched((function* () {
    yield BOM + line(["Result", names.key, "Column", `Value in ${names.a}`, `Value in ${names.b}`, "Difference (B − A)", `Row in ${names.a}`, `Row in ${names.b}`]);
    const identities = index.result.identityResults;
    for (let position = 0; position < identities.length; position++) {
      const identity = identities[position];
      const status = index.statuses[position];
      if (status === "match") continue;
      if (status !== "differs") {
        const { side } = index.row(position, []);
        yield line([
          statusWords(status, side, names), identity.identity, "", "", "",
          rowNote(status, side, identity.leftLines, identity.rightLines, names),
          identity.leftLines.join("; "), identity.rightLines.join("; "),
        ]);
        continue;
      }
      const differences = index.differences(identity);
      const row = index.row(position, differences.map((difference) => fields.get(difference.fieldName)!));
      for (let at = 0; at < differences.length; at++) {
        const difference = differences[at];
        yield line([
          "Differs", identity.identity, fieldLabel(fields.get(difference.fieldName)!),
          difference.leftRawValue, difference.rightRawValue,
          row.cells[at].delta ?? differenceWords(difference.status, names),
          String(difference.leftLine), String(difference.rightLine),
        ]);
      }
    }
  })());
}

// One line per key, with every compared column side by side.
export function comparisonCsvChunks(index: ResultIndex, options: { excelSafe: boolean }): Generator<string> {
  const names = namesOf(index.contract);
  const fields = index.contract.fields;
  const cell = (value: string | null | undefined) => escapeCsvCell(value, options.excelSafe);
  const line = (values: Array<string | null | undefined>) => `${values.map(cell).join(",")}\r\n`;
  return batched((function* () {
    const header = ["Result", names.key, `Row in ${names.a}`, `Row in ${names.b}`];
    for (const field of fields) header.push(`${field.left} (${names.a})`, `${field.right} (${names.b})`, `${field.left}: check`);
    yield BOM + line(header);
    for (let position = 0; position < index.result.identityResults.length; position++) {
      const row = index.row(position, fields);
      const values: Array<string | null> = [statusWords(row.status, row.side, names), row.identity, row.leftLines.join("; "), row.rightLines.join("; ")];
      for (const cellValue of row.cells) {
        let check = "";
        if (cellValue.state === "same") check = "Same";
        else if (cellValue.state === "a_empty") check = `Empty in ${names.a}`;
        else if (cellValue.state === "b_empty") check = `Empty in ${names.b}`;
        else if (cellValue.state === "differs") check = cellValue.delta !== null ? `Different by ${cellValue.delta}` : "Different";
        values.push(cellValue.a, cellValue.b, check);
      }
      yield line(values);
    }
  })());
}

// ---------- Plain-text summary and HTML report ----------

function localTimestamp(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function howCompared(field: FieldConfig, contract: ReconciliationContract): string {
  const mode = fieldMode(field);
  if (mode === "Custom") return `Custom rules (${field.normalize.join(", ")})`;
  if (mode === "Value mapping") {
    const entries = Object.values(contract.valueMappings[field.valueMapping!] ?? {});
    return `Translate codes (${plural(entries.length, "translation")})`;
  }
  const label = modeChoice(mode, fieldFormat(field)).label;
  return field.tolerance ? `${label}, differences up to ${field.tolerance} ignored` : label;
}

function keyRule(contract: ReconciliationContract): string {
  const options = contract.identity.normalize ?? [];
  const pair = contract.identity.left === contract.identity.right ? `“${contract.identity.left}”` : `“${contract.identity.left}” (A) = “${contract.identity.right}” (B)`;
  return options.length ? `${pair}; ${options.map((name) => IDENTITY_OPTION_LABELS[name].toLowerCase()).join("; ")}` : `${pair}, exact`;
}

function verdict(index: ResultIndex): string {
  const { counts } = index;
  const inBoth = counts.match + counts.differs;
  const warnings = counts.duplicate + counts.blank_key;
  if (counts.differs + counts.only_a + counts.only_b + warnings === 0) {
    return `No differences: both files match on all ${plural(inBoth, "row")}.`;
  }
  const parts = [`${plural(inBoth, "key")} ${inBoth === 1 ? "is" : "are"} in both files: ${count(counts.match)} match fully and ${count(counts.differs)} ${counts.differs === 1 ? "has" : "have"} differences.`];
  if (counts.only_a + counts.only_b > 0) parts.push(`${count(counts.only_a)} only in A, ${count(counts.only_b)} only in B.`);
  if (warnings > 0) parts.push(`${plural(warnings, "row")} ${warnings === 1 ? "needs" : "need"} a look because of a duplicate or blank key.`);
  return parts.join(" ");
}

export function summaryText(index: ResultIndex, metadata: ReportMetadata): string {
  const { contract, counts } = index;
  const names = namesOf(contract);
  const lines = [
    `Reconciliation: ${names.a} (A) vs ${names.b} (B), ${localTimestamp(metadata.generatedAt)}`,
    `Key: ${keyRule(contract)}`,
    verdict(index),
    "",
    `Match: ${count(counts.match)} · Differ: ${count(counts.differs)} · Only in A: ${count(counts.only_a)} · Only in B: ${count(counts.only_b)}` +
      (counts.duplicate + counts.blank_key ? ` · Warnings: ${count(counts.duplicate + counts.blank_key)}` : ""),
  ];
  const byField = aggregateMismatchesByField(index.result);
  if (byField.length) {
    lines.push("", "Differences by column:");
    const fields = new Map(contract.fields.map((field) => [field.name, field]));
    for (const row of byField) {
      lines.push(`• ${fieldLabel(fields.get(row.field_name)!)}: ${plural(row.mismatch_count, "row")} (${percent(row.mismatch_count, row.comparison_count)})`);
    }
  }
  return `${lines.join("\n")}\n`;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

const shown = (value: string | null) => (value === null ? `<span class="empty">empty</span>` : escapeHtml(value));

export const REPORT_DETAIL_ROWS = 1000;
export const REPORT_KEY_ROWS = 500;

const REPORT_CSS = `
:root{--bg:#F7F8FA;--surface:#FFFFFF;--surface-2:#F1F3F6;--border:#E2E6EB;--text:#1C2430;--muted:#5B6675;--faint:#8A94A3;--a:#2563EB;--a-soft:#EAF1FE;--b:#B45309;--b-soft:#FEF5E7;--ok:#15803D;--ok-soft:#EAF6EE;--diff:#B91C1C;--diff-soft:#FDECEC;--warn:#A16207;--warn-soft:#FEF8E6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 "Inter","Segoe UI",system-ui,-apple-system,sans-serif}
main{max-width:1080px;margin:0 auto;padding:32px 24px 48px}h1{font-size:24px;font-weight:600;margin:0 0 4px}h2{font-size:16px;font-weight:600;margin:32px 0 12px}
.sub{color:var(--muted);margin:0 0 20px}.verdict{font-size:16px;margin:0 0 20px;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--diff);border-radius:10px}
.verdict.ok{border-left-color:var(--ok)}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.tile{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px}.tile b{display:block;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.tile span{color:var(--muted);font-size:13px}.t-ok b{color:var(--ok)}.t-diff b{color:var(--diff)}.t-a b{color:var(--a)}.t-b b{color:var(--b)}.t-warn b{color:var(--warn)}
table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:10px;font-size:13px}
th{background:var(--surface-2);color:var(--muted);font-weight:600;text-align:left;padding:8px 10px;border-bottom:1px solid var(--border)}
td{padding:6px 10px;border-bottom:1px solid var(--border);vertical-align:top}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.mono{font-family:"JetBrains Mono","Cascadia Mono",Consolas,monospace}.diff{background:var(--diff-soft)}.delta{color:var(--diff);font-weight:600}
.empty{color:var(--faint);font-style:italic}.th-a{box-shadow:inset 0 3px 0 var(--a)}.th-b{box-shadow:inset 0 3px 0 var(--b)}
.badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.s-differs{background:var(--diff-soft);color:var(--diff)}.s-only_a{background:var(--a-soft);color:var(--a)}.s-only_b{background:var(--b-soft);color:var(--b)}
.s-duplicate,.s-blank_key{background:var(--warn-soft);color:var(--warn)}.note{color:var(--muted);font-size:13px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0}dt{color:var(--muted)}dd{margin:0}
footer{margin-top:40px;color:var(--faint);font-size:12px}
@media print{body{background:#fff}main{padding:0}.verdict,.tile,table{break-inside:avoid}tr{break-inside:avoid}}
`;

export function htmlReportChunks(index: ResultIndex, metadata: ReportMetadata): Generator<string> {
  const { contract, result, counts } = index;
  const names = namesOf(contract);
  const fields = new Map(contract.fields.map((field) => [field.name, field]));
  const e = escapeHtml;
  return batched((function* () {
    const clean = counts.differs + counts.only_a + counts.only_b + counts.duplicate + counts.blank_key === 0;
    yield `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`;
    yield `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`;
    yield `<title>${e(`${names.a} vs ${names.b}: reconciliation report`)}</title><style>${REPORT_CSS}</style></head><body><main>`;
    yield `<h1>${e(names.a)} <span style="color:var(--a)">(A)</span> vs ${e(names.b)} <span style="color:var(--b)">(B)</span></h1>`;
    yield `<p class="sub">Reconciliation report · ${e(localTimestamp(metadata.generatedAt))} · matched on ${e(keyRule(contract))}</p>`;
    yield `<p class="verdict${clean ? " ok" : ""}">${clean ? "✓ " : ""}${e(verdict(index))}</p>`;

    const tiles: Array<[string, string, number]> = [
      ["t-ok", "✓ Match", counts.match], ["t-diff", "≠ Differ", counts.differs],
      ["t-a", `A Only in ${names.a}`, counts.only_a], ["t-b", `B Only in ${names.b}`, counts.only_b],
    ];
    if (counts.duplicate + counts.blank_key) tiles.push(["t-warn", "! Duplicate or blank keys", counts.duplicate + counts.blank_key]);
    yield `<div class="tiles">${tiles.map(([tone, label, value]) => `<div class="tile ${tone}"><b>${count(value)}</b><span>${e(label)}</span></div>`).join("")}</div>`;

    const byField = aggregateMismatchesByField(result);
    yield `<h2>Differences by column</h2>`;
    if (byField.length === 0) {
      yield `<p class="note">Every compared column matches for all keys found in both files.</p>`;
    } else {
      yield `<table><thead><tr><th>Column</th><th>Compared</th><th class="num">Rows differing</th><th class="num">Share</th><th>Most common difference</th></tr></thead><tbody>`;
      for (const row of byField) {
        const field = fields.get(row.field_name)!;
        const top = aggregateMismatchesByPair(result, { fieldName: row.field_name })[0];
        const pattern = top ? `<span class="mono">${shown(top.left_value)}</span> → <span class="mono">${shown(top.right_value)}</span> <span class="note">(${plural(top.employee_count, "row")})</span>` : "";
        yield `<tr><td>${e(fieldLabel(field))}</td><td class="note">${e(howCompared(field, contract))}</td><td class="num">${count(row.mismatch_count)}</td><td class="num">${percent(row.mismatch_count, row.comparison_count)}</td><td>${pattern}</td></tr>`;
      }
      yield `</tbody></table>`;
    }

    for (const [status, title] of [["only_a", `Only in ${names.a} (A)`], ["only_b", `Only in ${names.b} (B)`], ["duplicate", "Duplicate keys"], ["blank_key", "Blank keys"]] as Array<[RowStatus, string]>) {
      const total = counts[status];
      if (total === 0) continue;
      yield `<h2>${e(title)} <span class="note">(${count(total)})</span></h2><table><thead><tr><th>${e(names.key)}</th><th>Rows in ${e(names.a)}</th><th>Rows in ${e(names.b)}</th></tr></thead><tbody>`;
      let shownRows = 0;
      for (let position = 0; position < result.identityResults.length && shownRows < REPORT_KEY_ROWS; position++) {
        if (index.statuses[position] !== status) continue;
        const identity = result.identityResults[position];
        yield `<tr><td class="mono">${shown(identity.identity)}</td><td class="mono">${e(identity.leftLines.join(", "))}</td><td class="mono">${e(identity.rightLines.join(", "))}</td></tr>`;
        shownRows++;
      }
      yield `</tbody></table>`;
      if (total > REPORT_KEY_ROWS) yield `<p class="note">Showing the first ${count(REPORT_KEY_ROWS)} of ${count(total)}. The Differences CSV lists all of them.</p>`;
    }

    if (result.discrepancies.length > 0) {
      yield `<h2>Value differences <span class="note">(${count(result.discrepancies.length)})</span></h2>`;
      yield `<table><thead><tr><th>${e(names.key)}</th><th>Column</th><th class="th-a">${e(names.a)} (A)</th><th class="th-b">${e(names.b)} (B)</th><th class="num">Difference</th></tr></thead><tbody>`;
      let written = 0;
      for (let position = 0; position < result.identityResults.length && written < REPORT_DETAIL_ROWS; position++) {
        if (index.statuses[position] !== "differs") continue;
        const differences = index.differences(result.identityResults[position]);
        const row = index.row(position, differences.map((difference) => fields.get(difference.fieldName)!));
        for (let at = 0; at < differences.length && written < REPORT_DETAIL_ROWS; at++, written++) {
          const difference = differences[at];
          const delta = row.cells[at].delta;
          const deltaHtml = delta !== null
            ? `<span class="delta">${delta.startsWith("-") ? "" : "+"}${e(groupThousands(delta))}</span>`
            : `<span class="note">${e(differenceWords(difference.status, names))}</span>`;
          yield `<tr><td class="mono">${e(difference.identity)}</td><td>${e(fieldLabel(fields.get(difference.fieldName)!))}</td><td class="mono diff">${shown(difference.leftRawValue)}</td><td class="mono diff">${shown(difference.rightRawValue)}</td><td class="num">${deltaHtml}</td></tr>`;
        }
      }
      yield `</tbody></table>`;
      if (result.discrepancies.length > REPORT_DETAIL_ROWS) {
        yield `<p class="note">Showing the first ${count(REPORT_DETAIL_ROWS)} of ${count(result.discrepancies.length)}. The Differences CSV lists all of them.</p>`;
      }
    }

    yield `<h2>How the files were compared</h2><dl>`;
    yield `<dt>Rows matched on</dt><dd>${e(keyRule(contract))}</dd>`;
    for (const field of contract.fields) yield `<dt>${e(fieldLabel(field))}</dt><dd>${e(howCompared(field, contract))}</dd>`;
    yield `</dl><h2>Files</h2><table><thead><tr><th></th><th>File</th><th class="num">Rows</th><th class="num">Columns</th><th>Fingerprint (SHA-256)</th></tr></thead><tbody>`;
    for (const [label, side, stats] of [["A", "left", result.leftDataset], ["B", "right", result.rightDataset]] as const) {
      const source = metadata.sources[side];
      yield `<tr><td><span class="badge s-only_${side === "left" ? "a" : "b"}">${label}</span></td><td>${e(stats.name)}<br><span class="note">${e(source.fileName)} · ${e(source.encoding)}</span></td><td class="num">${count(stats.recordCount)}</td><td class="num">${count(stats.columnCount)}</td><td class="mono note">${e(source.sha256)}</td></tr>`;
    }
    yield `</tbody></table>`;
    yield `<footer>Created with HRIS Reconcile ${e(metadata.appVersion)} in the browser; the files were not uploaded anywhere. Settings fingerprint ${e(contractSha256(contract).slice(0, 16))}. Treat this report according to the sensitivity of the data it contains.</footer>`;
    yield `</main></body></html>\n`;
  })());
}
