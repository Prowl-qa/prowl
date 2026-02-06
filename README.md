# prowlai

CLI-first QA testing tool for deterministic Playwright flows.

## Install

```bash
npm install -g prowlai
```

Playwright browsers are not auto-installed. Run:

```bash
npx playwright install chromium
```

## Quick Start

```bash
prowlai init
prowlai run homepage
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
- `click`: `{ selector: string }`
- `fill`: `{ selector: string, value: string }`
- `press`: `{ selector: string, key: string }`
- `waitForSelector`: `{ selector: string, timeout?: number }`
- `waitForUrl`: `{ value: string, timeout?: number }` (includes match)
- `waitForNetworkIdle`: `{ timeout?: number }`
- `screenshot`: `{ name?: string }`

Selectors accept Playwright selector engines, e.g. `role=button[name="Submit"]`.

## Auth

```bash
prowlai login
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
prowlai run <hunt-name>
prowlai run <hunt-name> --headed
prowlai run <hunt-name> --trace
prowlai login
prowlai init
prowlai list
```
