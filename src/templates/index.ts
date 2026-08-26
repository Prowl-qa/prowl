import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { getPackageRoot } from "../utils/package-root.js";

/**
 * Starter templates (PROWL-072). The `templates/<category>/<name>.yml` tree ships
 * in the npm tarball; this module lists and resolves them for `prowl init
 * --template` and `prowl templates`. Templates are ordinary hunts — nothing is
 * interpolated or executed here, only read.
 */

export type TemplateInfo = {
  /** `<category>/<name>` — the id used on the command line. */
  id: string;
  category: string;
  name: string;
  description: string;
  tags: string[];
  /** Absolute path of the template file inside the package. */
  path: string;
};

const SEGMENT = "[a-z0-9][a-z0-9-]*";
const TEMPLATE_ID_PATTERN = new RegExp(`^${SEGMENT}/${SEGMENT}$`);

export const TEMPLATES_DIR_NAME = "templates";

export function getTemplatesDir(): string {
  return path.join(getPackageRoot(), TEMPLATES_DIR_NAME);
}

/** Ids are `<category>/<name>` in lowercase kebab-case — no dots, no traversal. */
export function isValidTemplateId(id: string): boolean {
  return TEMPLATE_ID_PATTERN.test(id);
}

function readMeta(filePath: string): { description: string; tags: string[] } {
  const parsed: unknown = yaml.parse(fs.readFileSync(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object") {
    return { description: "", tags: [] };
  }
  const doc = parsed as { description?: unknown; tags?: unknown };
  const description = typeof doc.description === "string" ? doc.description : "";
  const tags = Array.isArray(doc.tags)
    ? doc.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  return { description, tags };
}

/** Every bundled template, sorted by id. */
export function listTemplates(templatesDir: string = getTemplatesDir()): TemplateInfo[] {
  if (!fs.existsSync(templatesDir)) {
    return [];
  }

  const templates: TemplateInfo[] = [];
  const categories = fs
    .readdirSync(templatesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const category of categories) {
    const categoryDir = path.join(templatesDir, category);
    const files = fs
      .readdirSync(categoryDir)
      .filter((file) => file.endsWith(".yml"))
      .sort();

    for (const file of files) {
      const name = file.slice(0, -".yml".length);
      const id = `${category}/${name}`;
      if (!isValidTemplateId(id)) {
        continue;
      }
      const filePath = path.join(categoryDir, file);
      templates.push({ id, category, name, ...readMeta(filePath), path: filePath });
    }
  }

  return templates;
}

/** Categories present in the bundle, sorted. */
export function listTemplateCategories(templatesDir: string = getTemplatesDir()): string[] {
  return [...new Set(listTemplates(templatesDir).map((template) => template.category))];
}

/** Resolve an id to its template, or null when the id is malformed or unknown. */
export function resolveTemplate(
  id: string,
  templatesDir: string = getTemplatesDir()
): TemplateInfo | null {
  if (!isValidTemplateId(id)) {
    return null;
  }
  const [category, name] = id.split("/");
  const filePath = path.join(templatesDir, category, `${name}.yml`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return { id, category, name, ...readMeta(filePath), path: filePath };
}

/** Raw YAML of a template. Throws for a malformed or unknown id. */
export function readTemplate(id: string, templatesDir: string = getTemplatesDir()): string {
  const template = resolveTemplate(id, templatesDir);
  if (!template) {
    throw new Error(
      `Unknown template "${id}". Run "prowl templates list" to see the available ids.`
    );
  }
  return fs.readFileSync(template.path, "utf8");
}
