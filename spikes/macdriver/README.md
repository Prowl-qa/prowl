# macdriver spike (PROWL-048 proof of concept)

`axspike` is a throwaway Swift CLI that proves the core mechanism for a future Prowl
macOS execution target: driving a menu bar app through Apple's Accessibility API
(AXUIElement). It is **not shipped** — the npm tarball whitelist (`files` in
`package.json`) excludes `spikes/`.

## What it proves

The ~6 verbs a `MacDriver` needs, against a real `NSStatusItem` + `NSMenu` app:

| Command | Future driver verb |
|---|---|
| `axspike status-items` | find the app's status item |
| `axspike open-menu` | click status item, read menu (roles/titles/enabled as JSON) |
| `axspike click-menu <title>` | click a menu item by title substring |
| `axspike windows` / `assert-window <title>` | `assert: visible` against window labels |
| `axspike tree --depth N` | selector resolution / `prowl analyze` equivalent |
| `axspike check` | Accessibility permission preflight |

Default target: `com.tookes.Sentwise` (override with `--bundle-id`).

## Build & run

```bash
cd spikes/macdriver
swift build
.build/debug/axspike check   # prompts for Accessibility permission on first run
```

The process running `axspike` must be granted Accessibility permission
(System Settings → Privacy & Security → Accessibility). When run from a terminal,
macOS attributes the grant to the hosting terminal app.

## Safety notes for the Sentwise target

Sentwise auto-connects to a real mailbox from persisted settings + Keychain on
launch. For the spike, launch it isolated so it starts disconnected:

```bash
SCRATCH=$(mktemp -d)
mkdir -p "$SCRATCH/Library/Preferences"
HOME="$SCRATCH" CFFIXED_USER_HOME="$SCRATCH" /path/to/Sentwise.app/Contents/MacOS/Sentwise
```

With a fresh home there is no account, no watcher, and nothing destructive to
click. Deny any Keychain prompt — the spike never needs it. Do not click
"Launch at Login" (registers a real login item) or "Check for Updates…"
(Sparkle network call).
