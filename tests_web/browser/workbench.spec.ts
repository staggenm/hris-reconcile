import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const artifact = pathToFileURL(resolve(root, "dist/hris-reconcile.html")).href;
const leftCsv = "person_id,first_name\n001,Ada\n002,Grace\n";
const rightCsv = "employee_number,given_name\n001,Ada\n002,Grace\n";
const leftRichCsv = "person_id,first_name,company\n001,Ada,DE01\n002,Grace,DE01\n";
const rightRichCsv = "employee_number,given_name,company_code\n001,Ada,1000\n002,Grace,1000\n";

test("standalone workflow, styled view, exports, and zero egress", async ({ page }) => {
  const errors: string[] = [];
  const egress: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && /content security policy/i.test(message.text())) errors.push(message.text()); });
  page.on("request", (request) => { if (/^https?:|^wss?:/.test(request.url())) egress.push(request.url()); });
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, "__egressCalls", { value: calls });
    const fetchOriginal = window.fetch;
    window.fetch = ((...args: Parameters<typeof fetch>) => { calls.push("fetch"); return fetchOriginal(...args); }) as typeof fetch;
    const xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method: string, url: string | URL, async = true, username?: string | null, password?: string | null) { calls.push("xhr"); Reflect.apply(xhrOpen, this, [method, url, async, username, password]); };
    const ws = window.WebSocket;
    window.WebSocket = new Proxy(ws, { construct(target, args) { calls.push("websocket"); return Reflect.construct(target, args); } });
    navigator.sendBeacon = (() => { calls.push("beacon"); return false; }) as typeof navigator.sendBeacon;
  });
  await page.goto(artifact);
  await expect(page.locator("#step-upload")).toBeVisible();
  expect(await page.locator("header").evaluate((el) => getComputedStyle(el).display)).toBe("flex");
  expect(await page.getByRole("button", { name: "Clear session / start over" }).evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await page.locator("#left-file").setInputFiles({ name: "left.csv", mimeType: "text/csv", buffer: Buffer.from(leftCsv) });
  await page.locator("#right-file").setInputFiles({ name: "right.csv", mimeType: "text/csv", buffer: Buffer.from(rightCsv) });
  await expect(page.locator("#step-identity")).toBeVisible();
  await expect(page.locator("#step-fields")).toBeHidden();
  await expect(page.locator("#step-mappings")).toBeHidden();
  await page.locator("#confirm-identity").click();
  await page.locator("#left-identity").selectOption("first_name");
  await expect(page.locator("#step-identity")).toBeVisible();
  await expect(page.locator("#step-fields")).toBeHidden();
  await page.locator("#left-identity").selectOption("person_id");
  await page.locator("#confirm-identity").click();
  await page.locator("#field-rows select").nth(2).selectOption("Normalized text");
  await page.locator("#confirm-fields").click();
  await page.locator("#confirm-mappings").click();
  await page.locator("#run-reconciliation").click();
  await expect(page.locator("#step-results")).toBeVisible();
  await expect(page.locator("#metrics")).toContainText("2");
  for (const [button, file] of [["Full results CSV", "full.csv"], ["Mismatches only CSV", "mismatches.csv"], ["JSON report", "report.json"]] as const) {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: button }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).not.toBeNull();
    const text = await readFile(path!, "utf8");
    if (file === "full.csv") expect(text).toContain("MATCHED");
    if (file === "mismatches.csv") expect(text).toContain("record_type,identity,field_name");
    if (file === "report.json") expect(JSON.parse(text).run_metadata.processing_mode).toBe("browser");
  }
  await page.locator("#clear-session").click();
  await expect(page.locator("#step-results")).toBeHidden();
  expect(await page.locator("#left-dataset").textContent()).toBe("");
  expect(await page.locator("body").innerText()).not.toMatch(/Ada|Grace|001|002/);
  expect(await page.locator("input:not([type=checkbox])").evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toEqual(["", "", "", ""]);
  expect(await page.locator("#identity-normalizers input:checked").count()).toBe(0);
  expect(await page.evaluate(() => (window as any).__egressCalls)).toEqual([]);
  expect(egress).toEqual([]);
  expect(errors).toEqual([]);
});

test("source HTML explains how to open the styled build", async ({ page }) => {
  await page.goto(pathToFileURL(resolve(root, "src/web/index.html")).href);
  await expect(page.getByRole("heading", { name: "Open the built workbench" })).toBeVisible();
  await expect(page.locator("#step-upload")).toBeHidden();
});

test("standalone layout fits a narrow viewport without page-wide overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(artifact);
  const dimensions = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
});

test("copied artifact opens without repository files beside it", async ({ page }) => {
  const directory = mkdtempSync(resolve(tmpdir(), "hris-standalone-copy-"));
  const copy = resolve(directory, "workbench.html");
  copyFileSync(resolve(root, "dist/hris-reconcile.html"), copy);
  try {
    await page.goto(pathToFileURL(copy).href);
    await expect(page.locator("#step-upload")).toBeVisible();
    expect(await page.locator("header").evaluate((el) => getComputedStyle(el).display)).toBe("flex");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("dropzone accepts a local CSV", async ({ page }) => {
  await page.goto(artifact);
  await page.locator("#left-card").evaluate((element, csv) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([csv], "left.csv", { type: "text/csv" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, leftCsv);
  await expect(page.locator("#left-dataset")).toContainText("2 rows");
});

test("Vite development entry stays styled and interactive", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await expect(page.locator("#step-upload")).toBeVisible();
  expect(await page.locator("header").evaluate((el) => getComputedStyle(el).display)).toBe("flex");
  await page.locator("#left-file").setInputFiles({ name: "left.csv", mimeType: "text/csv", buffer: Buffer.from(leftCsv) });
  await expect(page.locator("#left-dataset")).toContainText("2 rows");
});

test("changing a confirmed semantic mapping hides old results until rerun", async ({ page }) => {
  await page.goto(artifact);
  await page.locator("#left-file").setInputFiles({ name: "left.csv", mimeType: "text/csv", buffer: Buffer.from(leftRichCsv) });
  await page.locator("#right-file").setInputFiles({ name: "right.csv", mimeType: "text/csv", buffer: Buffer.from(rightRichCsv) });
  await page.locator("#confirm-identity").click();
  await page.locator("#field-rows select").nth(5).selectOption("Value mapping");
  await page.locator("#confirm-fields").click();
  await page.locator("#confirm-mappings").click();
  await page.locator("#run-reconciliation").click();
  await expect(page.locator("#step-results")).toBeVisible();
  await page.locator("#mapping-editors input[type=text]").nth(0).fill("NEW_CANONICAL");
  await expect(page.locator("#step-results")).toBeHidden();
  await expect(page.locator("#metrics")).toBeEmpty();
  await expect(page.locator("#step-run")).toBeHidden();
  await page.locator("#confirm-mappings").click();
  await page.locator("#run-reconciliation").click();
  await expect(page.locator("#step-results")).toBeVisible();
});

test("main controls respond while a worker result is pending and reset discards it", async ({ page }) => {
  await page.addInitScript(() => {
    const add = Worker.prototype.addEventListener;
    Worker.prototype.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
      if (type === "message" && typeof listener === "function") {
        const delayed = function (this: Worker, event: Event) {
          window.setTimeout(() => listener.call(this, event), 700);
        };
        return add.call(this, type, delayed as EventListener, options);
      }
      return add.call(this, type, listener, options);
    };
  });
  await page.goto(artifact);
  await page.locator("#left-file").setInputFiles({ name: "left.csv", mimeType: "text/csv", buffer: Buffer.from(leftCsv) });
  await page.locator("#right-file").setInputFiles({ name: "right.csv", mimeType: "text/csv", buffer: Buffer.from(rightCsv) });
  await page.locator("#confirm-identity").click();
  await page.locator("#confirm-fields").click();
  await page.locator("#confirm-mappings").click();
  await page.locator("#run-reconciliation").click();
  await expect(page.locator("#step-results")).toBeHidden();
  await page.locator("#clear-session").click();
  await expect(page.locator("#left-dataset")).toBeEmpty();
  await page.waitForTimeout(800);
  await expect(page.locator("#step-results")).toBeHidden();
  await expect(page.locator("#metrics")).toBeEmpty();
});

test("capture synthetic desktop and narrow workflow screenshots", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "capture one set of cross-browser review images");
  // Screenshots are review artefacts, never tracked files: tests must not modify the working tree.
  const output = resolve(root, "test-results/screenshots");
  mkdirSync(output, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(artifact);
  await page.waitForTimeout(300);
  await page.locator("header").evaluate((header) => { (header as HTMLElement).style.position = "relative"; });
  await page.screenshot({ path: resolve(output, "01-upload-desktop.png"), fullPage: true });
  await page.locator("#left-file").setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from(leftRichCsv) });
  await page.locator("#right-file").setInputFiles({ name: "payroll.csv", mimeType: "text/csv", buffer: Buffer.from(rightRichCsv) });
  await expect(page.locator("#step-identity")).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(output, "02-profiles-desktop.png"), fullPage: true });
  await page.locator("#confirm-identity").click();
  await page.locator("#field-rows select").nth(2).selectOption("Normalized text");
  await page.locator("#field-rows select").nth(5).selectOption("Value mapping");
  await page.locator("#confirm-fields").click();
  await expect(page.locator("#mapping-editors input[type=text]").nth(1)).toHaveValue("DE01");
  await page.screenshot({ path: resolve(output, "03-mappings-desktop.png"), fullPage: true });
  await page.locator("#confirm-mappings").click();
  await page.locator("#run-reconciliation").click();
  await expect(page.locator("#step-results")).toBeVisible();
  await page.waitForTimeout(250);
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(output, "04-results-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, "05-results-narrow.png"), fullPage: true });
});

async function mappingRows(page: import("@playwright/test").Page) {
  return page.locator("#mapping-editors tbody tr").evaluateAll((rows) =>
    rows.map((row) => Array.from(row.querySelectorAll<HTMLInputElement>("input[type=text]")).map((input) => input.value)));
}

async function metric(page: import("@playwright/test").Page, label: string) {
  return page.locator(".metric", { hasText: label }).locator("strong").textContent();
}

test("mapping rows can share a canonical value and accept sentinel-like real values", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(artifact);
  await page.locator("#left-file").setInputFiles({ name: "left.csv", mimeType: "text/csv", buffer: Buffer.from("person_id,status\n001,FT\n002,F\n003,<missing>\n") });
  await page.locator("#right-file").setInputFiles({ name: "right.csv", mimeType: "text/csv", buffer: Buffer.from("employee_number,status\n001,Full\n002,Full\n003,Odd\n") });
  await page.locator("#confirm-identity").click();
  await page.locator("#field-rows select").nth(2).selectOption("Value mapping");
  await page.locator("#confirm-fields").click();
  await expect(page.locator("#mapping-editors tbody tr")).toHaveCount(3);
  const rows = await mappingRows(page);
  const canonicals: Record<string, string> = { FT: "FULL", F: "FULL", "<missing>": "ODD" };
  for (const [index, [, left]] of rows.entries()) {
    const row = page.locator("#mapping-editors tbody tr").nth(index);
    await row.locator("input[type=checkbox]").check();
    await row.locator("input[type=text]").nth(0).fill(canonicals[left]);
  }
  await page.locator("#confirm-mappings").click();
  await expect(page.locator("#error")).toBeHidden();
  await page.locator("#run-reconciliation").click();
  await expect(page.locator("#step-results")).toBeVisible();
  expect(await metric(page, "Field matches")).toBe("3");
  expect(await metric(page, "Field discrepancies")).toBe("0");
  expect(errors).toEqual([]);
});

test("identity normalizers match leading-zero keys and blank identities are counted, not fatal", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(artifact);
  await page.locator("#left-file").setInputFiles({ name: "left.csv", mimeType: "text/csv", buffer: Buffer.from("person_id,first_name\n00012345,Ada\n0002,Grace\n,Nobody\n") });
  await page.locator("#right-file").setInputFiles({ name: "right.csv", mimeType: "text/csv", buffer: Buffer.from("employee_number,given_name\n12345,Ada\n2,Grace\n") });
  await page.locator("#left-identity").selectOption("person_id");
  await page.locator("#right-identity").selectOption("employee_number");
  await page.getByLabel("Strip leading zeros").check();
  await page.locator("#confirm-identity").click();
  await page.locator("#confirm-fields").click();
  await page.locator("#confirm-mappings").click();
  await page.locator("#run-reconciliation").click();
  await expect(page.locator("#step-results")).toBeVisible();
  expect(await metric(page, "Matched employees")).toBe("2");
  expect(await metric(page, "Missing identity values")).toBe("1");
  expect(await metric(page, "Field discrepancies")).toBe("0");
  await page.getByLabel("Strip leading zeros").uncheck();
  await expect(page.locator("#step-results")).toBeHidden();
  await expect(page.locator("#step-fields")).toBeHidden();
  expect(errors).toEqual([]);
});

test("N:1 mapping rows are accepted with their default canonical values", async ({ page }) => {
  await page.goto(artifact);
  await page.locator("#left-file").setInputFiles({ name: "left.csv", mimeType: "text/csv", buffer: Buffer.from("person_id,status\n001,FT\n002,F\n003,FT\n004,F\n") });
  await page.locator("#right-file").setInputFiles({ name: "right.csv", mimeType: "text/csv", buffer: Buffer.from("employee_number,status\n001,Full\n002,Full\n003,Full\n004,Full\n") });
  await page.locator("#confirm-identity").click();
  await page.locator("#field-rows select").nth(2).selectOption("Value mapping");
  await page.locator("#confirm-fields").click();
  await expect(page.locator("#mapping-editors tbody tr")).toHaveCount(2);
  for (const checkbox of await page.locator("#mapping-editors input[type=checkbox]").all()) await checkbox.check();
  await page.locator("#confirm-mappings").click();
  await expect(page.locator("#error")).toBeHidden();
  await page.locator("#run-reconciliation").click();
  await expect(page.locator("#step-results")).toBeVisible();
  expect(await metric(page, "Field matches")).toBe("4");
  expect(await metric(page, "Field discrepancies")).toBe("0");
});

async function downloadText(page: import("@playwright/test").Page, button: string): Promise<string> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: button }).click();
  return readFile((await (await downloadPromise).path())!, "utf8");
}

test("local-processing wording, sensitive-data note, and the excelSafe export toggle", async ({ page }) => {
  await page.goto(artifact);
  await expect(page.getByRole("note")).toHaveText("Processing runs locally in this browser. The application makes no network requests.");
  await page.locator("#left-file").setInputFiles({ name: "left.csv", mimeType: "text/csv", buffer: Buffer.from("person_id,status\n001,=cmd|' /C calc'!A0\n002,-5\n") });
  await page.locator("#right-file").setInputFiles({ name: "right.csv", mimeType: "text/csv", buffer: Buffer.from("employee_number,status\n001,x\n002,-5\n") });
  await page.locator("#confirm-identity").click();
  await page.locator("#confirm-fields").click();
  await page.locator("#confirm-mappings").click();
  await page.locator("#run-reconciliation").click();
  await expect(page.locator("#step-results")).toBeVisible();
  await expect(page.locator("#step-results")).toContainText("Exports may contain sensitive HR data.");
  const toggle = page.getByLabel("Neutralize spreadsheet formulas in CSV exports");
  await expect(toggle).toBeChecked();
  expect(await downloadText(page, "Mismatches only CSV")).toContain(",status,'=cmd|' /C calc'!A0,x,");
  expect(await downloadText(page, "Full results CSV")).toContain("status,-5,-5,");
  await toggle.uncheck();
  expect(await downloadText(page, "Mismatches only CSV")).toContain(",status,=cmd|' /C calc'!A0,x,");
  const report = JSON.parse(await downloadText(page, "JSON report"));
  expect(report.details.field_comparisons[0].left_raw_value).toBe("=cmd|' /C calc'!A0");
});

test("hash-based CSP: full workflow has zero violations and unlisted inline script is blocked", async ({ page }) => {
  const consoleCsp: string[] = [];
  page.on("console", (message) => { if (/content.security.policy/i.test(message.text())) consoleCsp.push(message.text()); });
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.defineProperty(window, "__cspViolations", { value: violations });
    document.addEventListener("securitypolicyviolation", (event) => violations.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  await page.goto(artifact);
  await page.locator("#left-file").setInputFiles({ name: "left.csv", mimeType: "text/csv", buffer: Buffer.from(leftRichCsv + "003,Linus,CH01\n") });
  await page.locator("#right-file").setInputFiles({ name: "right.csv", mimeType: "text/csv", buffer: Buffer.from(rightRichCsv + "003,Linus,9999\n") });
  await page.locator("#confirm-identity").click();
  await page.locator("#field-rows select").nth(5).selectOption("Value mapping");
  await page.locator("#confirm-fields").click();
  await page.locator("#confirm-mappings").click();
  await page.locator("#run-reconciliation").click();
  await expect(page.locator("#step-results")).toBeVisible();
  await expect(page.locator("#detail-summary")).toContainText("Employee details");
  await page.locator("#matching-details summary").click();
  await expect(page.locator("#matching-summary")).toContainText("Matching comparisons");
  for (const button of ["Full results CSV", "Mismatches only CSV", "JSON report"]) await downloadText(page, button);
  expect(await page.evaluate(() => (window as any).__cspViolations)).toEqual([]);
  expect(consoleCsp).toEqual([]);

  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__injected = true;";
    document.body.append(script);
  });
  await expect.poll(() => page.evaluate(() => (window as any).__cspViolations.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).__cspViolations[0])).toMatch(/^script-src/);
  expect(await page.evaluate(() => (window as any).__injected)).toBeUndefined();
});

test("errors show their stable code next to the message", async ({ page }) => {
  await page.goto(artifact);
  await page.locator("#left-file").setInputFiles({ name: "left.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2\n3\n") });
  await expect(page.locator("#error")).toBeVisible();
  await expect(page.locator("#error .error-code")).toHaveText("CSV_ROW_WIDTH");
  await expect(page.locator("#error")).toContainText("CSV row 3 has 1 values; expected 2");
  await expect(page.locator("#error")).toHaveAttribute("data-code", "CSV_ROW_WIDTH");
});

test("a file over the size limit is rejected before it is read", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "one engine is enough for a 100 MB upload");
  await page.goto(artifact);
  const directory = mkdtempSync(resolve(tmpdir(), "hris-big-"));
  const oversized = resolve(directory, "big.csv");
  writeFileSync(oversized, Buffer.alloc(100 * 1024 * 1024 + 1, "a"));
  try {
    await page.locator("#left-file").setInputFiles(oversized);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  await expect(page.locator("#error")).toHaveAttribute("data-code", "LIMIT_FILE_SIZE");
  await expect(page.locator("#error")).toContainText("file 'big.csv' is 100.0 MB; the limit is 100.0 MB");
  await expect(page.locator("#left-dataset")).toBeEmpty();
});

test("a Windows-1252 file fails as UTF-8 with a suggestion and parses after choosing Windows-1252", async ({ page }) => {
  await page.goto(artifact);
  const fixture = resolve(root, "tests_web/fixtures/encoding/umlauts_windows1252.csv");
  await expect(page.locator("#left-encoding")).toHaveValue("utf-8");
  await page.locator("#left-file").setInputFiles(fixture);
  await expect(page.locator("#error")).toHaveAttribute("data-code", "CSV_ENCODING");
  await expect(page.locator("#error")).toContainText("choose Windows-1252");
  await page.locator("#left-encoding").selectOption("windows-1252");
  await expect(page.locator("#left-dataset")).toContainText("Müller");
  await expect(page.locator("#left-dataset")).toContainText("€uro");
  await expect(page.locator("#error")).toBeHidden();
});

test("a worker crash resets the session with a clear message and a fresh worker works", async ({ page }) => {
  await page.addInitScript(() => {
    const workers: Worker[] = [];
    Object.defineProperty(window, "__workers", { value: workers });
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        workers.push(this);
      }
    };
  });
  await page.goto(artifact);
  await page.locator("#left-file").setInputFiles({ name: "left.csv", mimeType: "text/csv", buffer: Buffer.from(leftCsv) });
  await page.locator("#right-file").setInputFiles({ name: "right.csv", mimeType: "text/csv", buffer: Buffer.from(rightCsv) });
  await expect(page.locator("#step-identity")).toBeVisible();
  await page.evaluate(() => (window as any).__workers.at(-1).dispatchEvent(new ErrorEvent("error", { message: "out of memory" })));
  await expect(page.locator("#error")).toHaveAttribute("data-code", "WORKER_CRASHED");
  await expect(page.locator("#error")).toContainText("Processing stopped (likely memory). Session reset.");
  await expect(page.locator("#step-identity")).toBeHidden();
  await expect(page.locator("#left-dataset")).toBeEmpty();
  await expect(page.locator("#right-dataset")).toBeEmpty();

  await page.locator("#left-file").setInputFiles({ name: "left.csv", mimeType: "text/csv", buffer: Buffer.from(leftCsv) });
  await page.locator("#right-file").setInputFiles({ name: "right.csv", mimeType: "text/csv", buffer: Buffer.from(rightCsv) });
  await page.locator("#confirm-identity").click();
  await page.locator("#confirm-fields").click();
  await page.locator("#confirm-mappings").click();
  await page.locator("#run-reconciliation").click();
  await expect(page.locator("#step-results")).toBeVisible();
  await expect(page.locator("#error")).toBeHidden();
  expect(await page.evaluate(() => (window as any).__workers.length)).toBe(2);
});

async function tableRows(page: import("@playwright/test").Page, selector: string): Promise<string[][]> {
  return page.locator(`${selector} table tr`).evaluateAll((rows) =>
    rows.map((row) => Array.from(row.querySelectorAll("th, td"), (cell) => (cell.textContent ?? "").trim())));
}

test("source rows appear in the UI and the JSON report is format 2.0 with source hashes", async ({ page }) => {
  const leftText = 'person_id,note\n001,"two\nlines"\n002,x\n,blank\n';
  const rightText = "employee_number,note\n001,changed\n002,x\n003,new\n";
  await page.goto(artifact);
  await page.locator("#left-file").setInputFiles({ name: "left.csv", mimeType: "text/csv", buffer: Buffer.from(leftText) });
  await page.locator("#right-file").setInputFiles({ name: "right.csv", mimeType: "text/csv", buffer: Buffer.from(rightText) });
  await page.locator("#left-identity").selectOption("person_id");
  await page.locator("#right-identity").selectOption("employee_number");
  await page.locator("#confirm-identity").click();
  await page.locator("#confirm-fields").click();
  await page.locator("#confirm-mappings").click();
  await page.locator("#run-reconciliation").click();
  await expect(page.locator("#step-results")).toBeVisible();

  await expect(page.locator("#identity-issues")).toContainText("MISSING_IDENTITY_LEFT");
  const issues = await tableRows(page, "#identity-issues");
  expect(issues[0]).toEqual(["Employee identity", "Status", "Dataset A rows", "Dataset B rows"]);
  expect(issues).toContainEqual(["003", "MISSING_LEFT", "", "4"]);
  expect(issues).toContainEqual(["<missing>", "MISSING_IDENTITY_LEFT", "5", ""]);

  await expect(page.locator("#detail-summary")).toContainText("Employee details");
  const details = await tableRows(page, "#detail-summary");
  expect(details[0]).toEqual(["Employee identity", "Field", "Dataset A row", "Dataset B row", "Dataset A value", "Dataset B value", "Comparison status"]);
  expect(details[1]).toEqual(["001", "note", "2", "2", "two\nlines", "changed", "mismatch"]);

  const report = JSON.parse(await downloadText(page, "JSON report"));
  expect(report.report_format_version).toBe("2.0");
  expect(report.sources.left).toMatchObject({
    file_name: "left.csv", encoding: "utf-8", byte_length: Buffer.byteLength(leftText),
    sha256: createHash("sha256").update(leftText).digest("hex"),
  });
  expect(report.sources.right.sha256).toBe(createHash("sha256").update(rightText).digest("hex"));
  expect(Date.now() - Date.parse(report.run_metadata.generated_at)).toBeLessThan(60_000);
  expect(report.run_metadata.generated_at).toMatch(/Z$/);
  expect(report.contract.schema_version).toBe("1.0");
  expect(report.details.field_comparisons).toEqual([expect.objectContaining({ identity: "001", left_row: 2, right_row: 2, status: "MISMATCH" })]);
});

test("a saved contract re-imports into a fresh session and reproduces the same full.csv", async ({ page }) => {
  const rightNumbers = "employee_number,given_name,company_code\n1,Ada,1000\n2,grace,1000\n";
  const upload = async (right: string) => {
    await page.locator("#left-file").setInputFiles({ name: "left.csv", mimeType: "text/csv", buffer: Buffer.from(leftRichCsv) });
    await page.locator("#right-file").setInputFiles({ name: "right.csv", mimeType: "text/csv", buffer: Buffer.from(right) });
    await expect(page.locator("#step-identity")).toBeVisible();
  };
  await page.goto(artifact);
  await upload(rightNumbers);
  await page.locator("#left-identity").selectOption("person_id");
  await page.locator("#right-identity").selectOption("employee_number");
  await page.getByLabel("Strip leading zeros").check();
  await page.locator("#confirm-identity").click();
  await page.locator("#field-rows select").nth(2).selectOption("Normalized text");
  await page.locator("#field-rows select").nth(5).selectOption("Value mapping");
  await page.locator("#confirm-fields").click();
  await expect(page.locator("#mapping-editors tbody tr")).toHaveCount(1);
  await page.locator("#confirm-mappings").click();
  await page.locator("#run-reconciliation").click();
  await expect(page.locator("#step-results")).toBeVisible();
  const firstRun = await downloadText(page, "Full results CSV");
  expect(firstRun).toContain("MATCH_MAPPED");

  const directory = mkdtempSync(resolve(tmpdir(), "hris-contract-"));
  try {
    const contractPath = resolve(directory, "contract.json");
    writeFileSync(contractPath, await downloadText(page, "Save contract (JSON)"));
    expect(JSON.parse(await readFile(contractPath, "utf8")).schema_version).toBe("1.0");

    await page.locator("#clear-session").click();
    await upload(rightNumbers);
    await page.locator("#contract-file").setInputFiles(contractPath);
    await expect(page.locator("#step-run")).toBeVisible();
    await expect(page.getByLabel("Strip leading zeros")).toBeChecked();
    await expect(page.locator("#mapping-editors tbody tr")).toHaveCount(1);
    await page.locator("#run-reconciliation").click();
    await expect(page.locator("#step-results")).toBeVisible();
    expect(await downloadText(page, "Full results CSV")).toBe(firstRun);

    await page.locator("#clear-session").click();
    await upload("employee_number,given_name\n1,Ada\n");
    await page.locator("#contract-file").setInputFiles(contractPath);
    await expect(page.locator("#error")).toHaveAttribute("data-code", "COLUMNS_MISSING");
    await expect(page.locator("#error")).toContainText("Dataset B is missing 'company_code'");
    await expect(page.locator("#step-fields")).toBeHidden();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function stepStates(page: import("@playwright/test").Page) {
  return page.locator("section.step").evaluateAll((steps) =>
    Object.fromEntries(steps.map((step) => [step.id.replace("step-", ""), (step as HTMLElement).dataset.state ?? "hidden"])));
}

test("steps expose data-state, metric tiles data-tone, and a reset explains itself", async ({ page }) => {
  await page.goto(artifact);
  expect(await stepStates(page)).toMatchObject({ upload: "active", identity: "hidden" });
  await page.locator("#left-file").setInputFiles({ name: "left.csv", mimeType: "text/csv", buffer: Buffer.from(leftRichCsv) });
  await page.locator("#right-file").setInputFiles({ name: "right.csv", mimeType: "text/csv", buffer: Buffer.from(rightRichCsv) });
  await expect(page.locator("#step-identity")).toHaveAttribute("data-state", "active");
  expect(await stepStates(page)).toMatchObject({ upload: "done", identity: "active", fields: "hidden" });
  await page.locator("#confirm-identity").click();
  await page.locator("#field-rows select").nth(5).selectOption("Value mapping");
  await page.locator("#confirm-fields").click();
  await page.locator("#confirm-mappings").click();
  await page.locator("#run-reconciliation").click();
  await expect(page.locator("#step-results")).toHaveAttribute("data-state", "active");
  expect(await stepStates(page)).toEqual({ upload: "done", identity: "done", fields: "done", mappings: "done", run: "done", results: "active" });

  const tones = await page.locator(".metric").evaluateAll((tiles) =>
    Object.fromEntries(tiles.map((tile) => [tile.querySelector("span")!.textContent, (tile as HTMLElement).dataset.tone])));
  expect(tones).toMatchObject({ "Matched employees": "ok", "Field discrepancies": "ok", "Missing in Dataset A": "ok", "left records": "neutral" });

  await page.locator("#mapping-editors input[type=text]").nth(0).fill("NEW_CANONICAL");
  await page.locator("#mapping-editors input[type=text]").nth(0).blur();
  await expect(page.locator("#step-mappings")).toHaveAttribute("data-state", "stale");
  await expect(page.locator("#step-mappings .step-note")).toHaveText("Results reset because the value mappings changed.");
  expect(await stepStates(page)).toMatchObject({ mappings: "stale", run: "hidden", results: "hidden" });
  await page.locator("#confirm-mappings").click();
  await expect(page.locator("#step-mappings")).toHaveAttribute("data-state", "done");
  await expect(page.locator("#step-mappings .step-note")).toHaveCount(0);
});

test("theme: system fonts, light and dark tokens, sticky tabular tables, chevrons, tones", async ({ page }) => {
  await page.goto(artifact);
  const fontFamily = await page.locator("body").evaluate((el) => getComputedStyle(el).fontFamily);
  expect(fontFamily).not.toMatch(/Inter/);
  expect(fontFamily).toMatch(/system-ui/);
  const luminance = async () => page.locator("body").evaluate((el) => {
    const [r, g, b] = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g)!.map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  });
  await page.emulateMedia({ colorScheme: "light" });
  expect(await luminance()).toBeGreaterThan(0.9);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await luminance()).toBeLessThan(0.1);
  await page.emulateMedia({ colorScheme: "light" });

  await page.locator("#left-file").setInputFiles({ name: "left.csv", mimeType: "text/csv", buffer: Buffer.from(leftRichCsv) });
  await page.locator("#right-file").setInputFiles({ name: "right.csv", mimeType: "text/csv", buffer: Buffer.from(rightRichCsv + "003,Linus,9999\n") });
  await expect(page.locator("#step-identity")).toHaveAttribute("data-state", "active");
  expect(await page.locator("#left-identity").evaluate((el) => getComputedStyle(el).backgroundImage)).toMatch(/^url\("data:image\/svg\+xml/);
  await page.locator("#confirm-identity").click();
  await page.locator("#confirm-fields").click();
  await page.locator("#confirm-mappings").click();
  await page.locator("#run-reconciliation").click();
  await expect(page.locator("#identity-issues table")).toBeVisible();
  const table = page.locator("#identity-issues");
  expect(await table.locator("th").first().evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
  expect(await table.locator("table").evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toBe("tabular-nums");
  expect(await table.locator(".table-scroll").evaluate((el) => getComputedStyle(el).maxHeight)).not.toBe("none");
  expect(await table.locator("td").first().evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/monospace/);

  const toneColor = (tone: string) => page.locator(`.metric[data-tone="${tone}"]`).first().evaluate((el) => getComputedStyle(el, "::before").backgroundColor);
  expect(await toneColor("bad")).not.toBe(await toneColor("ok"));
  expect(await page.locator("#step-upload .step-number").evaluate((el) => getComputedStyle(el, "::after").maskImage || getComputedStyle(el, "::after").webkitMaskImage)).toMatch(/data:image\/svg\+xml/);
});

test("worker operations show progress, set aria-busy, and disable actions until done", async ({ page }) => {
  await page.addInitScript(() => {
    const add = Worker.prototype.addEventListener;
    Worker.prototype.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
      if (type === "message" && typeof listener === "function") {
        const delayed = function (this: Worker, event: Event) { window.setTimeout(() => listener.call(this, event), 600); };
        return add.call(this, type, delayed as EventListener, options);
      }
      return add.call(this, type, listener, options);
    };
  });
  await page.goto(artifact);
  await expect(page.locator("#busy")).toBeHidden();
  await page.locator("#left-file").setInputFiles({ name: "left.csv", mimeType: "text/csv", buffer: Buffer.from(leftCsv) });
  await expect(page.locator("#busy")).toContainText("Reading and profiling the file…");
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#busy [role=progressbar]")).toBeVisible();
  await expect(page.locator("#busy")).toBeHidden();
  await page.locator("#right-file").setInputFiles({ name: "right.csv", mimeType: "text/csv", buffer: Buffer.from(rightCsv) });
  await expect(page.locator("#busy")).toContainText("Suggesting employee identity fields…");
  await expect(page.locator("#busy")).toBeHidden();
  await expect(page.locator("main")).not.toHaveAttribute("aria-busy", "true");
  await page.locator("#confirm-identity").click();
  await page.locator("#confirm-fields").click();
  await page.locator("#confirm-mappings").click();
  await page.locator("#run-reconciliation").click();
  await expect(page.locator("#busy")).toContainText("Reconciling…");
  await expect(page.locator("#run-reconciliation")).toBeDisabled();
  await expect(page.locator("#clear-session")).toBeEnabled();
  await expect(page.locator("#step-results")).toBeVisible();
  await expect(page.locator("#busy")).toBeHidden();
  await expect(page.locator("#run-reconciliation")).toBeEnabled();
});

test("accessibility: focus moves to the next step, tables have captions and scopes, drops are checked, errors stay in view", async ({ page }) => {
  await page.goto(artifact);
  await page.locator("#left-file").setInputFiles({ name: "left.csv", mimeType: "text/csv", buffer: Buffer.from(leftRichCsv) });
  await page.locator("#right-file").setInputFiles({ name: "right.csv", mimeType: "text/csv", buffer: Buffer.from(rightRichCsv + "003,Linus,9999\n") });
  await page.locator("#confirm-identity").click();
  await expect(page.locator("#step-fields-title")).toBeFocused();
  await expect(page.locator("#step-fields-title")).toHaveAttribute("tabindex", "-1");
  await page.locator("#confirm-fields").click();
  await expect(page.locator("#step-mappings-title")).toBeFocused();
  await page.locator("#confirm-mappings").click();
  await expect(page.locator("#step-run-title")).toBeFocused();
  await page.locator("#run-reconciliation").click();
  await expect(page.locator("#step-results-title")).toBeFocused();
  await expect(page.locator("#detail-summary table")).toBeVisible();

  const tables = await page.locator("table").evaluateAll((all) => all
    .filter((table) => (table as HTMLElement).offsetParent !== null || table.closest("details"))
    .map((table) => ({
      caption: table.querySelector("caption")?.textContent?.trim() ?? "",
      unscoped: Array.from(table.querySelectorAll("thead th")).filter((th) => th.getAttribute("scope") !== "col").length,
    })));
  expect(tables.length).toBeGreaterThan(4);
  for (const table of tables) {
    expect(table.caption.length, JSON.stringify(table)).toBeGreaterThan(0);
    expect(table.unscoped).toBe(0);
  }

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const scrolled = await page.evaluate(() => window.scrollY);
  await page.locator("#left-card").evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "notes.txt", { type: "text/plain" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.locator("#error")).toHaveAttribute("data-code", "FILE_TYPE");
  await expect(page.locator("#error")).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  await expect(page.locator("#step-results")).toBeVisible();
  await page.locator("#error").getByRole("button", { name: "Dismiss" }).click();
  await expect(page.locator("#error")).toBeHidden();
});
