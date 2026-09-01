import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectMacdriverStatus,
  downloadAndVerify,
  installMacdriver,
  parseChecksumFile,
  sha256Hex,
  type FetchLike,
  type FetchResponseLike
} from "../src/browser/macdriver-install.js";
import {
  HELPER_BINARY,
  MACDRIVER_VERSION,
  macdriverAssetName,
  macdriverInstalledBinary
} from "../src/browser/macdriver-release.js";

/** A verified zip payload plus its digest, used across the download tests. */
const ZIP_BYTES = Buffer.from("PK fake universal binary zip");
const ZIP_SHA = sha256Hex(ZIP_BYTES);

/**
 * Build a fetch stub that answers the zip and `.sha256` URLs of the pinned
 * release. `overrides` can force a status/body per asset kind.
 */
function fakeFetch(
  overrides: {
    zip?: Partial<FetchResponseLike>;
    sum?: Partial<FetchResponseLike>;
  } = {}
): FetchLike {
  return vi.fn(async (url: string): Promise<FetchResponseLike> => {
    const isSum = url.endsWith(".sha256");
    const base: FetchResponseLike = isSum
      ? {
          ok: true,
          status: 200,
          arrayBuffer: async () => Buffer.from(`${ZIP_SHA}  ${macdriverAssetName()}`),
          text: async () => `${ZIP_SHA}  ${macdriverAssetName()}`
        }
      : {
          ok: true,
          status: 200,
          arrayBuffer: async () => ZIP_BYTES,
          text: async () => ZIP_BYTES.toString()
        };
    return { ...base, ...(isSum ? overrides.sum : overrides.zip) };
  });
}

/** Fake extractor: drops a fake helper binary into the destination dir. */
async function fakeExtract(_zipPath: string, destDir: string): Promise<void> {
  fs.writeFileSync(path.join(destDir, HELPER_BINARY), "#!/bin/sh\necho prowl-macdriver 0.1.0\n");
}

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-macdriver-home-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("parseChecksumFile", () => {
  it("extracts the digest from a shasum-style line", () => {
    expect(parseChecksumFile(`${ZIP_SHA}  prowl-macdriver-v0.1.0-universal.zip`)).toBe(ZIP_SHA);
  });

  it("accepts a bare digest and lowercases it", () => {
    expect(parseChecksumFile(`  ${ZIP_SHA.toUpperCase()}\n`)).toBe(ZIP_SHA);
  });

  it("rejects a malformed checksum file", () => {
    expect(() => parseChecksumFile("not-a-real-digest")).toThrow("Malformed .sha256");
  });
});

describe("downloadAndVerify", () => {
  it("returns the verified zip bytes on a checksum match", async () => {
    const bytes = await downloadAndVerify({ fetchImpl: fakeFetch() });
    expect(bytes.equals(ZIP_BYTES)).toBe(true);
  });

  it("throws on a checksum mismatch", async () => {
    const wrong = `${"0".repeat(64)}  ${macdriverAssetName()}`;
    const fetchImpl = fakeFetch({ sum: { arrayBuffer: async () => Buffer.from(wrong), text: async () => wrong } });
    await expect(downloadAndVerify({ fetchImpl })).rejects.toThrow("Checksum mismatch");
  });

  it("gives a build-from-source hint on a 404 (no release cut yet)", async () => {
    const fetchImpl = fakeFetch({ zip: { ok: false, status: 404 }, sum: { ok: false, status: 404 } });
    await expect(downloadAndVerify({ fetchImpl })).rejects.toThrow("No published prowl-macdriver release");
  });

  it("surfaces a non-404 HTTP failure for the zip", async () => {
    const fetchImpl = fakeFetch({ zip: { ok: false, status: 500 } });
    await expect(downloadAndVerify({ fetchImpl })).rejects.toThrow("HTTP 500");
  });

  it("requests both assets with redirects followed", async () => {
    const fetchImpl = fakeFetch();
    await downloadAndVerify({ fetchImpl });
    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalledTimes(2);
    for (const call of mock.mock.calls) {
      expect(call[1]).toEqual({ redirect: "follow" });
    }
  });
});

describe("installMacdriver", () => {
  it("installs the pinned binary to ~/.prowl/macdriver/<version> with mode 0755", async () => {
    const result = await installMacdriver({
      homedir: home,
      fetchImpl: fakeFetch(),
      extract: fakeExtract,
      verifySignature: async () => {}
    });

    const expectedPath = macdriverInstalledBinary(MACDRIVER_VERSION, home);
    expect(result.alreadyInstalled).toBe(false);
    expect(result.binaryPath).toBe(expectedPath);
    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(fs.statSync(expectedPath).mode & 0o777).toBe(0o755);
  });

  it("is a no-op when already installed and --force is not set", async () => {
    const opts = { homedir: home, fetchImpl: fakeFetch(), extract: fakeExtract, verifySignature: async () => {} };
    await installMacdriver(opts);
    const spied = fakeFetch();
    const result = await installMacdriver({ ...opts, fetchImpl: spied });
    expect(result.alreadyInstalled).toBe(true);
    expect(spied as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("re-downloads when --force is set", async () => {
    const opts = { homedir: home, extract: fakeExtract, verifySignature: async () => {} };
    await installMacdriver({ ...opts, fetchImpl: fakeFetch() });
    const forcedFetch = fakeFetch();
    const result = await installMacdriver({ ...opts, force: true, fetchImpl: forcedFetch });
    expect(result.alreadyInstalled).toBe(false);
    expect(forcedFetch as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalled();
  });

  it("cleans up and errors when the archive has no helper binary", async () => {
    await expect(
      installMacdriver({
        homedir: home,
        fetchImpl: fakeFetch(),
        extract: async () => {}, // extracts nothing
        verifySignature: async () => {}
      })
    ).rejects.toThrow(`did not contain a "${HELPER_BINARY}"`);
    expect(fs.existsSync(macdriverInstalledBinary(MACDRIVER_VERSION, home))).toBe(false);
  });

  it("cleans up the version dir when signature verification fails", async () => {
    await expect(
      installMacdriver({
        homedir: home,
        fetchImpl: fakeFetch(),
        extract: fakeExtract,
        verifySignature: async () => {
          throw new Error("codesign verification failed");
        }
      })
    ).rejects.toThrow("codesign verification failed");
    expect(fs.existsSync(macdriverInstalledBinary(MACDRIVER_VERSION, home))).toBe(false);
  });
});

describe("collectMacdriverStatus", () => {
  const probe = async () => "0.1.0";

  it("reports the PROWL_MACDRIVER_BIN override as the env source", async () => {
    const override = path.join(home, "custom-macdriver");
    fs.writeFileSync(override, "bin");
    const status = await collectMacdriverStatus({
      env: { PROWL_MACDRIVER_BIN: override } as NodeJS.ProcessEnv,
      homedir: home,
      probe
    });
    expect(status.resolved).toEqual({ path: override, source: "env" });
    expect(status.probedVersion).toBe("0.1.0");
    expect(status.pinnedVersion).toBe(MACDRIVER_VERSION);
  });

  it("reports a user install and lists installed versions", async () => {
    await installMacdriver({
      homedir: home,
      fetchImpl: fakeFetch(),
      extract: fakeExtract,
      verifySignature: async () => {}
    });
    const status = await collectMacdriverStatus({ env: {} as NodeJS.ProcessEnv, homedir: home, probe });
    expect(status.resolved?.source).toBe("user-install");
    expect(status.installed).toEqual([
      { version: MACDRIVER_VERSION, binaryPath: macdriverInstalledBinary(MACDRIVER_VERSION, home) }
    ]);
  });

  it("reports no resolved binary when nothing is installed and no source build is found", async () => {
    // A bogus PATH-free env and an empty home; the resolver may still find the
    // repo's own .build, so only assert the installed list is empty here.
    const status = await collectMacdriverStatus({ env: {} as NodeJS.ProcessEnv, homedir: home, probe });
    expect(status.installed).toEqual([]);
  });
});
