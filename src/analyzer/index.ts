import type { Page } from "playwright";

export type PageElement = {
  tag: string;
  type?: string;
  selectors: Record<string, string>;
  role?: string;
  label?: string;
  placeholder?: string;
  required: boolean;
  formGroup?: number;
};

export type PageForm = {
  index: number;
  action?: string;
  method?: string;
  fieldCount: number;
};

export type PageLink = {
  text: string;
  href: string;
  selector: string;
};

export type AnalysisResult = {
  url: string;
  title: string;
  elements: PageElement[];
  forms: PageForm[];
  links: PageLink[];
};

type RawElement = {
  tag: string;
  type?: string;
  testId?: string;
  ariaLabel?: string;
  role?: string;
  id?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  required: boolean;
  formIndex: number;
  text?: string;
  href?: string;
};

type RawForm = {
  index: number;
  action?: string;
  method?: string;
  fieldCount: number;
};

type RawAnalysis = {
  title: string;
  url: string;
  elements: RawElement[];
  forms: RawForm[];
};

export async function analyzePage(page: Page): Promise<AnalysisResult> {
  const raw = await page.evaluate(() => {
    const forms = Array.from(document.querySelectorAll("form"));
    const formData = forms.map((form, index) => ({
      index,
      action: form.getAttribute("action") || undefined,
      method: (form.getAttribute("method") || "GET").toUpperCase(),
      fieldCount: form.querySelectorAll("input, textarea, select").length
    }));

    function getFormIndex(el: Element): number {
      const form = el.closest("form");
      if (!form) return -1;
      return forms.indexOf(form);
    }

    function getLabel(el: Element): string | undefined {
      const id = el.getAttribute("id");
      if (id) {
        const label = document.querySelector(`label[for="${id}"]`);
        if (label) return label.textContent?.trim() || undefined;
      }
      const parentLabel = el.closest("label");
      if (parentLabel) return parentLabel.textContent?.trim() || undefined;
      return undefined;
    }

    const selectors = "input, textarea, select, button, [role=button], a";
    const rawElements = Array.from(document.querySelectorAll(selectors));

    const elements = rawElements
      .filter((el) => {
        if (el.tagName.toLowerCase() === "input" && el.getAttribute("type") === "hidden") {
          return false;
        }
        return true;
      })
      .map((el) => {
        const tag = el.tagName.toLowerCase();
        const type = el.getAttribute("type") || undefined;
        const testId = el.getAttribute("data-testid") || undefined;
        const ariaLabel = el.getAttribute("aria-label") || undefined;
        const role = el.getAttribute("role") || undefined;
        const id = el.getAttribute("id") || undefined;
        const name = el.getAttribute("name") || undefined;
        const label = getLabel(el);
        const placeholder = el.getAttribute("placeholder") || undefined;
        const required = el.hasAttribute("required");
        const formIndex = getFormIndex(el);
        const text = el.textContent?.trim() || undefined;
        const href = el.getAttribute("href") || undefined;

        return {
          tag,
          type: type || undefined,
          testId,
          ariaLabel,
          role,
          id,
          name,
          label,
          placeholder,
          required,
          formIndex,
          text: tag === "a" || tag === "button" || role === "button" ? text : undefined,
          href: tag === "a" ? href : undefined
        };
      });

    return {
      title: document.title,
      url: window.location.href,
      elements,
      forms: formData
    };
  }) as RawAnalysis;

  const elements: PageElement[] = raw.elements
    .filter((el) => el.tag !== "a")
    .map((el) => {
      const selectors: Record<string, string> = {};
      if (el.testId) selectors.testId = `[data-testid="${el.testId}"]`;
      if (el.ariaLabel) selectors.ariaLabel = el.ariaLabel;
      if (el.label) selectors.label = el.label;
      if (el.id) selectors.css = `#${el.id}`;
      if (el.name) selectors.name = `[name="${el.name}"]`;
      if (el.placeholder) selectors.placeholder = el.placeholder;
      if (el.text) selectors.text = el.text;
      if (el.role) selectors.role = el.role;

      return {
        tag: el.tag,
        ...(el.type ? { type: el.type } : {}),
        selectors,
        ...(el.role ? { role: el.role } : {}),
        ...(el.label ? { label: el.label } : {}),
        ...(el.placeholder ? { placeholder: el.placeholder } : {}),
        required: el.required,
        ...(el.formIndex >= 0 ? { formGroup: el.formIndex } : {})
      };
    });

  const links: PageLink[] = raw.elements
    .filter((el) => el.tag === "a" && el.href)
    .map((el) => {
      let selector: string;
      if (el.testId) {
        selector = `[data-testid="${el.testId}"]`;
      } else if (el.href) {
        selector = `a[href="${el.href}"]`;
      } else {
        selector = `a`;
      }
      return {
        text: el.text || "",
        href: el.href!,
        selector
      };
    });

  const forms: PageForm[] = raw.forms;

  return {
    url: raw.url,
    title: raw.title,
    elements,
    forms,
    links
  };
}
