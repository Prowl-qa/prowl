/**
 * PROWL-074 / PROWL-052 — download, verify, and install the prebuilt, signed
 * `prowl-macdriver` helper so the macOS target works from a plain
 * `npm i -g prowl-tools` with no Xcode or Swift toolchain.
 *
 * `prowl macdriver install` fetches the pinned version's universal binary from
 * GitHub Releases (raw `fetch`, redirects followed — no SDK), checksum-verifies
 * it against the released `.sha256` sidecar, optionally verifies the code
 * signature, and installs it to
 * `~/.prowl/macdriver/<version>/prowl-macdriver` (mode 0755).
 *
 * Every side effect (network, unzip, signature check, home dir) is injectable so
 * the flow is unit-testable without a real download or a signed artifact.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { HELPER_BINARY, resolveHelperBinary } from "./mac-helper.js";
import {
  MACDRIVER_VERSION,
  macdriverAssetName,
  macdriverAssetUrl,
  macdriverChecksumName,
  macdriverInstallRoot,
  macdriverInstalledBinary,
  macdriverReleaseTag,
  macdriverVersionDir
} from "./macdriver-release.js";

const execFileAsync = promisify(execFile);

/** Minimal shape of the `fetch` responses this module consumes. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

/** A `fetch`-like function; the real global `fetch` satisfies it. */
export type FetchLike = (
  url: string,
  init?: { redirect?: "follow" | "error" | "manual" }
) => Promise<FetchResponseLike>;

/** Extracts the binary out of a downloaded zip into `destDir`. */
export type Extractor = (zipPath: string, destDir: string) => Promise<void>;

/** Verifies the code signature of an installed binary; throws if invalid. */
export type SignatureVerifier = (binaryPath: string) => Promise<void>;

/** Parse the hex digest out of a `shasum`-style `.sha256` file. */
export function parseChecksumFile(text: string): string {
  const token = text.trim().split(/\s+/, 1)[0] ?? "";
  const digest = token.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error(`Malformed .sha256 checksum file (expected a 64-char hex digest, got: ${text.trim().slice(0, 80)})`);
  }
  return digest;
}

/** SHA-256 of a buffer, lowercase hex. */
export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Default extractor: Apple's `ditto`, which preserves the code signature. */
export const dittoExtractor: Extractor = async (zipPath, destDir) => {
  await execFileAsync("ditto", ["-x", "-k", zipPath, destDir]);
};

/**
 * Default signature verifier: `codesign --verify --strict`. If `codesign` is
 * unavailable (non-macOS/dev box), the check is skipped rather than failing the
 * install — the checksum is still enforced.
 */
export const codesignVerifier: SignatureVerifier = async (binaryPath) => {
  try {
    await execFileAsync("codesign", ["--verify", "--strict", binaryPath]);
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT") {
      return; // codesign not present — skip, checksum already gates integrity
    }
    const detail = (err.stderr ?? err.message ?? "").toString().trim();
    throw new Error(`codesign verification failed for ${binaryPath}${detail ? `: ${detail}` : ""}`);
  }
};

export interface DownloadOptions {
  version?: string;
  fetchImpl?: FetchLike;
}

/**
 * Download the pinned release's universal-binary zip and verify its SHA-256
 * against the released `.sha256` sidecar. Returns the verified zip bytes.
 * Throws a clear, actionable error on a 404 (no release cut yet) or a checksum
 * mismatch.
 */
export async function downloadAndVerify(options: DownloadOptions = {}): Promise<Buffer> {
  const version = options.version ?? MACDRIVER_VERSION;
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);

  const assetName = macdriverAssetName(version);
  const zipUrl = macdriverAssetUrl(assetName, version);
  const sumUrl = macdriverAssetUrl(macdriverChecksumName(version), version);

  const [zipRes, sumRes] = await Promise.all([
    fetchImpl(zipUrl, { redirect: "follow" }),
    fetchImpl(sumUrl, { redirect: "follow" })
  ]);

  if (zipRes.status === 404 || sumRes.status === 404) {
    throw new Error(
      `No published prowl-macdriver release for ${macdriverReleaseTag(version)} yet.\n` +
        "The signed binary is cut by the maintainer; until then build from source:\n" +
        "  cd macdriver && swift build -c release"
    );
  }
  if (!zipRes.ok) {
    throw new Error(`Failed to download ${assetName} (HTTP ${zipRes.status}) from ${zipUrl}`);
  }
  if (!sumRes.ok) {
    throw new Error(`Failed to download the checksum (HTTP ${sumRes.status}) from ${sumUrl}`);
  }

  const zipBytes = Buffer.from(await zipRes.arrayBuffer());
  const expected = parseChecksumFile(await sumRes.text());
  const actual = sha256Hex(zipBytes);
  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${assetName}.\n  expected: ${expected}\n  actual:   ${actual}\n` +
        "The download was rejected and discarded; re-run the install, and report it if it repeats."
    );
  }
  return zipBytes;
}

export interface InstallOptions {
  version?: string;
  force?: boolean;
  homedir?: string;
  fetchImpl?: FetchLike;
  extract?: Extractor;
  verifySignature?: SignatureVerifier;
}

export interface InstallResult {
  version: string;
  binaryPath: string;
  alreadyInstalled: boolean;
}

/**
 * Install the pinned helper to `~/.prowl/macdriver/<version>/prowl-macdriver`
 * (0755). Returns `alreadyInstalled: true` (a no-op) when the binary is already
 * present and `force` is not set. On any failure after download the partial
 * version directory is cleaned up so a retry starts fresh.
 */
export async function installMacdriver(options: InstallOptions = {}): Promise<InstallResult> {
  const version = options.version ?? MACDRIVER_VERSION;
  const homedir = options.homedir ?? os.homedir();
  const extract = options.extract ?? dittoExtractor;
  const verifySignature = options.verifySignature ?? codesignVerifier;

  const versionDir = macdriverVersionDir(version, homedir);
  const binaryPath = macdriverInstalledBinary(version, homedir);

  if (!options.force && fs.existsSync(binaryPath)) {
    return { version, binaryPath, alreadyInstalled: true };
  }

  const zipBytes = await downloadAndVerify({ version, fetchImpl: options.fetchImpl });

  // Stage the zip in a private temp dir, extract straight into a clean version
  // dir. On any failure the version dir is removed so a retry starts fresh and
  // resolveHelperBinary never trips over a half-written binary.
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), `prowl-macdriver-${version}-`));
  const zipPath = path.join(stagingDir, macdriverAssetName(version));
  try {
    fs.rmSync(versionDir, { recursive: true, force: true });
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(zipPath, zipBytes);
    await extract(zipPath, versionDir);

    if (!fs.existsSync(binaryPath)) {
      throw new Error(`The release archive did not contain a "${HELPER_BINARY}" binary.`);
    }
    fs.chmodSync(binaryPath, 0o755);
    await verifySignature(binaryPath);
  } catch (error) {
    fs.rmSync(versionDir, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }

  return { version, binaryPath, alreadyInstalled: false };
}

export interface InstalledVersion {
  version: string;
  binaryPath: string;
}

export interface MacdriverStatus {
  /** The binary Prowl would use now, and how it was found. */
  resolved: { path: string; source: "env" | "user-install" | "source-build" } | null;
  /** The pinned version the CLI targets. */
  pinnedVersion: string;
  /** All versions found under `~/.prowl/macdriver/`. */
  installed: InstalledVersion[];
  /** Version string the resolved binary reports, or null if it couldn't run. */
  probedVersion: string | null;
}

/** Probe a helper binary's `version` output; null if it can't be run/parsed. */
export type VersionProbe = (binaryPath: string) => Promise<string | null>;

/** Default probe: run `<binary> version` and parse the `prowl-macdriver X.Y.Z` line. */
export const runVersionProbe: VersionProbe = async (binaryPath) => {
  try {
    const { stdout } = await execFileAsync(binaryPath, ["version"], { timeout: 5000 });
    const match = stdout.match(/prowl-macdriver\s+(\S+)/);
    return match ? match[1] : stdout.trim() || null;
  } catch {
    return null;
  }
};

export interface StatusOptions {
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  probe?: VersionProbe;
}

/**
 * Gather the state `prowl macdriver status` reports: the resolved binary and
 * how it was found, every installed version, and the resolved binary's probed
 * version. Pure aside from filesystem reads and the (injectable) probe.
 */
export async function collectMacdriverStatus(options: StatusOptions = {}): Promise<MacdriverStatus> {
  const env = options.env ?? process.env;
  const homedir = options.homedir ?? os.homedir();
  const probe = options.probe ?? runVersionProbe;

  let resolved: MacdriverStatus["resolved"] = null;
  try {
    const resolvedPath = resolveHelperBinary(env, { homedir });
    resolved = { path: resolvedPath, source: classifyResolvedSource(resolvedPath, env, homedir) };
  } catch {
    resolved = null;
  }

  const installed: InstalledVersion[] = [];
  const root = macdriverInstallRoot(homedir);
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const binaryPath = macdriverInstalledBinary(entry.name, homedir);
      if (fs.existsSync(binaryPath)) {
        installed.push({ version: entry.name, binaryPath });
      }
    }
    installed.sort((a, b) => a.version.localeCompare(b.version));
  }

  const probedVersion = resolved ? await probe(resolved.path) : null;

  return { resolved, pinnedVersion: MACDRIVER_VERSION, installed, probedVersion };
}

function classifyResolvedSource(
  resolvedPath: string,
  env: NodeJS.ProcessEnv,
  homedir: string
): "env" | "user-install" | "source-build" {
  if (env.PROWL_MACDRIVER_BIN && resolvedPath === env.PROWL_MACDRIVER_BIN) {
    return "env";
  }
  if (resolvedPath.startsWith(macdriverInstallRoot(homedir) + path.sep)) {
    return "user-install";
  }
  return "source-build";
}

/** Static TCC-permission guidance printed after install / in status. */
export function tccGuidance(): string {
  return (
    "macOS permissions: the app that hosts Prowl (your terminal — Terminal, iTerm, VS Code, …)\n" +
    "must be granted, in System Settings → Privacy & Security:\n" +
    "  • Accessibility — required to drive the target app\n" +
    "  • Screen Recording — required for screenshots / visual baselines\n" +
    "Grant both to the terminal app, not to prowl-macdriver itself, then re-run your hunt."
  );
}
