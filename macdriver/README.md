# prowl-macdriver (experimental)

`prowl-macdriver` is the Accessibility (AXUIElement) helper binary behind Prowl's
**experimental** macOS execution target (PROWL-048 / ARCH-002). Prowl's
TypeScript `MacDriver` spawns it in `serve` mode and drives a native macOS app —
including menu bar extras (`NSStatusItem` + `NSMenu`) — over newline-delimited
JSON on stdio.

> **Distribution is deferred.** This binary is **not** bundled in the npm
> package (`prowl-tools`); the tarball whitelist in `package.json` is unchanged.
> Build it locally (below) to use the macOS target. It is gated behind
> `target.type: "macos"` and is not on the default web path.

## Build

```bash
cd macdriver
swift build -c release        # binary at .build/release/prowl-macdriver
```

Prowl locates the binary via, in order:
1. `PROWL_MACDRIVER_BIN` (absolute path to the binary), then
2. `macdriver/.build/release/prowl-macdriver`, then
3. `macdriver/.build/debug/prowl-macdriver`,
relative to the Prowl package root. If none exist, Prowl fails with a clear
"build the helper" message instead of crashing.

## Accessibility permission

The **process that hosts** `prowl-macdriver` must be granted Accessibility
permission (System Settings → Privacy & Security → Accessibility). When Prowl is
launched from a terminal, macOS attributes the grant to that terminal app (e.g.
Terminal, iTerm, VS Code), not to `prowl-macdriver` itself.

Preflight from the command line:

```bash
.build/release/prowl-macdriver check   # prints {"trusted": <bool>}; prompts on first run
```

`screenshot` additionally needs Screen Recording permission for the hosting app.

## Protocol

`serve` reads one JSON request per line on stdin and writes one JSON response per
line on stdout. State (the attached app, open menus) persists across requests.

```
→ {"id":1,"cmd":"launch","app":"com.example.App","timeout":10}
← {"id":1,"ok":true,"result":{"bundleId":"com.example.App","pid":1234}}
→ {"id":2,"cmd":"click","query":{"by":"role","role":"button","name":"Save"}}
← {"id":2,"ok":true,"result":{"clicked":true}}
```

Query shapes (parsed on the TypeScript side from Prowl's selector dialect):

| Selector | Query |
|---|---|
| `id=openSettings` | `{"by":"id","value":"openSettings"}` |
| `role=button[name="Save"]` | `{"by":"role","role":"button","name":"Save"}` |
| `label="Email"` | `{"by":"label","value":"Email"}` |
| bare text / `text="Save"` | `{"by":"text","value":"Save"}` |

Verbs: `check`, `launch`, `activate`, `quit`, `count`, `text`, `click`, `fill`,
`press` (Enter/Return/Space only), `hover`, `scrollTo`, `waitFor`, `screenshot`,
`statusItems`, `windows`, `openMenu`, `closeMenu`, `clickMenu`, `tree`,
`shutdown`.

## Lineage

Promoted from the `spikes/macdriver/axspike` proof of concept, which validated
the core AX mechanism end-to-end against a real menu bar app: status-item
discovery via `AXExtrasMenuBar`, menu open/dump/click (`AXPress` with a short
messaging timeout to avoid blocking on the menu-tracking loop), window listing,
and the `AXIsProcessTrusted` preflight.
