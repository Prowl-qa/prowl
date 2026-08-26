import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { describe, expect, it, vi } from "vitest";
import { huntSchema } from "../src/config/schema.js";
import {
  getTemplatesDir,
  isValidTemplateId,
  listTemplateCategories,
  listTemplates,
  readTemplate,
  resolveTemplate
} from "../src/templates/index.js";
import { buildTemplatesCommand, formatTemplateCatalog } from "../src/cli/commands/templates.js";

/** Steps the macOS target accepts (README "Step compatibility" table). */
const MACOS_PORTABLE_STEPS = new Set([
  "click", "fill", "type", "press", "wait", "waitForSelector", "assert", "screenshot",
  "assertScreenshot", "hover", "scrollTo", "repeat", "if", "runHunt", "copyText"
]);

function walkYaml(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkYaml(full));
    } else if (entry.name.endsWith(".yml")) {
      files.push(full);
    }
  }
  return files.sort();
}

describe("bundled starter templates", () => {
  const templatesDir = getTemplatesDir();
  const templates = listTemplates();
  const files = walkYaml(templatesDir);

  it("ships a templates/ tree at the package root", () => {
    expect(path.basename(templatesDir)).toBe("templates");
    expect(files.length).toBeGreaterThan(0);
  });

  it("lists every .yml under templates/<category>/ and nothing else", () => {
    expect(templates.map((t) => t.path)).toEqual(files);
  });

  it("covers the categories migrated from Prowl Hub plus macOS", () => {
    expect(listTemplateCategories()).toEqual(
      expect.arrayContaining([
        "accessibility", "admin", "auth", "docs", "e-commerce", "forms", "macos", "saas", "smoke"
      ])
    );
  });

  it("carries the 23 hunts migrated from Prowl Hub (HUB-016)", () => {
    const hubTemplates = templates.filter((t) => t.category !== "macos");
    expect(hubTemplates).toHaveLength(23);
  });

  for (const template of templates) {
    describe(template.id, () => {
      const doc: unknown = yaml.parse(fs.readFileSync(template.path, "utf8"));

      it("is valid against huntSchema", () => {
        const result = huntSchema.safeParse(doc);
        if (!result.success) {
          throw new Error(
            result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n")
          );
        }
      });

      it("has an id, name matching its filename, a description, and tags", () => {
        expect(isValidTemplateId(template.id)).toBe(true);
        expect((doc as { name?: string }).name).toBe(template.name);
        expect(template.description.length).toBeGreaterThan(0);
        expect(template.tags.length).toBeGreaterThan(0);
      });

      it("declares every {{VAR}} its steps use (vars may themselves read from .env)", () => {
        const { vars = {}, steps } = doc as { vars?: Record<string, string>; steps: unknown[] };
        const declared = Object.keys(vars);
        const used = [...JSON.stringify(steps).matchAll(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g)].map(
          (m) => m[1]
        );
        for (const name of used) {
          expect(declared, `${name} used in steps but not declared in vars`).toContain(name);
        }
      });

      if (template.category === "macos") {
        it("uses only steps the macOS target supports", () => {
          const steps = (doc as { steps: Record<string, unknown>[] }).steps;
          for (const step of steps) {
            const [key] = Object.keys(step);
            expect(MACOS_PORTABLE_STEPS.has(key), `step "${key}" is web-only`).toBe(true);
          }
        });
      }
    });
  }
});

describe("template resolution", () => {
  it("accepts <category>/<name> ids and rejects everything else", () => {
    expect(isValidTemplateId("auth/login-flow")).toBe(true);
    expect(isValidTemplateId("e-commerce/stripe-checkout")).toBe(true);
    expect(isValidTemplateId("auth")).toBe(false);
    expect(isValidTemplateId("auth/login-flow.yml")).toBe(false);
    expect(isValidTemplateId("../auth/login-flow")).toBe(false);
    expect(isValidTemplateId("auth/../../etc/passwd")).toBe(false);
    expect(isValidTemplateId("Auth/Login")).toBe(false);
    expect(isValidTemplateId("")).toBe(false);
  });

  it("resolves a known id and returns null for unknown or malformed ids", () => {
    const template = resolveTemplate("auth/login-flow");
    expect(template?.name).toBe("login-flow");
    expect(template?.category).toBe("auth");
    expect(fs.existsSync(template!.path)).toBe(true);

    expect(resolveTemplate("auth/does-not-exist")).toBeNull();
    expect(resolveTemplate("../package")).toBeNull();
  });

  it("readTemplate returns the raw YAML and throws a helpful error otherwise", () => {
    const text = readTemplate("smoke/homepage");
    expect(text).toContain("name: homepage");
    expect(() => readTemplate("nope/nothing")).toThrow(/prowl templates list/);
  });

  it("listTemplates returns [] for a missing directory", () => {
    expect(listTemplates(path.join(getTemplatesDir(), "does-not-exist"))).toEqual([]);
  });
});

describe("prowl templates command", () => {
  it("list --json prints the catalog as JSON", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      buildTemplatesCommand().parse(["node", "prowl", "list", "--json"]);
      const output = JSON.parse(logSpy.mock.calls[0][0] as string) as { id: string }[];
      expect(output.map((t) => t.id)).toEqual(listTemplates().map((t) => t.id));
      expect(output[0]).not.toHaveProperty("path");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("list --category filters to one category", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      buildTemplatesCommand().parse(["node", "prowl", "list", "--category", "macos", "--json"]);
      const output = JSON.parse(logSpy.mock.calls[0][0] as string) as { category: string }[];
      expect(output.length).toBeGreaterThan(0);
      expect(output.every((t) => t.category === "macos")).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("show <id> writes the YAML to stdout and errors on unknown ids", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const originalExitCode = process.exitCode;
    try {
      buildTemplatesCommand().parse(["node", "prowl", "show", "auth/login-flow"]);
      expect(String(writeSpy.mock.calls[0][0])).toContain("name: login-flow");

      process.exitCode = undefined;
      buildTemplatesCommand().parse(["node", "prowl", "show", "auth/missing"]);
      expect(process.exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown template"));
    } finally {
      process.exitCode = originalExitCode;
      writeSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("formatTemplateCatalog groups by category and ends with the init hint", () => {
    const text = formatTemplateCatalog(listTemplates());
    expect(text).toContain("auth/login-flow");
    expect(text).toContain("prowl init --template");
  });
});
