import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "yaml";
import { z } from "zod";

const projectEntrySchema = z
  .object({
    root: z.string().min(1),
    /** Optional override; defaults to <root>/.prowl/config.yml (legacy: .prowlqa/). */
    configPath: z.string().min(1).optional()
  })
  .strict();

const projectRegistrySchema = z
  .object({
    projects: z.record(z.string().min(1), projectEntrySchema)
  })
  .strict();

export type ProjectEntry = z.infer<typeof projectEntrySchema>;

export interface ProjectRegistry {
  projects: Record<string, ProjectEntry>;
  registryPath: string;
}

export interface ResolvedProject {
  name: string;
  root: string;
  configPath: string;
}

/** Default registry location used when neither CLI flag nor env var is set. */
function defaultRegistryPath(): string {
  return path.join(os.homedir(), ".prowl", "projects.yml");
}

/** Legacy registry location (pre-rename), still honored for back-compat. */
function legacyRegistryPath(): string {
  return path.join(os.homedir(), ".prowlqa", "projects.yml");
}

/** Resolve a project's config path within its root, preferring .prowl/ over legacy .prowlqa/. */
function resolveProjectConfigPath(root: string): string {
  const preferred = path.join(root, ".prowl", "config.yml");
  if (fs.existsSync(preferred)) return preferred;
  const legacy = path.join(root, ".prowlqa", "config.yml");
  if (fs.existsSync(legacy)) return legacy;
  return preferred;
}

/** Resolve a project entry path relative to the registry file that declared it. */
function resolveRegistryRelativePath(registry: ProjectRegistry, inputPath: string): string {
  return path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(path.dirname(registry.registryPath), inputPath);
}

/**
 * Resolve which registry file to use, in priority order: an explicit path
 * (`prowl mcp --projects`), the `PROWL_PROJECTS` env var (or legacy
 * `PROWLQA_PROJECTS`), then the default `~/.prowl/projects.yml` (or legacy
 * `~/.prowlqa/projects.yml`). Returns null when no registry is configured.
 */
export function resolveRegistryPath(explicitPath?: string): string | null {
  if (explicitPath) return path.resolve(explicitPath);
  const envPath = process.env.PROWL_PROJECTS ?? process.env.PROWLQA_PROJECTS;
  if (envPath) return path.resolve(envPath);
  const fallback = defaultRegistryPath();
  if (fs.existsSync(fallback)) return fallback;
  const legacy = legacyRegistryPath();
  return fs.existsSync(legacy) ? legacy : null;
}

/** Load and validate the project registry, or return null when none is configured. */
export function loadProjectRegistry(explicitPath?: string): ProjectRegistry | null {
  const registryPath = resolveRegistryPath(explicitPath);
  if (!registryPath) return null;
  if (!fs.existsSync(registryPath)) {
    throw new Error(`Project registry not found at ${registryPath}`);
  }
  const raw = fs.readFileSync(registryPath, "utf-8");
  const parsed = yaml.parse(raw) ?? {};
  const validated = projectRegistrySchema.parse(parsed);
  return { projects: validated.projects, registryPath };
}

/** Resolve a project name to its root and config path; throws if the name is unknown. */
export function resolveProject(registry: ProjectRegistry, name: string): ResolvedProject {
  const entry = registry.projects[name];
  if (!entry) {
    const known = Object.keys(registry.projects).sort().join(", ") || "(none)";
    throw new Error(`Unknown project "${name}". Registered projects: ${known}`);
  }
  const root = resolveRegistryRelativePath(registry, entry.root);
  const configPath = entry.configPath
    ? resolveRegistryRelativePath(registry, entry.configPath)
    : resolveProjectConfigPath(root);
  return { name, root, configPath };
}

/** List registered projects as `{ name, root }` pairs (empty when no registry). */
export function listRegisteredProjects(registry: ProjectRegistry | null): Array<{ name: string; root: string }> {
  if (!registry) return [];
  return Object.entries(registry.projects).map(([name, entry]) => ({
    name,
    root: resolveRegistryRelativePath(registry, entry.root)
  }));
}
