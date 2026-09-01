/**
 * PROWL-074 / PROWL-052 — download, verify, and install the prebuilt, signed
 * `prowl-macdriver` helper so the macOS target works from a plain
 * `npm i -g prowl-tools` with no Xcode or Swift toolchain.
 *
 * `prowl macdriver install` fetches the pinned version's universal binary from
 * GitHub Releases (raw `fetch`, redirects followed — no SDK), checksum-verifies
 * it against the released `.sha256` sidecar, validates the archive contents,
 * verifies the code signature / Gatekeeper policy, and installs it to
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
  MACDRIVER_SIGNING_AUTHORITY_PREFIX,
  MACDRIVER_SIGNING_IDENTIFIER,
  macdriverAssetName,
  macdriverAssetUrl,
  macdriverChecksumName,
  macdriverInstallRoot,
  macdriverInstalledBinary,
  macdriverReleaseTag,
  macdriverVersionDir,
  validateMacdriverVersion
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

/** Lists the raw path entries in a downloaded zip before extraction. */
export type ArchiveLister = (zipPath: string) => Promise<string[]>;

/** Verifies the code signature of an installed binary; throws if invalid. */
export type SignatureVerifier = (binaryPath: string) => Promise<void>;

export interface CommandResult {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

export type CommandRunner = (file: string, args: string[]) => Promise<CommandResult>;

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

const commandRunner: CommandRunner = async (file, args) => execFileAsync(file, args) as Promise<CommandResult>;

function commandOutput(result: CommandResult): string {
  return [result.stdout, result.stderr]
    .filter((value): value is string | Buffer => value !== undefined)
    .map((value) => value.toString())
    .join("\n")
    .trim();
}

function commandErrorDetail(error: unknown): string {
  const err = error as NodeJS.ErrnoException & { stdout?: string | Buffer; stderr?: string | Buffer };
  return [err.stderr, err.stdout, err.message]
    .filter((value): value is string | Buffer => value !== undefined && value !== "")
    .map((value) => value.toString())
    .join("\n")
    .trim();
}

async function runRequiredCommand(
  run: CommandRunner,
  binaryPath: string,
  command: string,
  args: string[],
  label: string
): Promise<CommandResult> {
  try {
    return await run(command, args);
  } catch (error) {
    const detail = commandErrorDetail(error);
    throw new Error(`${label} failed for ${binaryPath}${detail ? `: ${detail}` : ""}`);
  }
}

/** Default archive lister: `zipinfo -1`, used before any extraction happens. */
export const zipinfoArchiveLister: ArchiveLister = async (zipPath) => {
  try {
    const { stdout } = await execFileAsync("zipinfo", ["-1", zipPath]);
    return stdout
      .toString()
      .split(/\r?\n/)
      .filter((entry) => entry.length > 0);
  } catch (error) {
    const detail = commandErrorDetail(error);
    throw new Error(`Failed to inspect release archive ${zipPath} with zipinfo${detail ? `: ${detail}` : ""}`);
  }
};

function normalizeArchiveEntryName(entry: string): string {
  if (entry.length === 0 || entry !== entry.trim() || entry.includes("\0") || entry.includes("\\")) {
    throw new Error(`Unsafe path in prowl-macdriver release archive: ${JSON.stringify(entry)}`);
  }
  if (entry.endsWith("/")) {
    throw new Error(`Unexpected directory in prowl-macdriver release archive: ${entry}`);
  }
  if (path.posix.isAbsolute(entry)) {
    throw new Error(`Unsafe absolute path in prowl-macdriver release archive: ${entry}`);
  }
  const parts = entry.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Unsafe path in prowl-macdriver release archive: ${entry}`);
  }
  return entry;
}

/** Validate the zip member list before extraction. */
export function validateMacdriverArchiveEntries(entries: string[]): void {
  const normalized = entries.map(normalizeArchiveEntryName);
  if (normalized.length !== 1 || normalized[0] !== HELPER_BINARY) {
    const shown = normalized.length > 0 ? normalized.join(", ") : "(empty archive)";
    throw new Error(
      `Unexpected prowl-macdriver release archive contents: ${shown}. ` +
        `Expected exactly "${HELPER_BINARY}" at the archive root.`
    );
  }
}

/** Default extractor: Apple's `ditto`, which preserves the code signature. */
export const dittoExtractor: Extractor = async (zipPath, destDir) => {
  await execFileAsync("ditto", ["-x", "-k", zipPath, destDir]);
};

export interface CodesignDetails {
  identifier: string | null;
  authorities: string[];
  teamIdentifier: string | null;
}

export function parseCodesignDetails(text: string): CodesignDetails {
  const details: CodesignDetails = { identifier: null, authorities: [], teamIdentifier: null };
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("Identifier=")) {
      details.identifier = trimmed.slice("Identifier=".length);
    } else if (trimmed.startsWith("Authority=")) {
      details.authorities.push(trimmed.slice("Authority=".length));
    } else if (trimmed.startsWith("TeamIdentifier=")) {
      details.teamIdentifier = trimmed.slice("TeamIdentifier=".length);
    }
  }
  return details;
}

function validateCodesignDetails(details: CodesignDetails, binaryPath: string): void {
  if (details.identifier !== MACDRIVER_SIGNING_IDENTIFIER) {
    throw new Error(
      `codesign verification failed for ${binaryPath}: expected identifier ` +
        `"${MACDRIVER_SIGNING_IDENTIFIER}", got "${details.identifier ?? "missing"}"`
    );
  }

  const developerIdAuthority = details.authorities.find((authority) =>
    authority.startsWith(`${MACDRIVER_SIGNING_AUTHORITY_PREFIX} (`)
  );
  const authorityTeamId = developerIdAuthority?.match(/\(([A-Z0-9]{10})\)$/)?.[1] ?? null;
  if (!developerIdAuthority || !authorityTeamId) {
    const shown = details.authorities.length > 0 ? details.authorities.join(" / ") : "missing";
    throw new Error(
      `codesign verification failed for ${binaryPath}: expected ${MACDRIVER_SIGNING_AUTHORITY_PREFIX} signer, got ${shown}`
    );
  }

  if (!details.teamIdentifier) {
    throw new Error(`codesign verification failed for ${binaryPath}: missing TeamIdentifier`);
  }
  if (details.teamIdentifier !== authorityTeamId) {
    throw new Error(
      `codesign verification failed for ${binaryPath}: TeamIdentifier ${details.teamIdentifier} ` +
        `does not match Developer ID authority team ${authorityTeamId}`
    );
  }
}

export async function verifyMacdriverSignature(
  binaryPath: string,
  run: CommandRunner = commandRunner
): Promise<void> {
  await runRequiredCommand(run, binaryPath, "codesign", ["--verify", "--strict", binaryPath], "codesign verification");
  const display = await runRequiredCommand(
    run,
    binaryPath,
    "codesign",
    ["--display", "--verbose=4", binaryPath],
    "codesign detail inspection"
  );
  validateCodesignDetails(parseCodesignDetails(commandOutput(display)), binaryPath);
  await runRequiredCommand(
    run,
    binaryPath,
    "spctl",
    ["--assess", "--type", "execute", "--verbose=4", binaryPath],
    "spctl assessment"
  );
}

/**
 * Default signature verifier: fail closed unless `codesign` verifies the
 * signature, the identity matches the release contract, and Gatekeeper accepts
 * the executable through `spctl --assess --type execute`.
 */
export const codesignVerifier: SignatureVerifier = async (binaryPath) => {
  await verifyMacdriverSignature(binaryPath);
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
  listArchiveEntries?: ArchiveLister;
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
 * present and `force` is not set. The downloaded archive is inspected before
 * extraction, extracted into a temporary staging directory, and moved into place
 * only after the staged helper passes file and signature verification.
 */
export async function installMacdriver(options: InstallOptions = {}): Promise<InstallResult> {
  const version = validateMacdriverVersion(options.version ?? MACDRIVER_VERSION);
  const homedir = options.homedir ?? os.homedir();
  const listArchiveEntries = options.listArchiveEntries ?? zipinfoArchiveLister;
  const extract = options.extract ?? dittoExtractor;
  const verifySignature = options.verifySignature ?? codesignVerifier;

  const installRoot = macdriverInstallRoot(homedir);
  const versionDir = macdriverVersionDir(version, homedir);
  const binaryPath = macdriverInstalledBinary(version, homedir);

  if (!options.force && fs.existsSync(binaryPath)) {
    return { version, binaryPath, alreadyInstalled: true };
  }

  const zipBytes = await downloadAndVerify({ version, fetchImpl: options.fetchImpl });

  fs.mkdirSync(installRoot, { recursive: true });
  const stagingDir = fs.mkdtempSync(path.join(installRoot, `.tmp-${version}-`));
  const extractDir = path.join(stagingDir, "extract");
  const zipPath = path.join(stagingDir, macdriverAssetName(version));
  try {
    fs.mkdirSync(extractDir);
    fs.writeFileSync(zipPath, zipBytes);
    validateMacdriverArchiveEntries(await listArchiveEntries(zipPath));
    await extract(zipPath, extractDir);

    const stagedBinaryPath = path.join(extractDir, HELPER_BINARY);
    assertExtractedHelper(extractDir, stagedBinaryPath);
    fs.chmodSync(stagedBinaryPath, 0o755);
    await verifySignature(stagedBinaryPath);
    replaceVersionDir(versionDir, extractDir, installRoot);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }

  return { version, binaryPath, alreadyInstalled: false };
}

function assertExtractedHelper(extractDir: string, binaryPath: string): void {
  const entries = fs.readdirSync(extractDir);
  if (!entries.includes(HELPER_BINARY)) {
    throw new Error(`The release archive did not contain a "${HELPER_BINARY}" binary.`);
  }
  if (entries.length !== 1 || entries[0] !== HELPER_BINARY) {
    const shown = entries.length > 0 ? entries.join(", ") : "(empty directory)";
    throw new Error(
      `Unexpected extracted prowl-macdriver archive contents: ${shown}. ` +
        `Expected exactly "${HELPER_BINARY}".`
    );
  }
  let stat: fs.Stats | null = null;
  try {
    stat = fs.lstatSync(binaryPath);
  } catch {
    // The existence check below keeps the missing-helper error specific.
  }
  if (!stat?.isFile()) {
    throw new Error(`The release archive "${HELPER_BINARY}" entry is not a regular file.`);
  }
}

function replaceVersionDir(versionDir: string, stagedVersionDir: string, installRoot: string): void {
  const backupDir = path.join(installRoot, `.previous-${path.basename(versionDir)}-${process.pid}-${Date.now()}`);
  let backedUp = false;
  try {
    if (fs.existsSync(versionDir)) {
      fs.renameSync(versionDir, backupDir);
      backedUp = true;
    }
    fs.renameSync(stagedVersionDir, versionDir);
    if (backedUp) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (backedUp && !fs.existsSync(versionDir) && fs.existsSync(backupDir)) {
      fs.renameSync(backupDir, versionDir);
    }
    throw error;
  }
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
      let binaryPath: string;
      try {
        binaryPath = macdriverInstalledBinary(entry.name, homedir);
      } catch {
        continue;
      }
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
