import type { Page } from "playwright";

export async function clickElement(page: Page, selector: string): Promise<void> {
  await page.locator(selector).click();
}

export async function fillElement(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).fill(value);
}

export async function pressKey(page: Page, selector: string, key: string): Promise<void> {
  await page.locator(selector).press(key);
}

export async function selectOption(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).selectOption(value);
}

export function setupDialogHandler(page: Page, action: "accept" | "dismiss"): void {
  page.once("dialog", async (dialog) => {
    if (action === "accept") {
      await dialog.accept();
    } else {
      await dialog.dismiss();
    }
  });
}

export async function setInputFiles(page: Page, selector: string, files: string | string[]): Promise<void> {
  await page.locator(selector).setInputFiles(files);
}
