import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const APP_URL = pathToFileURL(resolve("dist/hris-reconcile.html")).href;
const ALERT_SELECTOR = '#results-messages [data-id="export-warning"]';
const WARNING_TITLE = "This export contains sensitive employee data";
const WARNING_BODY = "Store it only in an approved location, share it only through approved channels, and delete it as soon as it is no longer needed for its intended purpose.";
const EXPORTS = [
  ["differences.csv", "differences.csv"],
  ["comparison.csv", "comparison.csv"],
  ["report.html", "report.html"],
  ["report.json", "audit.json"],
  ["full.csv", "raw_results.csv"],
  ["mismatches.csv", "raw_differences.csv"],
] as const;

async function preparePage(page: Page, testInfo: TestInfo): Promise<void> {
  await page.addInitScript((stubPicker: boolean) => {
    const scope = window as typeof window & Record<string, any>;
    scope.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      scope.__cspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
    });
    scope.__clipboardText = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => { scope.__clipboardText = text; } },
    });
    if (stubPicker) {
      scope.__pickerStats = { calls: [], writes: 0, enteredClose: false, closes: 0, holdClose: false, releaseClose: null };
      Object.defineProperty(window, "showSaveFilePicker", {
        configurable: true,
        value: async (options: { suggestedName: string; id: string }) => {
          scope.__pickerStats.calls.push(options);
          return {
            createWritable: async () => ({
              write: async (_blob: Blob) => { scope.__pickerStats.writes++; },
              close: async () => {
                scope.__pickerStats.enteredClose = true;
                if (scope.__pickerStats.holdClose) {
                  await new Promise<void>((resolve) => { scope.__pickerStats.releaseClose = resolve; });
                }
                scope.__pickerStats.closes++;
              },
              abort: async () => {},
            }),
          };
        },
      });
    }
  }, testInfo.project.name === "chromium");

  await page.goto(APP_URL);
  await page.locator("#left-file").setInputFiles({
    name: "file-a.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Employee ID,Name,Department,Salary\n1,Ada,HR,100\n2,Grace,Payroll,200\n"),
  });
  await page.locator("#right-file").setInputFiles({
    name: "file-b.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Employee ID,Name,Department,Salary\n1,Ada,HR,100\n2,Grace,Finance,250\n"),
  });
  await expect(page.locator("#compare")).toBeEnabled({ timeout: 30_000 });
  await page.locator("#compare").click();
  await expect(page.locator("#verdict")).not.toBeEmpty({ timeout: 30_000 });
}

async function warning(page: Page, area: "results" | "settings", context: string): Promise<void> {
  const alert = page.locator(`#${area}-messages [data-id="export-warning"]`);
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toHaveAttribute("aria-live", "assertive");
  await expect(alert.locator(".message-body > p").first()).toHaveText(WARNING_TITLE);
  await expect(alert.locator(".message-detail")).toHaveText(WARNING_BODY);
  await expect(alert.locator(".message-context")).toContainText(context);
}

async function exportFile(page: Page, testInfo: TestInfo, format: string, filename: string): Promise<void> {
  const area = page.locator(`#export-panel [data-export="${format}"]`);
  await page.locator("#export-toggle").click();
  if (testInfo.project.name === "chromium") {
    const previous = await page.evaluate(() => (window as any).__pickerStats.calls.length);
    await area.click();
    await page.waitForFunction((count) => (window as any).__pickerStats.closes > count, previous);
    const options = await page.evaluate(() => (window as any).__pickerStats.calls.at(-1));
    expect(options).toEqual({ suggestedName: expect.stringContaining(filename), id: "hris-reconcile-export" });
  } else {
    const downloadEvent = page.waitForEvent("download");
    await area.click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toContain(filename);
  }
  await warning(page, "results", filename);
}

async function contrastRatio(page: Page, selector: string): Promise<number> {
  const colors = await page.locator(selector).evaluate((element) => {
    const foreground = getComputedStyle(element).color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const background = getComputedStyle(element.closest("[data-id='export-warning']")!).backgroundColor.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    return { foreground, background };
  });
  const luminance = (rgb: number[]) => {
    const linear = rgb.map((component) => {
      const value = component / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const values = [luminance(colors.foreground), luminance(colors.background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("each export path warns after its file or clipboard write, with no CSP violations", async ({ page }, testInfo) => {
  await preparePage(page, testInfo);

  for (const [format, filename] of EXPORTS) await exportFile(page, testInfo, format, filename);

  await page.locator("#export-toggle").click();
  await page.locator('#export-panel [data-action="copy-summary"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__clipboardText)).toContain("Reconciliation:");
  await warning(page, "results", "Summary copied to the clipboard");

  if (testInfo.project.name === "chromium") {
    const previous = await page.evaluate(() => (window as any).__pickerStats.calls.length);
    await page.locator("#save-settings").click();
    await page.waitForFunction((count) => (window as any).__pickerStats.closes > count, previous);
    expect(await page.evaluate(() => (window as any).__pickerStats.calls.at(-1).id)).toBe("hris-reconcile-export");
  } else {
    const downloadEvent = page.waitForEvent("download");
    await page.locator("#save-settings").click();
    expect((await downloadEvent).suggestedFilename()).toContain(".settings.json");
  }
  await warning(page, "settings", ".settings.json");

  const violations = await page.evaluate(() => (window as any).__cspViolations);
  expect(violations, JSON.stringify(violations)).toEqual([]);
});

test("warning persists for 15 seconds and dismisses by mouse and keyboard", async ({ page }, testInfo) => {
  await preparePage(page, testInfo);
  await exportFile(page, testInfo, "full.csv", "raw_results.csv");
  const alert = page.locator(ALERT_SELECTOR);
  await page.waitForTimeout(15_000);
  await expect(alert).toBeVisible();
  await alert.getByRole("button", { name: "Dismiss" }).click();
  await expect(alert).toHaveCount(0);

  await exportFile(page, testInfo, "mismatches.csv", "raw_differences.csv");
  const secondAlert = page.locator('#results-messages [data-id="export-warning"]');
  await secondAlert.getByRole("button", { name: "Dismiss" }).focus();
  await page.keyboard.press("Enter");
  await expect(secondAlert).toHaveCount(0);
});

test("shows the warning only after the picker write has closed", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "picker API is stubbed in Chromium only");
  await preparePage(page, testInfo);
  await page.evaluate(() => { (window as any).__pickerStats.holdClose = true; });
  await page.locator("#export-toggle").click();
  await page.locator('#export-panel [data-export="report.json"]').click();
  await page.waitForFunction(() => (window as any).__pickerStats.enteredClose);
  await expect(page.locator(ALERT_SELECTOR)).toHaveCount(0);
  await page.evaluate(() => (window as any).__pickerStats.releaseClose());
  await warning(page, "results", "audit.json");
});

test("captures light and dark warning screenshots with WCAG AA text contrast", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "screenshots are captured in Chromium");
  await preparePage(page, testInfo);
  await exportFile(page, testInfo, "report.html", "report.html");
  const alert = page.locator(ALERT_SELECTOR);
  const directory = resolve("test-results");
  await mkdir(directory, { recursive: true });

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(alert).toBeVisible();
    expect(await contrastRatio(page, `${ALERT_SELECTOR} .message-body > p:first-child`)).toBeGreaterThanOrEqual(4.5);
    expect(await contrastRatio(page, `${ALERT_SELECTOR} .message-detail`)).toBeGreaterThanOrEqual(4.5);
    await alert.screenshot({ path: resolve(directory, `export-warning-${scheme}.png`) });
  }
});
