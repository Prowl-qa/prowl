import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectMacdriverStatus,
  downloadAndVerify,
  installMacdriver,
  parseChecksumFile,
  validateMacdriverArchiveEntries,
  verifyMacdriverSignature,
  sha256Hex,
  type CommandRunner,
  type FetchLike,
  type FetchResponseLike
} from "../src/browser/macdriver-install.js";
import {
  HELPER_BINARY,
  MACDRIVER_VERSION,
  MACDRIVER_SIGNING_AUTHORITY_PREFIX,
  MACDRIVER_SIGNING_IDENTIFIER,
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

async function trustedArchiveEntries(): Promise<string[]> {
  return [HELPER_BINARY];
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

describe("validateMacdriverArchiveEntries", () => {
  it("accepts the expected root helper binary", () => {
    expect(() => validateMacdriverArchiveEntries([HELPER_BINARY])).not.toThrow();
  });

  it("rejects traversal and unexpected entries", () => {
    expect(() => validateMacdriverArchiveEntries(["../owned"])).toThrow("Unsafe path");
    expect(() => validateMacdriverArchiveEntries([HELPER_BINARY, "__MACOSX/._prowl-macdriver"])).toThrow(
      "Unexpected prowl-macdriver release archive contents"
    );
  });
});

describe("verifyMacdriverSignature", () => {
  const binaryPath = "/tmp/prowl-macdriver";
  const validCodesignDetails =
    `Identifier=${MACDRIVER_SIGNING_IDENTIFIER}\n` +
    `Authority=${MACDRIVER_SIGNING_AUTHORITY_PREFIX} (ABC123DEFG)\n` +
    "Authority=Developer ID Certification Authority\n" +
    "Authority=Apple Root CA\n" +
    "TeamIdentifier=ABC123DEFG\n";

  it("requires codesign details and a successful Gatekeeper assessment", async () => {
    const calls: string[] = [];
    const run: CommandRunner = async (file, args) => {
      calls.push(`${file} ${args.join(" ")}`);
      if (file === "codesign" && args[0] === "--display") {
        return { stderr: validCodesignDetails };
      }
      return { stdout: "", stderr: "" };
    };

    await verifyMacdriverSignature(binaryPath, run);

    expect(calls).toEqual([
      `codesign --verify --strict ${binaryPath}`,
      `codesign --display --verbose=4 ${binaryPath}`,
      `spctl --assess --type execute --verbose=4 ${binaryPath}`
    ]);
  });

  it("rejects a binary signed by a different Developer ID authority", async () => {
    const run: CommandRunner = async (file, args) => {
      if (file === "codesign" && args[0] === "--display") {
        return {
          stderr:
            `Identifier=${MACDRIVER_SIGNING_IDENTIFIER}\n` +
            "Authority=Developer ID Application: Someone Else (ABC123DEFG)\n" +
            "TeamIdentifier=ABC123DEFG\n"
        };
      }
      return { stdout: "", stderr: "" };
    };

    await expect(verifyMacdriverSignature(binaryPath, run)).rejects.toThrow(
      `expected ${MACDRIVER_SIGNING_AUTHORITY_PREFIX} signer`
    );
  });

  it("rejects a TeamIdentifier that does not match the Developer ID authority", async () => {
    const run: CommandRunner = async (file, args) => {
      if (file === "codesign" && args[0] === "--display") {
        return {
          stderr:
            `Identifier=${MACDRIVER_SIGNING_IDENTIFIER}\n` +
            `Authority=${MACDRIVER_SIGNING_AUTHORITY_PREFIX} (ABC123DEFG)\n` +
            "TeamIdentifier=ZZZ9876543\n"
        };
      }
      return { stdout: "", stderr: "" };
    };

    await expect(verifyMacdriverSignature(binaryPath, run)).rejects.toThrow(
      "does not match Developer ID authority team"
    );
  });

  it("rejects a failed Gatekeeper policy assessment", async () => {
    const run: CommandRunner = async (file, args) => {
      if (file === "codesign" && args[0] === "--display") {
        return { stderr: validCodesignDetails };
      }
      if (file === "spctl") {
        throw Object.assign(new Error("rejected"), { stderr: "source=Unnotarized Developer ID" });
      }
      return { stdout: "", stderr: "" };
    };

    await expect(verifyMacdriverSignature(binaryPath, run)).rejects.toThrow("spctl assessment failed");
  });

  it("fails closed when a required verification command cannot run", async () => {
    const run: CommandRunner = async (file) => {
      throw Object.assign(new Error(`spawn ${file} ENOENT`), { code: "ENOENT" });
    };

    await expect(verifyMacdriverSignature(binaryPath, run)).rejects.toThrow("codesign verification failed");
  });
});

describe("installMacdriver", () => {
  it("installs the pinned binary to ~/.prowl/macdriver/<version> with mode 0755", async () => {
    const result = await installMacdriver({
      homedir: home,
      fetchImpl: fakeFetch(),
      listArchiveEntries: trustedArchiveEntries,
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
    const opts = {
      homedir: home,
      fetchImpl: fakeFetch(),
      listArchiveEntries: trustedArchiveEntries,
      extract: fakeExtract,
      verifySignature: async () => {}
    };
    await installMacdriver(opts);
    const spied = fakeFetch();
    const result = await installMacdriver({ ...opts, fetchImpl: spied });
    expect(result.alreadyInstalled).toBe(true);
    expect(spied as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("re-downloads when --force is set", async () => {
    const opts = { homedir: home, listArchiveEntries: trustedArchiveEntries, extract: fakeExtract, verifySignature: async () => {} };
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
        listArchiveEntries: trustedArchiveEntries,
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
        listArchiveEntries: trustedArchiveEntries,
        extract: fakeExtract,
        verifySignature: async () => {
          throw new Error("codesign verification failed");
        }
      })
    ).rejects.toThrow("codesign verification failed");
    expect(fs.existsSync(macdriverInstalledBinary(MACDRIVER_VERSION, home))).toBe(false);
  });

  it("rejects traversal version values before deleting anything outside the install root", async () => {
    const sentinelDir = path.join(home, ".prowl", "sentinel");
    const sentinel = path.join(sentinelDir, "keep.txt");
    fs.mkdirSync(sentinelDir, { recursive: true });
    fs.writeFileSync(sentinel, "do not delete");

    const fetchImpl = fakeFetch();
    await expect(
      installMacdriver({
        version: "../sentinel",
        homedir: home,
        fetchImpl,
        listArchiveEntries: trustedArchiveEntries,
        extract: fakeExtract,
        verifySignature: async () => {}
      })
    ).rejects.toThrow("Invalid prowl-macdriver version");
    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(fs.readFileSync(sentinel, "utf8")).toBe("do not delete");
  });

  it("rejects traversal archive entries before extraction", async () => {
    const extract = vi.fn(fakeExtract);
    await expect(
      installMacdriver({
        homedir: home,
        fetchImpl: fakeFetch(),
        listArchiveEntries: async () => ["../owned"],
        extract,
        verifySignature: async () => {}
      })
    ).rejects.toThrow("Unsafe path");
    expect(extract).not.toHaveBeenCalled();
    expect(fs.existsSync(macdriverInstalledBinary(MACDRIVER_VERSION, home))).toBe(false);
  });

  it("rejects a helper entry that extracts as a symlink", async () => {
    const sentinel = path.join(home, "outside-helper");
    fs.writeFileSync(sentinel, "outside");

    await expect(
      installMacdriver({
        homedir: home,
        fetchImpl: fakeFetch(),
        listArchiveEntries: trustedArchiveEntries,
        extract: async (_zipPath, destDir) => {
          fs.symlinkSync(sentinel, path.join(destDir, HELPER_BINARY));
        },
        verifySignature: async () => {}
      })
    ).rejects.toThrow("not a regular file");
    expect(fs.readFileSync(sentinel, "utf8")).toBe("outside");
  });

  it("preserves an existing helper when a forced reinstall fails verification", async () => {
    const opts = {
      homedir: home,
      fetchImpl: fakeFetch(),
      listArchiveEntries: trustedArchiveEntries,
      extract: fakeExtract,
      verifySignature: async () => {}
    };
    await installMacdriver(opts);
    const binaryPath = macdriverInstalledBinary(MACDRIVER_VERSION, home);
    fs.writeFileSync(binaryPath, "existing helper");

    await expect(
      installMacdriver({
        ...opts,
        force: true,
        verifySignature: async () => {
          throw new Error("codesign verification failed");
        }
      })
    ).rejects.toThrow("codesign verification failed");
    expect(fs.readFileSync(binaryPath, "utf8")).toBe("existing helper");
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
      listArchiveEntries: trustedArchiveEntries,
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
    const existsSync = vi.spyOn(fs, "existsSync").mockReturnValue(false);
    try {
      const status = await collectMacdriverStatus({ env: {} as NodeJS.ProcessEnv, homedir: home, probe });
      expect(status.resolved).toBeNull();
      expect(status.probedVersion).toBeNull();
      expect(status.installed).toEqual([]);
    } finally {
      existsSync.mockRestore();
    }
  });
});
