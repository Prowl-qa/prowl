import { describe, expect, it, vi } from "vitest";
import { analyzePage } from "../src/analyzer/index.js";
import type { Page } from "playwright";

function createMockPage(evaluateResult: unknown) {
  return {
    evaluate: vi.fn(async () => evaluateResult)
  } as unknown as Page;
}

describe("analyzePage", () => {
  it("extracts elements with selectors", async () => {
    const page = createMockPage({
      title: "Login - Example App",
      url: "https://example.com/login",
      elements: [
        {
          tag: "input",
          type: "email",
          testId: "email-input",
          ariaLabel: null,
          role: null,
          id: "email",
          name: "email",
          label: "Email address",
          placeholder: "you@example.com",
          required: true,
          formIndex: 0,
          text: null,
          href: null
        },
        {
          tag: "button",
          type: "submit",
          testId: "login-btn",
          ariaLabel: null,
          role: null,
          id: null,
          name: null,
          label: null,
          placeholder: null,
          required: false,
          formIndex: 0,
          text: "Sign In",
          href: null
        }
      ],
      forms: [
        { index: 0, action: "/api/auth/login", method: "POST", fieldCount: 3 }
      ]
    });

    const result = await analyzePage(page);

    expect(result.title).toBe("Login - Example App");
    expect(result.url).toBe("https://example.com/login");
    expect(result.elements).toHaveLength(2);
    expect(result.elements[0].tag).toBe("input");
    expect(result.elements[0].selectors.testId).toBe('[data-testid="email-input"]');
    expect(result.elements[0].selectors.label).toBe("Email address");
    expect(result.elements[0].selectors.css).toBe("#email");
    expect(result.elements[0].required).toBe(true);
    expect(result.elements[0].formGroup).toBe(0);
    expect(result.elements[1].tag).toBe("button");
    expect(result.elements[1].selectors.testId).toBe('[data-testid="login-btn"]');
    expect(result.elements[1].selectors.text).toBe("Sign In");
  });

  it("extracts forms", async () => {
    const page = createMockPage({
      title: "Test",
      url: "https://example.com",
      elements: [],
      forms: [
        { index: 0, action: "/submit", method: "POST", fieldCount: 5 },
        { index: 1, action: "/search", method: "GET", fieldCount: 1 }
      ]
    });

    const result = await analyzePage(page);
    expect(result.forms).toHaveLength(2);
    expect(result.forms[0].action).toBe("/submit");
    expect(result.forms[0].method).toBe("POST");
    expect(result.forms[0].fieldCount).toBe(5);
  });

  it("extracts links", async () => {
    const page = createMockPage({
      title: "Test",
      url: "https://example.com",
      elements: [
        {
          tag: "a",
          type: null,
          testId: null,
          ariaLabel: null,
          role: null,
          id: null,
          name: null,
          label: null,
          placeholder: null,
          required: false,
          formIndex: -1,
          text: "Forgot password?",
          href: "/forgot-password"
        },
        {
          tag: "a",
          type: null,
          testId: "signup-link",
          ariaLabel: null,
          role: null,
          id: null,
          name: null,
          label: null,
          placeholder: null,
          required: false,
          formIndex: -1,
          text: "Sign up",
          href: "/signup"
        }
      ],
      forms: []
    });

    const result = await analyzePage(page);
    expect(result.elements).toHaveLength(0); // links are not in elements
    expect(result.links).toHaveLength(2);
    expect(result.links[0].text).toBe("Forgot password?");
    expect(result.links[0].href).toBe("/forgot-password");
    expect(result.links[0].selector).toBe('a[href="/forgot-password"]');
    expect(result.links[1].selector).toBe('[data-testid="signup-link"]');
  });

  it("assigns formGroup only to elements within forms", async () => {
    const page = createMockPage({
      title: "Test",
      url: "https://example.com",
      elements: [
        {
          tag: "input",
          type: "text",
          testId: null,
          ariaLabel: null,
          role: null,
          id: "search",
          name: "q",
          label: null,
          placeholder: "Search...",
          required: false,
          formIndex: -1,
          text: null,
          href: null
        }
      ],
      forms: []
    });

    const result = await analyzePage(page);
    expect(result.elements[0].formGroup).toBeUndefined();
  });

  it("ranks selectors with testId first", async () => {
    const page = createMockPage({
      title: "Test",
      url: "https://example.com",
      elements: [
        {
          tag: "input",
          type: "text",
          testId: "username",
          ariaLabel: "Username",
          role: null,
          id: "user-input",
          name: "user",
          label: "Username",
          placeholder: "Enter username",
          required: false,
          formIndex: -1,
          text: null,
          href: null
        }
      ],
      forms: []
    });

    const result = await analyzePage(page);
    const selectors = result.elements[0].selectors;
    expect(selectors.testId).toBe('[data-testid="username"]');
    expect(selectors.ariaLabel).toBe("Username");
    expect(selectors.css).toBe("#user-input");
  });
});
