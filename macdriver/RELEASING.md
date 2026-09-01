# Releasing `prowl-macdriver`

The macOS helper ships as a prebuilt, **signed and notarized** universal binary
attached to a GitHub Release. `prowl macdriver install` downloads the pinned
version, verifies its SHA-256, and installs it to
`~/.prowl/macdriver/<version>/prowl-macdriver` — no Xcode or Swift toolchain on
the user's machine.

Releases are cut by the `.github/workflows/macdriver-release.yml` workflow, which
triggers on a pushed tag matching `macdriver-v*` (e.g. `macdriver-v0.1.0`). This
runbook covers the **one-time secret provisioning** and the **per-release** flow.
Signing and notarization can only be exercised by the owner (they need the
Developer ID cert and notary credentials); CI is the only place they run.

## One-time: provision repo secrets

Add these as **Actions secrets** on `prowl-tools/prowl`
(`gh secret set <NAME> --repo prowl-tools/prowl`, run while logged in as the
`prowltools` account). The workflow fails fast with a clear error if any are
missing — it never ships an unsigned binary.

| Secret | What it is | How to get it |
|---|---|---|
| `MACOS_CERTIFICATE_P12` | Base64 of your **Developer ID Application** cert + private key, exported as `.p12` | In Keychain Access, export the "Developer ID Application: …" identity to `cert.p12`, then `base64 -i cert.p12 \| pbcopy` |
| `MACOS_CERTIFICATE_PASSWORD` | The password you set on that `.p12` export | — |
| `MACOS_SIGNING_IDENTITY` | The identity's common name | e.g. `Developer ID Application: Genkei Labs (TEAMID1234)` — from `security find-identity -v -p codesigning` |
| `NOTARY_API_KEY_ID` | App Store Connect API **Key ID** | App Store Connect → Users and Access → Integrations → App Store Connect API → generate a key (Developer role is enough for notarization) |
| `NOTARY_API_ISSUER_ID` | The API **Issuer ID** (UUID) | Same page, above the keys table |
| `NOTARY_API_KEY_P8_BASE64` | Base64 of the downloaded `AuthKey_<KeyID>.p8` | `base64 -i AuthKey_XXXX.p8 \| pbcopy` (the `.p8` downloads once — keep it in the vault) |

Notes:
- The **Developer ID Application** cert (not "Mac App Distribution") is the one
  that lets a binary run outside the App Store.
- The App Store Connect API key scheme is used instead of an Apple ID +
  app-specific password so there's no per-account 2FA to babysit.
- Store the raw `.p12` and `.p8` in the private vault, never in the repo.

## Per-release

1. **Bump the version in both places** (they must match):
   - `MACDRIVER_VERSION` in `src/browser/macdriver-release.ts`
   - `macdriverVersion` in `macdriver/Sources/prowl-macdriver/DriverCLI.swift`

   Start line is `0.1.0`. Commit on a branch and merge to `main` as usual (never
   commit the bump to `main` directly).

2. **Tag and push** from `main` at the merged commit:

   ```bash
   git tag macdriver-v0.1.0
   git push origin macdriver-v0.1.0     # via the github-prowl remote
   ```

   The workflow then, on a macOS runner: builds arm64 + x86_64, `lipo`s them into
   a universal binary, codesigns it (Developer ID, hardened runtime, secure
   timestamp), notarizes it with `notarytool --wait`, zips it as
   `prowl-macdriver-v<version>-universal.zip`, writes a `.sha256` sidecar, and
   creates the GitHub Release with both assets attached.

3. **Verify** (from the Actions run and/or locally):
   - The **Notarize** step must show `status: Accepted` from `notarytool`.
   - A bare executable **cannot be stapled** (`stapler` only handles
     `.app`/`.pkg`/`.dmg`). Gatekeeper checks the notarization ticket **online**
     at first launch. To confirm a build's ticket after the fact, use the
     submission id from the run:

     ```bash
     xcrun notarytool history --key AuthKey.p8 --key-id <ID> --issuer <ISSUER>
     xcrun notarytool log <submission-id> --key AuthKey.p8 --key-id <ID> --issuer <ISSUER>
     ```
   - Sanity-check the signature on the downloaded binary:
     `codesign --verify --strict --verbose=2 prowl-macdriver` and
     `spctl -a -vvv -t install prowl-macdriver` (or just run
     `prowl macdriver install` on a clean machine and confirm the app launches).

4. **Live-verify the two-minute install** on a fresh machine (or a clean user):

   ```bash
   npm i -g prowl-tools
   prowl macdriver install     # should download, checksum-verify, and install
   prowl macdriver status      # resolved via user install; runs: yes
   ```

## Bumping the CLI pin

The CLI always installs the version named by `MACDRIVER_VERSION`. Shipping a new
helper is therefore a two-step: cut the `macdriver-v<version>` release (above),
then release a CLI that pins the new `MACDRIVER_VERSION` (normal npm release —
see the repo `CLAUDE.md` release section). A CLI build never fetches a version it
wasn't pinned to, so old CLIs keep working against their own helper release.
