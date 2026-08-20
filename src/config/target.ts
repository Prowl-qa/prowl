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

/** Human-facing label for a native (non-web) target, used in error messages. */
function nativeTargetLabel(target: Target["type"]): string {
  if (target === "android") {
    return "Android";
  }
  if (target === "ios") {
    return "iOS";
  }
  return "macOS";
}

/**
 * Throw if any step in `steps` (recursing into `if`/`repeat` bodies) is not
 * supported by `target`. `runHunt` references are validated when the referenced
 * hunt itself runs. No-op for the web target; every native target (macOS,
 * Android, iOS) rejects the same web-only step vocabulary.
 */
export function assertStepsSupportedByTarget(steps: Step[], target: Target["type"]): void {
  if (target === "web") {
    return;
  }
  const label = nativeTargetLabel(target);
  for (const step of steps) {
    const reason = webOnlyReason(step);
    if (reason) {
      throw new Error(
        `Step "${reason}" is not supported by the ${label} target. It is web-only; ` +
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
  if (target === "web" || !assertions || assertions.length === 0) {
    return;
  }
  throw new Error(
    `Hunt-level assertions are not supported by the ${nativeTargetLabel(target)} target. ` +
      "Use inline assert visible/notVisible steps instead."
  );
}

function trimTrailingPathSeparators(value: string): string {
  return value.replace(/[\\/]+$/g, "");
}

function looksLikeAppBundlePath(app: string): boolean {
  const trimmed = trimTrailingPathSeparators(app);
  return trimmed.includes("/") || trimmed.toLowerCase().endsWith(".app");
}

/**
 * Whether an iOS `target.app` value is a `.app` bundle path rather than a bundle
 * id. iOS bundle ids commonly end in `.app`/`.App` (e.g. `com.company.app`), which
 * the macOS heuristic would misclassify, so a bare `*.app` value counts as a path
 * only when it actually exists on disk as a directory. A path separator is always
 * decisive.
 */
export function looksLikeIosAppPath(app: string): boolean {
  const trimmed = trimTrailingPathSeparators(app);
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return true;
  }
  if (trimmed.toLowerCase().endsWith(".app")) {
    try {
      return fs.statSync(normalizeAppPath(app)).isDirectory();
    } catch {
      return false;
    }
  }
  return false;
}

function normalizeAppPath(app: string): string {
  return path.resolve(trimTrailingPathSeparators(app));
}

function parseBundleIdentifier(plist: string): string | null {
  const match = /<key>\s*CFBundleIdentifier\s*<\/key>\s*<string>\s*([^<]+?)\s*<\/string>/s.exec(plist);
  return match?.[1]?.trim() || null;
}

/**
 * Read `CFBundleIdentifier` from an app bundle's `Info.plist`. macOS `.app`
 * bundles keep it under `Contents/`, while iOS simulator `.app` bundles keep it
 * at the bundle root, so `plistSubPath` names the plist's location within the
 * bundle. XML plists are parsed directly; binary plists fall back to `plutil`.
 */
function readBundleIdentifier(appPath: string, ...plistSubPath: string[]): string | null {
  const infoPlistPath = path.join(normalizeAppPath(appPath), ...plistSubPath);
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

/** Read the bundle id from a macOS `.app` (`Contents/Info.plist`), or null. */
export function readMacosBundleIdentifier(appPath: string): string | null {
  return readBundleIdentifier(appPath, "Contents", "Info.plist");
}

/** Read the bundle id from an iOS `.app` (root `Info.plist`), or null. */
export function readIosBundleIdentifier(appPath: string): string | null {
  return readBundleIdentifier(appPath, "Info.plist");
}

/**
 * Accepted identities for a native app-bundle target: the raw value, and for a
 * `.app` path also its trimmed/normalized path, bundle name, and
 * `CFBundleIdentifier`. `readBundleId` locates the plist per platform.
 */
function appBundleAllowedIdentities(
  app: string,
  readBundleId: (appPath: string) => string | null,
  isAppPath: (app: string) => boolean = looksLikeAppBundlePath
): string[] {
  const identities = new Set<string>([app]);

  if (isAppPath(app)) {
    const normalizedPath = normalizeAppPath(app);
    identities.add(trimTrailingPathSeparators(app));
    identities.add(normalizedPath);

    const bundleName = path.basename(normalizedPath).replace(/\.app$/i, "");
    if (bundleName) {
      identities.add(bundleName);
    }

    const bundleId = readBundleId(app);
    if (bundleId) {
      identities.add(bundleId);
    }
  }

  return [...identities];
}

export function macosAppAllowedIdentities(app: string): string[] {
  return appBundleAllowedIdentities(app, readMacosBundleIdentifier);
}

/**
 * Accepted identities for an iOS target app. A bare bundle id matches itself; a
 * `.app` path is authorized by its path, bundle name, or the `CFBundleIdentifier`
 * read from the bundle's root `Info.plist`.
 */
export function iosAppAllowedIdentities(app: string): string[] {
  return appBundleAllowedIdentities(app, readIosBundleIdentifier, looksLikeIosAppPath);
}

/**
 * Native scope guardrail: if `allowedApps` is non-empty it must include an
 * accepted identity for the target app: bundle id, app bundle name, or `.app`
 * path. An empty list means the scope is unset and the target app is implicitly
 * allowed — mirroring how allowedDomains auto-includes the web target's host.
 */
export function assertTargetAppAllowed(allowedApps: string[], app: string): void {
  assertNativeAppAllowed(allowedApps, app, macosAppAllowedIdentities);
}

/**
 * iOS scope guardrail (PROWL-059): mirrors {@link assertTargetAppAllowed} but
 * resolves identities via {@link iosAppAllowedIdentities} (bundle id or `.app`
 * path with the id read from the bundle's root `Info.plist`).
 */
export function assertIosAppAllowed(allowedApps: string[], app: string): void {
  assertNativeAppAllowed(allowedApps, app, iosAppAllowedIdentities);
}

function looksLikeApkPath(app: string): boolean {
  const trimmed = trimTrailingPathSeparators(app);
  return trimmed.includes("/") || trimmed.includes("\\") || trimmed.toLowerCase().endsWith(".apk");
}

function normalizeAndroidApkPath(app: string): string {
  const resolved = path.resolve(trimTrailingPathSeparators(app));
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Accepted identities for an Android target app. A bare package name matches
 * itself. An `.apk` path is authorized only by its canonical full path; pass the
 * resolved package name when validating an APK after `aapt` resolution so
 * package-ID allowlists can authorize it before install.
 */
export function androidAppAllowedIdentities(app: string, resolvedPackage?: string): string[] {
  if (looksLikeApkPath(app)) {
    return resolvedPackage
      ? [normalizeAndroidApkPath(app), resolvedPackage]
      : [normalizeAndroidApkPath(app)];
  }
  return [app];
}

/**
 * Android scope guardrail (PROWL-058): mirrors {@link assertTargetAppAllowed} but
 * resolves identities via {@link androidAppAllowedIdentities} (package name or
 * canonical APK path) rather than macOS bundle identities.
 */
export function assertAndroidAppAllowed(
  allowedApps: string[],
  app: string,
  resolvedPackage?: string
): void {
  assertNativeAppAllowed(
    allowedApps,
    app,
    (value) => androidAppAllowedIdentities(value, value === app ? resolvedPackage : undefined)
  );
}

function assertNativeAppAllowed(
  allowedApps: string[],
  app: string,
  resolveIdentities: (value: string) => string[]
): void {
  if (allowedApps.length === 0) {
    return;
  }
  const allowedIdentities = new Set(allowedApps.flatMap((allowedApp) => resolveIdentities(allowedApp)));
  if (resolveIdentities(app).some((identity) => allowedIdentities.has(identity))) {
    return;
  }
  throw new Error(
    `Target app "${app}" is not in guardrails.allowedApps (${allowedApps.join(", ")}).`
  );
}
