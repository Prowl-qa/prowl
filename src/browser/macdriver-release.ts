/**
 * PROWL-074 / PROWL-052 — release coordinates for the prebuilt, signed
 * `prowl-macdriver` helper.
 *
 * The CLI pins ONE helper version (`MACDRIVER_VERSION`) so a given CLI build
 * always fetches a known-good binary. To ship a new helper: bump the constant
 * here (and `macdriverVersion` in `macdriver/Sources/prowl-macdriver/DriverCLI.swift`),
 * then cut a matching `macdriver-v<version>` GitHub Release — the
 * `.github/workflows/macdriver-release.yml` workflow builds, signs, notarizes,
 * and attaches the assets named below. See `macdriver/RELEASING.md`.
 *
 * This module is pure (no IO), so `mac-helper.ts` and the installer can both
 * depend on it without a cycle.
 */
import os from "node:os";
import path from "node:path";

/** Basename of the helper executable, in the tarball and on disk. */
export const HELPER_BINARY = "prowl-macdriver";

/** Pinned helper version. A CLI release always installs this exact version. */
export const MACDRIVER_VERSION = "0.1.0";

/** GitHub `owner/repo` that hosts the helper releases. */
export const MACDRIVER_REPO = "prowl-tools/prowl";

/** Code-signing identifier assigned to release builds. */
export const MACDRIVER_SIGNING_IDENTIFIER = "tools.prowl.macdriver";

/** Developer ID Application common-name prefix expected on release builds. */
export const MACDRIVER_SIGNING_AUTHORITY_PREFIX = "Developer ID Application: Genkei Labs";

/** Accepted helper release version token. */
export const MACDRIVER_VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?(?:\+[0-9A-Za-z][0-9A-Za-z.-]*)?$/;

/** Validate the helper release version before using it in URLs or paths. */
export function validateMacdriverVersion(version: string): string {
  if (!MACDRIVER_VERSION_PATTERN.test(version)) {
    throw new Error(
      `Invalid prowl-macdriver version "${version}". Expected a release version like 0.1.0.`
    );
  }
  return version;
}

/** Git tag for a helper version — the release the workflow builds. */
export function macdriverReleaseTag(version: string = MACDRIVER_VERSION): string {
  return `macdriver-v${validateMacdriverVersion(version)}`;
}

/** Release asset file name for the universal (arm64 + x86_64) binary zip. */
export function macdriverAssetName(version: string = MACDRIVER_VERSION): string {
  return `prowl-macdriver-v${validateMacdriverVersion(version)}-universal.zip`;
}

/** Release asset file name for the SHA-256 checksum sidecar. */
export function macdriverChecksumName(version: string = MACDRIVER_VERSION): string {
  return `${macdriverAssetName(version)}.sha256`;
}

/** Download URL for a named asset of the pinned release (follows redirects). */
export function macdriverAssetUrl(assetName: string, version: string = MACDRIVER_VERSION): string {
  return `https://github.com/${MACDRIVER_REPO}/releases/download/${macdriverReleaseTag(version)}/${assetName}`;
}

/** Root of all user-level installs: `~/.prowl/macdriver`. */
export function macdriverInstallRoot(homedir: string = os.homedir()): string {
  return path.join(homedir, ".prowl", "macdriver");
}

/** Directory that holds a specific installed version. */
export function macdriverVersionDir(
  version: string = MACDRIVER_VERSION,
  homedir: string = os.homedir()
): string {
  const root = path.resolve(macdriverInstallRoot(homedir));
  const versionDir = path.resolve(root, validateMacdriverVersion(version));
  if (!versionDir.startsWith(root + path.sep)) {
    throw new Error(`Resolved prowl-macdriver version directory escaped install root: ${versionDir}`);
  }
  return versionDir;
}

/** Absolute path to the installed helper binary for a version. */
export function macdriverInstalledBinary(
  version: string = MACDRIVER_VERSION,
  homedir: string = os.homedir()
): string {
  return path.join(macdriverVersionDir(version, homedir), HELPER_BINARY);
}
