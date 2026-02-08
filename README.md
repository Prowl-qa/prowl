# prowl

CLI-first QA testing tool for deterministic Playwright flows.

## Install

```bash
npm install -g prowl
```

Playwright browsers are not auto-installed. Run:

```bash
npx playwright install chromium
```

## Quick Start

```bash
prowl init
prowl run homepage
```

## Config

Config lives at `.prowl/config.yml`.

```yml
target:
  url: "http://localhost:3000"

browser:
  headless: true
  slowMo: 0
  timeout: 30000

artifacts:
  screenshots: "on-failure"
  networkHar: false
  console: true

assertions:
  noConsoleErrors: true
  noNetworkErrors: true
  maxTotalTimeMs: 30000
  networkIgnorePatterns: []

guardrails:
  maxSteps: 50
  allowedDomains:
    - "localhost"
    - "127.0.0.1"
    - "0.0.0.0"
  forbiddenSelectors:
    - "[data-danger]"
    - ".delete-btn"

auth:
  storageStatePath: ".prowl/auth-state.json"
```

## Hunts

Hunts live at `.prowl/hunts/*.yml`.

```yml
# .prowl/hunts/homepage.yml
name: homepage
vars:
  PAGE_TITLE: "Welcome"
steps:
  - navigate: "/"
  - waitForSelector:
      selector: "text={{PAGE_TITLE}}"
assertions:
  - selectorExists: "h1"
  - urlIncludes: "/"
```

### Hunt Vars

Use a `vars` block to define hunt-specific values for `{{VAR}}` interpolation. Hunt vars take
precedence over `process.env` and `.env`.

### Step Types

- `navigate`: string (path or full URL)
- `click`: `{ selector: string }` or `"Button Text"` (tries button role first, then text fallback)
- `fill`: `{ selector: string, value: string }` or `{ "Label": "value" }` (label-first, placeholder fallback)
- `type`: `string` (fills `:focus`)
- `press`: `{ selector: string, key: string }`
- `selectOption`: `{ selector: string, value: string }`
- `select`: `{ "Label": "value" }` (label-first, `aria-label`, placeholder fallback)
- `onDialog`: `{ action: "accept" | "dismiss" }`
- `setInputFiles`: `{ selector: string, files: string | string[] }`
- `assert`: `{ visible | notVisible | urlIncludes | urlEquals }` (inline assertion step)
- `wait`: `"text"` or `{ for: "text", timeout?: number }`
- `waitForSelector`: `{ selector: string, timeout?: number }`
- `waitForUrl`: `{ value: string, timeout?: number }` (includes match)
- `waitForNetworkIdle`: `{ timeout?: number }`
- `screenshot`: `{ name?: string }`

Selectors accept Playwright selector engines, e.g. `role=button[name="Submit"]`.

### Shorthand Examples

```yml
steps:
  - click: "Sign In"
  - fill:
      "Email": "user@test.com"
  - type: "Hello world"
  - select:
      "State": "FL"
  - wait: "Welcome back"
  - assert:
      visible: "Welcome back"
```

## Auth

```bash
prowl login
```

This opens a headed Chromium window and saves storage state to `.prowl/auth-state.json`.

## Notes

- `waitForUrl` uses "includes" matching.
- When screenshots are taken (mode: `on-failure`), they capture the final browser state at the moment of capture.
- `{{VAR}}` values are interpolated from hunt `vars`, then `process.env` and `.env` in the config directory.
- `{{VAR}}` values are redacted in `summary.md` and `result.json`.
- `networkIgnorePatterns` ignores network errors when the URL includes any listed substring.

## CLI

```bash
prowl run <hunt-name>
prowl run <hunt-name> --headed
prowl run <hunt-name> --trace
prowl watch <hunt-name>
prowl login
prowl init
prowl list
```
