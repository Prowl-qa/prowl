/**
 * PROWL-048 / ARCH-002 — target ⇄ step compatibility.
 *
 * The runtime capability gate in the step runner already rejects steps a driver
 * cannot honor. This adds a friendlier, earlier validation-time rejection: when
 * the selected target is macOS, hunts using web-only steps fail fast with a
 * clear message before anything launches.
 */
import type { Step, Target } from "../types/index.js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Step types that only make sense on the web target. Everything else
 * (`click`, `fill`, `type`, `press`, `wait`, `assert visible/notVisible`,
 * `screenshot`, `assertScreenshot`, `repeat`, `runHunt`, `if`, `copyText`,
 * `hover`, `scrollTo`, `waitForSelector`) is portable across targets.
 */
export const WEB_ONLY_STEP_TYPES: ReadonlySet<string> = new Set([
  "navigate",
  "waitForUrl",
  "waitForNetworkIdle",
  "mockRoute",
  "unmockRoute",
  "evalScript",
  "runScript",
  "onDialog",
  "select",
  "selectOption",
  "setInputFiles",
  "waitForDownload",
  "scroll" // directional scroll runs window.scrollBy (evaluate) — use scrollTo instead
]);

/** The web-only reason a step is unsupported on a non-web target, or null if portable. */
export function webOnlyReason(step: Step): string | null {
  for (const type of WEB_ONLY_STEP_TYPES) {
    if (type in step) {
      return type;
    }
  }
  // URL assertions are web-only; visible/notVisible assertions are portable.
  if ("assert" in step) {
    const assertion = step.assert;
    if (assertion.urlIncludes !== undefined || assertion.urlEquals !== undefined) {
      return "assert (url)";
    }
  }
  return null;
}

/**
 * Throw if any step in `steps` (recursing into `if`/`repeat` bodies) is not
 * supported by `target`. `runHunt` references are validated when the referenced
 * hunt itself runs. No-op for the web target.
 */
export function assertStepsSupportedByTarget(steps: Step[], target: Target["type"]): void {
  if (target !== "macos") {
    return;
  }
  for (const step of steps) {
    const reason = webOnlyReason(step);
    if (reason) {
      throw new Error(
        `Step "${reason}" is not supported by the macOS target. It is web-only; ` +
          "use a portable step (click, fill, type, press, wait, assert visible, screenshot, etc.)."
      );
    }
    if ("if" in step) {
      assertStepsSupportedByTarget(step.if.then, target);
      if (step.if.else) {
        assertStepsSupportedByTarget(step.if.else, target);
      }
    }
    if ("repeat" in step) {
      assertStepsSupportedByTarget(step.repeat.steps, target);
    }
  }
}

export function assertHuntAssertionsSupportedByTarget(
  assertions: unknown[] | undefined,
  target: Target["type"]
): void {
  if (target !== "macos" || !assertions || assertions.length === 0) {
    return;
  }
  throw new Error(
    "Hunt-level assertions are not supported by the macOS target. " +
      "Use inline assert visible/notVisible steps instead."
  );
}

function trimTrailingPathSeparators(value: string): string {
  return value.replace(/[\\/]+$/g, "");
}

function looksLikeMacosAppPath(app: string): boolean {
  const trimmed = trimTrailingPathSeparators(app);
  return trimmed.includes("/") || trimmed.toLowerCase().endsWith(".app");
}

function normalizeAppPath(app: string): string {
  return path.resolve(trimTrailingPathSeparators(app));
}

function parseBundleIdentifier(plist: string): string | null {
  const match = /<key>\s*CFBundleIdentifier\s*<\/key>\s*<string>\s*([^<]+?)\s*<\/string>/s.exec(plist);
  return match?.[1]?.trim() || null;
}

function readBundleIdentifier(appPath: string): string | null {
  const infoPlistPath = path.join(normalizeAppPath(appPath), "Contents", "Info.plist");
  if (!fs.existsSync(infoPlistPath)) {
    return null;
  }

  try {
    const parsed = parseBundleIdentifier(fs.readFileSync(infoPlistPath, "utf-8"));
    if (parsed) {
      return parsed;
    }
  } catch {
    // Fall through to plutil for binary plists on macOS.
  }

  if (process.platform !== "darwin" || !fs.existsSync("/usr/bin/plutil")) {
    return null;
  }

  try {
    const output = execFileSync(
      "/usr/bin/plutil",
      ["-extract", "CFBundleIdentifier", "raw", "-o", "-", infoPlistPath],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000 }
    );
    return output.trim() || null;
  } catch {
    return null;
  }
}

export function macosAppAllowedIdentities(app: string): string[] {
  const identities = new Set<string>([app]);

  if (looksLikeMacosAppPath(app)) {
    const normalizedPath = normalizeAppPath(app);
    identities.add(trimTrailingPathSeparators(app));
    identities.add(normalizedPath);

    const bundleName = path.basename(normalizedPath).replace(/\.app$/i, "");
    if (bundleName) {
      identities.add(bundleName);
    }

    const bundleId = readBundleIdentifier(app);
    if (bundleId) {
      identities.add(bundleId);
    }
  }

  return [...identities];
}

/**
 * Native scope guardrail: if `allowedApps` is non-empty it must include an
 * accepted identity for the target app: bundle id, app bundle name, or `.app`
 * path. An empty list means the scope is unset and the target app is implicitly
 * allowed — mirroring how allowedDomains auto-includes the web target's host.
 */
export function assertTargetAppAllowed(allowedApps: string[], app: string): void {
  if (allowedApps.length === 0) {
    return;
  }
  const allowedIdentities = new Set(allowedApps.flatMap((allowedApp) => macosAppAllowedIdentities(allowedApp)));
  if (macosAppAllowedIdentities(app).some((identity) => allowedIdentities.has(identity))) {
    return;
  }
  throw new Error(
    `Target app "${app}" is not in guardrails.allowedApps (${allowedApps.join(", ")}).`
  );
}
