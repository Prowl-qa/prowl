# Changelog

All notable changes to Prowl will be documented in this file.

## [Unreleased]

### Documentation
- **README and npm metadata repositioned desktop-first.** The headline, intro,
  and first-screen examples now lead with native macOS apps (Accessibility API)
  and web apps (Playwright) from the same declarative YAML — a macOS example
  runs alongside the web one, and the macOS Target section moved up to just after
  Getting Started (it previously first surfaced as a commented-out config option
  far down the file). macOS stays labelled **experimental** and the setup notes
  stay honest that the driver still builds from source; the promotion to beta is
  gated on the two-minute signed-helper install (PROWL-074). Comparison claims
  are factual (Maestro is mobile/web, Playwright is web-only, XCUITest is
  Swift + Xcode). `package.json` `description` now describes E2E testing for
  native macOS and web apps, and `keywords` gain `macos`, `desktop-testing`, and
  `accessibility`. The stale "Community Hub" section (a retired-hub reference)
  was removed.
- **Corrected the README Getting Started walkthrough.** It claimed `prowl init`
  scaffolds 8 example hunts and had users edit `homepage.yml`; the real init
  writes `hello.yml` and `login-flow.yml`, and a hunt's identity is its file
  name. The flow now shows the real init tree/banner, runs `prowl run hello`
  first, then creates a new `smoke-test.yml` (filename = hunt identity).

### Changed
- **`prowl run`/`watch`/`history` now accept a literal hunt path, matching their
  help text.** A hunt's identity is its file name under `.prowl/hunts/`, but the
  argument help suggested paths the name validator then rejected (a leading
  `.prowl/hunts/` or a `.yml` extension failed with "Invalid hunt name"). The
  positional hunt argument is now normalized before validation — a leading
  `.prowl/hunts/` or `hunts/` prefix and a trailing `.yml`/`.yaml` extension are
  stripped — so `prowl run homepage`, `prowl run hunts/homepage.yml`, and
  `prowl run .prowl/hunts/homepage.yml` all resolve to the same hunt (nested
  hunts included: `.prowl/hunts/admin/users.yml` → `admin/users`). Input that is
  still invalid after normalization now fails with an error that spells out the
  accepted forms. Help text, error message, README, and behavior now agree.
- **`prowl init` no longer points at the retired Prowl Hub.** The post-init
  message now points at the bundled `login-flow.yml` starter instead of
  `hub.prowl.tools` (the community hub was retired 2026-08-26; starters ship
  inside the CLI).

### Added
- **`prowl init` now scaffolds a login starter hunt.** Alongside `hello.yml`,
  `prowl init` writes `login-flow.yml` — a commented, real-world auth example
  (email/password fill via label shorthand, `waitForUrl`, mid-flow + hunt-level
  assertions) that teaches secret handling (`.prowl/.env` + `{{VAR}}`
  interpolation with automatic redaction) and points at `prowl login` for
  capturing reusable auth state. It's a fill-in template (customize the URL and
  selectors for your app), giving new users a concrete pattern beyond the minimal
  smoke check. `hello.yml`'s stale community-hub link was removed.
- **Self-hosted Codex prowl-review workflows (#64).** This repo now runs
  subscription-backed (keyless Codex) prowl-review on the always-on Mac mini
  runner (labels `self-hosted, macOS, prowl-review`), so per-review marginal cost
  is $0.00 and no provider key is stored in GitHub — the ChatGPT login lives only
  on the runner. `.github/workflows/prowl-review.yml` auto-reviews PRs and
  `prowl-review-command.yml` handles `@prowl-review` chat/commands, both with
  `ai-provider: codex`, a 30-minute timeout, and the mandatory same-repo fork
  gate required on a public repo. Maintainer command runs keep non-cancelling
  per-PR concurrency. Review config lives in a root `.prowl-review.yml`
  (`provider: codex`, `model: gpt-5.5`, `codex.effort: low`) loaded from the
  trusted base branch, never PR code.
- **Single branded "Prowl Review" checks row (#64 branding follow-up).**
  `.github/workflows/prowl-review.yml` now chains off CI via `workflow_run`
  (`workflows: [CI], types: [completed]`, gated on a successful `pull_request`
  CI run) instead of triggering on `pull_request` directly, so no octocat
  `prowl-review / review` Actions row attaches to the PR — the only prowl-review
  presence is the branded "Prowl Review" check run (App avatar), matching the
  prowl-code-review and prowl-web repos. A hosted `resolve` job maps the CI run
  to exactly one open PR (head-SHA match) and posts neutral/failure setup checks
  for fork or unresolvable PRs without touching the self-hosted runner; the
  self-hosted `review` job pre-creates the in-progress check and passes
  `PROWL_CHECK_RUN_ID`/`pr-number`/`pr-draft` to the action. `.prowl-review.yml`
  enables the check run (`checkRun.enabled: true`, `failOn: critical` — red only
  on a Critical finding). `ci.yml` now lists explicit `pull_request` types
  (`opened, synchronize, ready_for_review, reopened`) so a draft->ready or reopen
  transition re-runs CI and thus the chained review. The
  action is pinned to immutable commit
  `prowl-tools/prowl-code-review@8a56424bce07b32d2374b647145a2dd0b4efc295`
  until a release (>0.3.0) containing the codex provider ships; bootstrap runs
  copy the trusted config from that pinned action repo only until this repo's
  config exists on the base branch. Existing `claude-code-review.yml`,
  `claude.yml`, and `mobile-e2e.yml` are untouched.

## [0.1.6] - 2026-08-24

### Fixed
- **iOS driver launches WebDriverAgent via `xcodebuild test-without-building`
  (iOS 26+ support).** On iOS 26+ simulators the previous approach — `simctl
  launch` of the preinstalled `com.facebook.WebDriverAgentRunner.xctrunner` — was
  terminated by RunningBoard (*"had no entitlements"*): the xctrunner has to be
  hosted by the test runner to get its entitlements, so WDA got a PID but its HTTP
  server never bound and readiness timed out at 60s, breaking iOS `run`/`analyze`
  and the iOS half of the mobile CI gate on every current Mac (iOS 26.5 is the
  only runtime `xcodebuild -downloadPlatform iOS` currently offers). Prowl now
  hosts WDA through the standard XCTest host launch: `xcodebuild
  test-without-building` driven by the generated `.xctestrun`, with the dynamic
  WDA port injected into the runner's environment. This is the single launch path
  and works on iOS 18 and 26+ alike; the WDA build cache (`~/.prowl/wda/…`) and the
  `PROWL_WDA_RUNNER` override are preserved (the override may now point at the
  `.xctestrun`, its `Build/Products` directory, or the runner `.app`). The
  runner `.app` override is resolved before generic directory handling so it finds
  the sibling `Build/Products/*.xctestrun` as documented. The self-hosted mobile
  CI gate's iOS smoke no longer skips iOS 26+ runtimes.
- **Mobile analysis review hardening.** Invalid XML numeric references now remain
  literal instead of crashing analysis, Android/iOS `/source` protocol mismatches
  fail with explicit errors instead of reporting an empty hierarchy, Android
  `am start` launch failures preserve the failing adb phase and original cause,
  and config-based `prowl analyze` now lets `--device`/`--udid` override configured
  identifiers.
- **Android app launch is now deterministic (`am start`, not `monkey`).** The
  Android target launched apps with `monkey`, which is unreliable when adb runs
  without a PTY (e.g. `execFile` in CI): on some emulator images — notably API 35
  `google_apis` — non-interactive `monkey` emits debug noise and exits non-zero
  even on success, so launches spuriously failed. `launchPackage` now resolves the
  launcher activity via `cmd package resolve-activity` and starts it with
  `am start -n <component>`. Verified live on an API 35 emulator (found while
  device-verifying `prowl analyze`). This is what unblocks the self-hosted mobile
  CI gate below on a standard API 35 AVD.

### Added
- **`assertWithAI` step type — AI-powered visual assertions (PROWL-020).** A new
  step, `assertWithAI: "<natural-language claim>"`, screenshots the current
  page/screen, sends the screenshot plus the claim to a vision-capable LLM, and
  passes or fails the step on the model's verdict — with the model's explanation
  surfaced in the step result (and, on failure, as the failure message) for
  auditability. Prowl's answer to Maestro's `assertWithAI`. Works via BYOK
  (`PROWL_AI_KEY`) against Anthropic (Messages API, base64 `image` block) or
  OpenAI (Chat Completions, `image_url` data URI); temperature is pinned to 0 and
  the model is instructed to return a strict JSON `{"pass", "reason"}` verdict,
  parsed robustly (unparseable output is an error, never a silent pass). The
  endpoint is configurable via `PROWL_AI_BASE_URL` (forward-compatible with a
  future managed-credit proxy). **Degrades gracefully:** with no AI provider
  configured the step skips with a warning rather than failing the run. This is a
  documented, deliberate exception to Prowl's determinism principle — AI verdicts
  are non-deterministic, so the explanation is always recorded. Available on the
  web target and any driver exposing the `screenshot` capability.
- **Unified native selector engine (PROWL-060).** The Android/iOS native selector
  dialect — the grammar for `id=`/`label=`/`text=`/`role=` (and `:focus`), the
  per-platform attribute mapping tables, the ranking order, and the host-side
  matching semantics — now lives in one module, `src/selector/native.ts`, instead
  of being duplicated across each mobile driver's locator translation and each
  mobile analyzer's selector ranking. Both mobile drivers parse through the shared
  `parseNativeSelector` (then map the neutral `{ kind, value, roleName? }` onto
  their own on-device query), and both mobile analyzers rank through the shared
  `rankNativeSelectors`, so Android and iOS can never drift from each other. The
  module documents the full **web / macOS / Android / iOS selector compatibility
  matrix** and the `label=`-in-assertions trap (native `label=` is an exact match,
  not a substring like `text=`) in a single place. It also adds a dependency-free,
  host-side **snapshot-then-match** engine (`nodeMatchesSelector` /
  `matchNativeTree`, exposed on the analyzers as `matchAndroidSelector` /
  `matchIosSelector`): parse an agent's `/source` dump and resolve a selector to
  matching nodes with no device — read-only and exposed for a later
  runner/macdriver migration. No observable behavior change: the runners still
  match on-device and the analyzers' ranked output is byte-for-byte identical.
  macOS remains on its existing driver/analyzer matching for now, with
  `MACOS_MATCH_DIALECT` in place as the extension point for the deferred
  migration.
- **`prowl analyze` now works on the Android and iOS targets (PROWL-061).** The
  native analog of the web/macOS analyzers: it attaches to a running app on a
  booted emulator/simulator, reads the on-device UI hierarchy (Android via the
  uiautomator2 agent's `GET /source`, iOS via WebDriverAgent's `GET /source`), and
  prints every interactive element with **ranked selector candidates** in each
  platform's dialect — Android `id=` (package-qualified `resource-id`) > `label=`
  (content-desc) > `role=<class>[name]` > `text=`; iOS `id=` (accessibility id) >
  `label=` > `role=<Type>[name]` > `text=`, plus a windows list. The `analyze`
  command gained native routing: `--app` forces a native target, `--platform
  <macos|android|ios>` disambiguates (an `.apk` implies Android; a bare bundle-id
  still defaults to macOS for back-compat), and `--device`/`--udid` pick a
  device/simulator. Config `target.type: android|ios` is honored when no URL or
  `--app` is given. The `guardrails.allowedApps` scope is enforced before launch
  (mirroring the run path) and analysis is strictly read-only. New library exports:
  `analyzeAndroidApp`/`analyzeIosApp` (+ ranking/parse helpers and result types)
  and a small dependency-free XML parser (`parseXml`) shared by both dialects. The
  agent clients gained a read-only `source()` reader. iOS caveat: WDA's page source
  exposes one `name` attribute (the accessibility identifier when set, else the
  label), so `id=` is offered only when `name` differs from the label.
- **CI recipes for the mobile targets (PROWL-061).** The README documents
  copy-paste GitHub Actions recipes for both platforms — Android on `ubuntu-latest`
  via `reactivecircus/android-emulator-runner` (KVM-accelerated), and iOS
  simulators on `macos-*` with a cached WebDriverAgent build — plus a new
  self-hosted `.github/workflows/mobile-e2e.yml` that boots a headless emulator and
  a simulator and runs real Settings smoke hunts through the CLI on the Prowl Tools
  Mac. That workflow triggers on `workflow_dispatch` and same-repo PRs, skips
  cleanly (green) for forks/outside PRs that can't reach the runner, and uses its
  own `concurrency` group so it never collides with other jobs on the shared box.

## [0.1.5] - 2026-08-20

### Changed
- **The mobile on-device agents are now optional dependencies.**
  `appium-uiautomator2-server` (Android) and `appium-webdriveragent` (iOS) moved
  from `dependencies` to `optionalDependencies` (same exact pins). Default
  installs are unchanged — mobile targets still work out of the box — but a
  failed agent download no longer breaks installing Prowl itself, and web-only
  users can install lean with `npm install -g prowl-tools --omit=optional`. If a
  mobile target runs without its agent present, it fails with scoped recovery
  commands for global npm installs (`npm install -g ...`) and local project
  installs (`npm install ...`) so the agent package is restored where Prowl can
  resolve it.
- **npm publishing now authenticates via OIDC Trusted Publishing (REL-001 /
  PROWL-057).** The tag-triggered publish workflow no longer reads the
  `NPM_TOKEN` secret: `npm publish` authenticates through GitHub Actions' OIDC
  identity (`id-token: write`) on Node 22.14.0 with npm 11, so the release job no
  longer depends on a long-lived token with a 90-day rotation cycle or hits auth
  failures masquerading as `404 Not Found` when one expires. Requires the trusted
  publisher to be configured on the `prowl-tools` npm package (GitHub Actions ·
  `prowl-tools/prowl` · `publish.yml`); provenance attestation is unchanged. No
  effect on installs or the published artifact.

### Fixed
- **Android target: speak the uiautomator2 server's native locator wire shape.**
  First device-verification of the Android target (Pixel 7 emulator, API 36,
  `appium-uiautomator2-server` 10.6.2) caught two protocol mismatches the faked
  transport in unit tests could not: element lookups sent W3C `{using, value}`
  bodies, but the raw on-device server (driven without Appium's translating
  driver layer) requires `{strategy, selector, context}` and rejected every
  lookup with `400 invalid argument`; and bare `id=` resource-ids never matched
  because the server matches resource-ids exactly. Locators now use the native
  wire shape, and bare `id=` names are auto-qualified with the target app's
  package (`id=save` → `com.pkg:id/save`; ids in other namespaces still work via
  the full form, e.g. `id=android:id/title`). Verified end-to-end on the
  emulator via `prowl run` (wait → assert by qualified and bare id → tap →
  navigate → screenshot).

### Added
- **iOS simulator execution target (ARCH-010 / PROWL-059).** Prowl can now drive
  native iOS apps on a **booted iOS Simulator** via `target: { type: "ios", app }`,
  where `app` is a bundle id or a built `.app` path to install (real devices are out
  of scope — PROWL-062). It mirrors the Android target's shape: `xcrun simctl`
  handles simulator lifecycle, install, launch, teardown (`terminate`), screenshots
  (`simctl io … screenshot`, used for artifacts so they survive an agent hang), and
  an opt-in deterministic cold start (`coldStart: true` → uninstall+reinstall, which
  requires the `.app` path); the on-simulator **WebDriverAgent** (`appium-webdriveragent`,
  Apache-2.0) handles UI interaction over its W3C-shaped HTTP/JSON API, driven with
  raw `fetch` (no Appium server, WebdriverIO, or tunnel — WDA is reachable directly).
  WDA's runner app is built once with `xcodebuild build-for-testing` and cached under
  `~/.prowl/wda/` keyed on the WDA + Xcode versions (a one-time notice is printed;
  `PROWL_WDA_RUNNER` can point at a prebuilt runner to skip the build), then installed
  and launched via `simctl` (no code signing on simulators) on a **dynamically
  allocated** port passed through `SIMCTL_CHILD_USE_PORT`. Simulator selection fails
  with an actionable error listing candidates when several are booted and no `udid`
  is set; preflight covers Xcode/simctl, a booted simulator, WDA build, and agent
  readiness. The selector dialect mirrors macOS/Android — `id=` → accessibility id,
  `label=` → `label ==` (exact NSPredicate), `text=`/bare → `label`/`value` substring,
  `role=` → `XCUIElementType…` class (shorthand like `Button` accepted; `role=…[name]`
  → class + substring), `:focus` → `hasKeyboardFocus == 1`. Capabilities are
  `{query, interact, wait, screenshot}` (no navigate), so the existing target/step
  gating rejects web-only steps up front with an iOS-labelled message; `type`/`fill`
  set text via WDA `element/value`, and `press` supports `enter`/`return`,
  `delete`/`backspace` (via `/wda/keys`), and `home` (`/wda/homescreen`), rejecting
  others clearly. `guardrails.allowedApps` is extended to iOS bundle ids / `.app`
  paths (the id is read from the bundle's root `Info.plist`); iOS `.app`-path
  detection requires an existing bundle directory so bundle ids ending in `.app`
  (e.g. `com.company.app`) are not misread as paths. `hover`/`scrollTo` have no touch
  equivalent yet and are rejected clearly. New library exports include
  `launchIosSession`, `closeIosSession`, `createIosDriver`, `parseIosSelector`,
  `WdaTransport`, the simctl helpers (`parseSimctlDevices`, `selectSimulatorUdid`, …),
  and the `IosTarget` / `IosAgentClient` / `IosSession` types. The unified selector
  engine (PROWL-060) and `prowl analyze` + CI recipes for iOS (PROWL-061) are tracked
  separately; real iOS devices (PROWL-062) are intentionally deferred.
- **Android execution target (ARCH-009 / PROWL-058).** Prowl can now drive native
  Android apps on an emulator or USB device via `target: { type: "android", app }`,
  where `app` is a package name or an `.apk` path to install. It follows the macOS
  target's "external agent + JSON protocol" shape: `adb` handles device lifecycle,
  screenshots, install, launch (`am start`/monkey), teardown (`am force-stop`), and
  an opt-in deterministic cold start (`coldStart: true` → `pm clear`); the on-device
  **`appium-uiautomator2-server`** (Apache-2.0, its two prebuilt APKs ship inside
  the npm dependency — never committed here) handles UI interaction over its
  W3C-shaped HTTP/JSON API, driven with raw `fetch` (no Appium server, JVM, gRPC, or
  WebdriverIO). The agent is started with `am instrument` and port-forwarded on a
  **dynamically allocated** local port (`adb forward tcp:0`) so parallel sessions /
  CI jobs don't collide. Device selection fails with an actionable error listing
  serials when several devices are attached and no `deviceSerial` is set; preflight
  covers adb-on-PATH, a booted device, and agent readiness. The selector dialect
  mirrors macOS — `id=` → `resource-id` (bare or `pkg:id/name`), `label=` →
  `content-desc` (exact), `text=` → visible text (substring), `role=` → widget class
  (+ substring text name) — with the Jetpack Compose `testTagsAsResourceId` caveat
  documented. Capabilities are `{query, interact, wait, screenshot}` (no navigate),
  so the existing target/step gating rejects web-only steps up front with an
  Android-labelled message; `type`/`fill` set text unicode-safely and `press` maps
  key names to Android key codes. `guardrails.allowedApps` is extended to Android
  package IDs / canonical `.apk` paths, with APK package IDs resolved and
  validated before install. `hover`/`scrollTo` have
  no touch equivalent yet and are rejected clearly (scroll-gesture support is a
  follow-up). New library exports include `launchAndroidSession`,
  `closeAndroidSession`, `createAndroidDriver`, `parseAndroidSelector`,
  `Uia2Transport`, the adb helpers (`parseAdbDevices`, `selectDeviceSerial`, …), and
  the `AndroidTarget` / `AndroidAgentClient` / `AndroidSession` types. iOS
  (PROWL-059/062), the unified selector engine (PROWL-060), and `prowl analyze` +
  CI recipes for Android (PROWL-061) are tracked separately.
- **`prowl analyze` for the macOS target (ARCH-007 / PROWL-055).** The analyzer
  now works on native apps, not just web pages: when the loaded config has
  `target.type: macos` (or you pass `--app <bundle-id|.app-path>` to run without a
  config), `prowl analyze` launches/attaches to the app through the existing
  `prowl-macdriver` helper and dumps its interactive elements — buttons, text
  fields, checkboxes, pop-ups, links, sliders, etc. — each with **ranked selector
  candidates** in the native selector dialect: `id=<AXIdentifier>` (best) >
  `label="<title/description>"` > `role=<role>[name="<name>"]` > `text="<substring>"`
  (last resort), so authoring macOS hunts no longer means guessing selectors
  blind. It also lists top-level **windows** as navigable surfaces and is **menu
  bar aware** — when the app has a status item it opens the status-item menu,
  reads the items (their `AXIdentifier`s are the most durable selectors), and
  closes it again. The command is **read-only** apart from that single
  open/close-menu interaction, closes the helper connection without quitting the
  target app, and honors
  `guardrails.allowedApps` before launch (mirroring the run path). `--json`
  emits agent-friendly output; the default is a human-readable table with the
  same shape and feel as the web analyzer. The web `prowl analyze <url>` path is
  unchanged. New library exports: `analyzeMacApp`, `rankMacSelectors`,
  `INTERACTIVE_ROLES`, `DEFAULT_ANALYZE_TREE_DEPTH`, and the `MacAnalysisResult` /
  `MacAnalysisElement` / `MacAnalysisWindow` types.

### Changed
- **Window-scoped screenshots on the macOS target (ARCH-003 / PROWL-049).** The
  macOS helper's `screenshot` verb now captures the attached app's **frontmost
  window** instead of the whole screen. It enumerates on-screen windows in
  z-order (`CGWindowListCopyWindowInfo`), keeps those owned by the app's pid at
  window layer 0, and captures the frontmost via `screencapture -x -l <windowID>`,
  so `assertScreenshot` baselines are window-sized and stable across desktops and
  machines with the same window content — no more menu bar clock, wallpaper, or
  unrelated windows folded into the baseline making diffs flaky by construction.
  When the app exposes no capturable window (menu-only apps, an open status-item
  menu, everything minimized) it falls back to a full-screen capture and surfaces
  a `warning` in the response (which `MacDriver.screenshot` logs via
  `console.warn`) rather than failing the hunt. Screenshots remain gated on Screen
  Recording permission. The helper now bounds each `screencapture` subprocess to
  10 seconds and terminates it with an explicit timeout error instead of blocking
  later helper commands indefinitely. **Baseline invalidation:** existing
  full-screen baselines captured by earlier macOS runs will no longer match the
  new window-scoped captures — delete and re-create them (`prowl update-baselines`
  or remove the stored baseline) after upgrading.

### Fixed
- Hardened the experimental iOS target startup path so WebDriverAgent startup
  retries once with a fresh port after launch/readiness failures, selected
  simulator UDIDs are reserved for the whole session, target-app launch failures
  still tear down the WDA runner, WDA request deadlines cover response-body reads,
  and the `press` key error list includes the accepted `del` alias.

## [0.1.4] - 2026-08-16

### Fixed
- **macOS target launch/quit race (BUG-MAC-001 / PROWL-054).** Back-to-back
  `prowl run` invocations against a macOS app could attach to the *previous*
  instance while it was still terminating — `terminate()` only requests shutdown
  and returns immediately, and the next launch's unfiltered
  `runningApplications(...).first` picked up the dying PID's still-readable AX
  tree, clicked a zombie menu, then hung waiting for a window no living process
  had been asked to open. The Swift helper's lifecycle is now deterministic:
  `quit()` first cancels any open status-item menu (whose NSMenu tracking runloop
  delayed clean termination), then requests terminate, polls `isTerminated` to a
  deadline, escalates to `forceTerminate()` if needed, and only returns once the
  process is actually gone — reporting the outcome (`terminated` / `forced` /
  `alreadyGone` / `timedOut`) in the quit response. `launch()` now skips
  terminating instances, waits (bounded by the launch timeout) for a still-dying
  instance to disappear before launching fresh, and verifies the PID is still
  alive before returning success. Back-to-back runs are now reliable with no
  sleeps between them (PROWL-054).

### Added
- **Experimental macOS native target (ARCH-002 / PROWL-048).** Prowl can now drive
  native macOS apps — including menu bar extras (`NSStatusItem` + `NSMenu`) — through
  Apple's Accessibility API, alongside the web target. The `target` config gains a
  discriminant: `type: "web"` (default — existing configs are unchanged) or
  `type: "macos"` with `app` (a bundle id or `.app` path). A new `MacDriver`
  implements the engine-neutral `SessionDriver` over a long-lived JSON-over-stdio
  Swift helper (`prowl-macdriver`), with a native selector dialect (`id=…`,
  `role=…[name="…"]`, `label=…`, bare text, plus `statusItem` / `menu=…` for the menu
  bar). Portable steps (`click`, `fill`, `type`, `press`, `wait`, `assert visible`,
  `screenshot`, `assertScreenshot`, `repeat`, `runHunt`, `if`, `copyText`, `hover`,
  `scrollTo`, `waitForSelector`) work on both targets; web-only steps are rejected up
  front on the macOS target. A native guardrail (`guardrails.allowedApps`) is the
  scope analog of `allowedDomains`. Sub-hunt steps are validated against the target
  too (web-only steps in a sub-hunt fail fast on the macOS target instead of running).
  The helper transport enforces a per-request deadline so a wedged helper can't hang a
  run. **Experimental and not distributed:** the helper
  binary is not bundled in the npm package — build it locally with `swift build` in
  `macdriver/`. Prowl gives a clear "build the helper" error if it is missing. See the
  README "macOS Target (Experimental)" section for the selector dialect, step
  compatibility matrix, and Accessibility-permission setup (incl. CI notes). Library
  exports: `createMacDriver`, `parseMacSelector`, `launchMacSession`,
  `closeMacSession`, `resolveHelperBinary`, `assertStepsSupportedByTarget`, and the
  `Target` / `WebTarget` / `MacosTarget` types (PROWL-048)

### Internal
- Driver abstraction extracted from the Playwright runner (ARCH-001 / PROWL-047).
  A new engine-neutral `SessionDriver` interface (`src/browser/driver.ts`) now
  sits between the step runner and Playwright, with `createPlaywrightDriver`
  (`src/browser/playwright-driver.ts`) as its sole implementation and the only
  runtime importer of Playwright. `executeSteps` is now a per-step handler
  registry whose handlers declare the driver capabilities they need, and the
  guardrails (`allowedDomains`, `forbiddenSelectors`, `maxSteps`, self-healing)
  are lifted into a policy layer (`src/runner/policy.ts`) that wraps the driver;
  the forbidden-selector check uses a driver-supplied selector parser. The
  `login`, `analyze`, and `generate` commands launch through the controller/
  driver instead of Playwright directly. This is a pure refactor — no hunt YAML,
  config, or behavior changes, and all existing tests pass unchanged. It is the
  prerequisite for non-browser execution targets (macOS native, Electron,
  mobile — PROWL-048). Residual coupling: `src/runner/steps.ts` keeps a
  type-only `import type { Page }` for the context's `page` field (the entrypoint
  the runner hands in); it carries no runtime Playwright dependency.

## [0.1.3] - 2026-06-03

### Changed
- **Rebrand to Prowl.** The project is now **Prowl**, one tool in the Prowl suite under Genkei Labs.
  - npm package renamed `prowlqa` → **`prowl-tools`** (the bare `prowl` name was already taken on npm); the CLI command/binary is now **`prowl`** (e.g. `prowl run`, `prowl ci`). Install with `npm install -g prowl-tools`.
  - Project config directory moved from `.prowlqa/` to **`.prowl/`**. The legacy `.prowlqa/` is still read for now, with a one-time deprecation warning — rename it to `.prowl/`; support for `.prowlqa/` will be removed in a future release.
  - MCP project registry now uses the `PROWL_PROJECTS` env var (legacy `PROWLQA_PROJECTS` still honored) and defaults to `~/.prowl/projects.yml` (legacy `~/.prowlqa/projects.yml` still read).
  - Homepage is now https://prowl.tools, docs https://docs.prowl.tools, and the repo + Homebrew tap moved to the `prowl-tools` org (`brew tap prowl-tools/tap`).

### Added
- Failure clustering (P7-004): `prowl ci` now groups failed hunts that share a common cause — the same step type, selector, and normalized error — so one root cause (e.g. a renamed selector breaking several hunts) surfaces as a single cluster instead of N independent failures. Multi-hunt clusters appear in a "Failure clusters" section of the CI summary and as a `clusters` array in `ci-result.json` (and `prowl ci --json`), each with the cause, affected hunts, and count. Library exports: `clusterFailures`, `FailureCluster` (PROWL-034)
- Self-healing selectors (P5-005): opt-in via `guardrails.selfHealing: true` (default `false`). When an explicit selector on an action step (`click`/`fill`/`selectOption`/`setInputFiles`/`press`/`hover`/`scrollTo`) matches nothing, Prowl derives the intent from the selector and tries alternative strategies — fuzzy text, ARIA label, then a structural interactive-element match — healing only to a candidate that resolves to exactly one element (never guesses among multiple). Heals are logged as a warning and surfaced in `result.json`/`summary.md` (per-step `healedFrom` + a "Self-Healed Selectors" section) so you can update your hunt. `waitForSelector` is intentionally excluded. Library exports: `healSelector`, `buildHealCandidates`, `extractSelectorIntent` (PROWL-023)
- Flake detection & scoring (P7-002): new `prowl flaky` command ranks hunts by flake score — the share of consecutive runs where pass/fail status flipped, computed from `.prowl/history.json`. Supports `--json`, `--limit <n>` (score only the most recent N runs), and `--threshold <0-1>`. Configurable via `reliability.flakyThreshold` in `config.yml` (default `0.3`). `prowl ci` now flags flaky hunts that ran in the suite, both in the CI summary and as a `flaky` array in `ci-result.json`. Library exports: `computeFlakeScore`, `rankFlaky`, `FlakyScore` (PROWL-032)
- Trace-ID correlation (OBS-001): when a hunt hits a failing request
  (status >= 400), Prowl reads the response's `traceparent` header,
  extracts the W3C trace id, and surfaces it in:
  - `result.json` under `traceCorrelations`
  - `summary.md` under a "Trace Correlations" section

  This lets you pivot from a hunt failure to the matching distributed trace in
  your own APM (Datadog, Grafana/Tempo, Jaeger, etc.). The header is
  configurable via `tracing.header` in `config.yml` (default `traceparent`); no
  output when the app emits no trace headers. Prowl does not generate or
  propagate its own spans (PROWL-047)

## [0.1.2] - 2026-05-29

### Added
- Configurable bug-log destination via `config.yml`: a `bugLog` block controls automated bug-logging — `bugLog.enabled` (default `true`), `bugLog.backlogPath` (default `docs/backlog.md`), and `bugLog.resolvedPath` (default `docs/resolved.md`). Paths resolve against the project root so MCP multi-project mode writes into the correct repo; the `run_suite` `logBugs` argument still overrides config (precedence: `logBugs` arg → `bugLog.enabled` → on). When only `backlogPath` is set, `resolvedPath` defaults to a sibling `resolved.md` (P5-011)

## [0.1.1] - 2026-05-28

### Added
- `copyText` step type: extract text content from an element and store as a runtime variable for use in subsequent steps (P4-004)
- `waitForDownload` step type: wait for a file download event with optional filename assertion and custom timeout, saves downloaded file to run artifacts (P4-009)
- Built-in `{{RANDOM_*}}` variables: `RANDOM_EMAIL`, `RANDOM_NAME`, `RANDOM_NUMBER`, `RANDOM_UUID`, `RANDOM_TEXT` generated once per hunt run for unique test data (P6-004)
- `NOTICE` file at repo root aggregating attribution for direct runtime dependencies (LEGAL-003)
- Run history: every `prowl run` and `prowl ci` appends an entry to `.prowl/history.json` with hunt name, status, startedAt, duration, and runDir. Retention is configurable per hunt via `history.maxRuns` (default 100) and enforced after every write (P7-001)
- `prowl history <hunt-name>` command: shows the last N runs as a formatted table or as JSON via `--json`; `--limit <n>` controls the slice (default 20) (P7-001)
- Library exports: `readHistory`, `readHuntHistory`, and `HistoryEntry` / `HistoryFile` types for programmatic history access (P7-001)
- `runSuite()` library function: run an entire hunt suite programmatically (tag filtering, sequential/parallel execution, aggregated `CiResult`) without spawning the CLI, with presentation handled via optional hooks; exported alongside `runHunt`. `prowl ci` now delegates to it with no change in behavior (P5-008)
- `updateBacklogFromSuite()` library function: logs failing hunts from a suite run as deduplicated bug tickets in the target project's `docs/backlog.md`. A bug is fingerprinted by hunt + failing step (type/selector) + normalized error; new failures get a `QA-NNN` ticket in a dedicated `## QA Findings (automated)` section, already-open failures are skipped, and failures matching a resolved ticket are logged as regressions that reference the old id. Idempotent, with configurable backlog/resolved paths (P5-009)
- `prowl mcp` command: starts an MCP server (stdio) that exposes Prowl to AI agents as named tools — `list_hunts`, `run_suite` (runs all hunts and logs failures to the backlog, returning counts + created `QA-NNN` ids), and `run_hunt`. Lets any MCP client drive QA against the current project without shell access. Adds the `@modelcontextprotocol/sdk` dependency (P5-001)
- MCP multi-project registry: `prowl mcp --projects <path>` (or `PROWL_PROJECTS`, or `~/.prowl/projects.yml`) loads a YAML registry mapping project names to repo roots, so one server instance can drive many repos. Adds a `list_projects` tool and an optional `project` argument on `list_hunts`/`run_suite`/`run_hunt`; omitting it keeps the current-directory behavior (P5-010)

### Fixed
- `assert` visibility now treats prose values as text instead of CSS selectors. Strings containing punctuation (e.g. `visible: "name:"` or a sentence ending in `.`) previously crashed with "Unexpected token … while parsing css selector"; they are now matched via Playwright's text engine. Values with a clear selector signature (leading `.`/`#`/`[`, an attribute bracket, or an engine prefix like `css=`/`xpath=`/`text=`) still route to the selector engine (PQH-QA-001, PQH-QA-002)

### Documentation
- README guardrails section now documents substring-matching semantics for `forbiddenSelectors` and `networkIgnorePatterns`, and the intentional `about:`/`data:` protocol bypass in `allowedDomains` (BUG-005, BUG-006)

## [0.1.0] - 2026-02-19

### Improved
- `unmockRoute` accepts string shorthand (`unmockRoute: "**/api/users"`) in addition to object form
- `assert visible` / `assert notVisible` now accept CSS selectors (e.g., `img[alt='Logo']`, `.card-grid`) in addition to plain text
- `wait` step uses substring matching instead of exact match, so `wait: "Made for agents"` now matches elements containing that text

### Added
- `evalScript` step type: evaluate JavaScript expressions in browser context, with optional variable capture via `as` (P4-003)
- `runScript` step type: execute external JavaScript files in browser context (P4-003)
- Runtime variables: `evalScript` with `as` stores results for `{{VAR}}` interpolation in subsequent steps (P4-003)
- `assertScreenshot` step type: visual regression testing with pixel-level baseline comparison using configurable threshold (P6-006)
- `prowl update-baselines` command: accept current screenshots as new visual regression baselines (P6-006)
- `prowl analyze <url>` command: extract interactive elements and selectors from a page for agent-driven discovery (P5-002)
- `prowl generate` command: AI-powered hunt generation from page analysis and intent description, supports Anthropic and OpenAI providers (P5-003)
- `if` conditional step: execute sub-steps only when a selector is visible or not visible, enabling optional UI handling like cookie banners and modals (P4-002)
- `repeat` step type: loop sub-steps a fixed number of times (`times`) or conditionally (`while` with `maxIterations`), with maxSteps guardrail enforcement across iterations (P4-001)
- `mockRoute` / `unmockRoute` step types: intercept network requests with custom responses (inline body or file-based), enabling testing of error/loading/empty states (P4-005)
- `prowl ci --parallel <count>`: run hunts concurrently with N workers for faster CI suites; per-step output suppressed in parallel mode to prevent interleaving (P2-006)
- Millisecond precision in run directory timestamps to prevent collisions during parallel execution
- JUnit XML report: `artifacts.junit: true` config option and `--junit` CLI flag generate `junit.xml` per hunt run, compatible with GitHub Actions, Jenkins, and GitLab CI (P2-004)
- Library API: public programmatic exports (`runHunt`, `listHunts`, `loadHunt`, `loadConfig`, schemas) for Node.js integration (P2-010)
- `prowl run --json`: machine-readable JSON output for agent and CI consumption (P2-011)
- `prowl ci --json`: machine-readable JSON output of CI results (P2-009)
- `prowl ci` command: run all hunts sequentially with combined pass/fail exit code, CI summary table, `ci-result.json` output, and `--include-tags`/`--exclude-tags` filtering (P2-001)
- CI status semantics: exit code 0 (pass), 1 (fail), 2 (no hunts found or all hunts skipped by tag filters); `ci-result.json` status field distinguishes `"pass"`, `"fail"`, `"no-hunts"`, and `"all-skipped"` (P2-001)
- Auth state warning: `console.warn` when `storageStatePath` is set but file doesn't exist (P1.7-006)
- Markdown escaping: `escapeMd()` helper applied to step/assertion values and errors in report summaries (P1.7-008)
- Terminal UX: per-step progress output with pass/fail indicators, hunt header, and summary with step counts
- ASCII raccoon mascot with color states: green (pass), red (fail), cyan (welcome/running)
- `prowl init` shows welcome banner with mascot and getting-started hint
- `runHunt` step type: execute another hunt file inline for reusable sub-flows (`runHunt: "login"` or `runHunt: { name: "login", vars: { ... } }`), with circular dependency detection and sub-hunt error attribution (P1.6-002)
- Expanded examples: 8 heavily-commented hunt templates bundled with `prowl init` (P1.6-004)
- `hover` step type: hover over an element by selector (`hover: { selector: "..." }`) (P1.6-008)
- `scroll` step type: scroll the page by direction and amount (`scroll: { direction: "down", amount: 500 }`) (P1.6-009)
- `scrollTo` step type: scroll an element into view (`scrollTo: { selector: "..." }`) (P1.6-009)
- Browser channel support: `browser.channel` config option and `--channel` CLI flag for testing against installed browsers (chrome, msedge, etc.)
- Multi-browser support: `browser.engine` config option (`chromium`, `firefox`, `webkit`) and `--browser` CLI flag (P1.6-010)
- Viewport configuration: `browser.viewport` config option (presets: `mobile`, `tablet`, `desktop` or custom `{ width, height }`) and `--viewport` CLI flag (P1.6-011)
- Hunt tags: optional `tags` field in hunt YAML for categorization (P1.6-001)
- Tag filtering: `--include-tags` and `--exclude-tags` CLI flags on `prowl run` (P1.6-001)
- `prowl list` displays tags per hunt with aligned columns, description, and `--json` flag (P1.6-001, P1.6-005)
- Retry logic: optional `retry: { maxRetries, delay? }` field in hunt YAML for automatic retries on failure (P1.6-003)
- `onDialog` step type: register a one-time dialog handler (`accept` or `dismiss`) for browser-native dialogs (FEAT-003)
- `setInputFiles` step type: set files on `<input type="file">` elements, supports single or array of paths relative to `.prowl/` (FEAT-002)
- Shorthand syntax for hunts: `click: "Text"`, `fill: { "Label": "value" }`, `type: "text"`, and `select: { "Label": "value" }` with explicit syntax retained (P1.5-001)
- Inline `assert` step type for mid-flow checks: `visible`, `notVisible`, `urlIncludes`, `urlEquals` (P1.5-002)
- `wait` shorthand step: `wait: "Text"` and `wait: { for: "Text", timeout?: number }` (P1.5-003)
- `prowl watch <hunt-name>` command with immediate first run, 300ms debounce, and watch targets for hunt, config, and `.env` (P1.5-004)
- Comprehensive README with getting started, step reference, assertion reference, config reference, variable interpolation guide, selector best practices, auth guide, artifacts guide, architecture overview, and troubleshooting
- Community Hub (`prowl-hub`): community hunt templates with contribution guidelines and CI validation
- npm publish readiness: Apache 2.0 license, package metadata (keywords, repository, homepage, bugs)
- CLI foundation with `run`, `login`, `init`, `list`, `watch`, and `ci` commands
- Playwright integration with headless and headed modes
- Configuration system (`.prowl/config.yml`) with Zod schema validation
- Hunt file parsing (`.prowl/hunts/*.yml`) with variable interpolation (`{{VAR}}`)
- 26 step types: `navigate`, `click`, `fill`, `type`, `press`, `selectOption`, `select`, `waitForSelector`, `waitForUrl`, `waitForNetworkIdle`, `wait`, `assert`, `onDialog`, `setInputFiles`, `runHunt`, `hover`, `scroll`, `scrollTo`, `screenshot`, `if`, `repeat`, `mockRoute`, `unmockRoute`, `evalScript`, `runScript`, `assertScreenshot`
- 6 assertion types: `selectorExists`, `selectorNotExists`, `urlIncludes`, `urlEquals`, `noConsoleErrors`, `noNetworkErrors`
- Guardrails: forbidden selectors, allowed domains, max steps, max total time
- Artifact generation: screenshots (on-failure/all), console logs, network HAR, Playwright traces, JUnit XML
- Report generation: `summary.md`, `result.json`, and `junit.xml` per run
- Variable interpolation with redaction of sensitive fill step values
- Auth state capture via `prowl login` for authenticated test flows

### Changed
- `prowl init` now bundles a single minimal `hello.yml` starter hunt instead of 8 example hunts; example templates moved to the community hub at hub.prowl.tools
- `prowl init` output now points users to the community hub for additional hunt templates
- `init --force` preserves user-created files; only overwrites known template files (config.yml, example hunts, .gitignore) (P1.7-009)

### Fixed
- Auth state warning: suppress misleading "Auth state file not found" warning when config does not include an `auth` section; `storageStatePath` now defaults to `undefined` instead of always resolving to `.prowl/auth-state.json` (BUG-007)
- Screenshot path traversal: reject screenshot names containing `/`, `\`, or `..` (BUG-004)
- `init` command: replace hardcoded path resolution with directory walk to find package root (BUG-002)
- `package.json`: include `examples/` in `files` field so `prowl init` works after `npm install -g` (BUG-003)
- Nested variable interpolation: hunt vars referencing env vars via `{{...}}` now resolve correctly (BUG-001)
- Guardrail hardening: enforce forbidden selector checks for shorthand `click`, `fill`, `select`, `type`, `wait`, `assert`, `waitForSelector`, and `type` `:focus` paths
- Redact `type` step values in reports to match `fill` step redaction behavior
