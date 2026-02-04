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
