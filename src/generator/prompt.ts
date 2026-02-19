import type { AnalysisResult } from "../analyzer/index.js";

const STEP_REFERENCE = `
## ProwlQA Step Types

### Navigation & Waiting
- navigate: "/path" — navigate to URL (relative to target)
- wait: "Text" — wait for text to appear
- wait: { for: "Text", timeout: 5000 } — with timeout
- waitForSelector: { selector: "#el", timeout: 5000 }
- waitForUrl: { value: "/path", timeout: 5000 }
- waitForNetworkIdle: { timeout: 5000 }

### Interaction
- click: "Button Text" — click by text (tries role=button first)
- click: { selector: "[data-testid=btn]" } — click by selector
- fill: { "Label": "value" } — fill by label/placeholder
- fill: { selector: "#input", value: "text" } — fill by selector
- type: "text" — type into focused element
- press: { selector: "#input", key: "Enter" }
- hover: { selector: "#menu" }
- selectOption: { selector: "select", value: "option" }
- select: { "Label": "value" } — select by label
- setInputFiles: { selector: "#file", files: "path.png" }
- onDialog: { action: "accept" } — handle browser dialogs

### Assertions
- assert: { visible: "Text" }
- assert: { notVisible: "Error" }
- assert: { urlIncludes: "/dashboard" }
- assert: { urlEquals: "https://..." }

### Scrolling & Screenshots
- scroll: { direction: "down", amount: 500 }
- scrollTo: { selector: "#section" }
- screenshot: { name: "step-name" }

### Script Execution
- evalScript: "document.title" — evaluate JS expression
- evalScript: { expression: "expr", as: "VAR" } — capture to variable
- runScript: { file: "scripts/setup.js" }

### Visual Regression
- assertScreenshot: { name: "baseline-name", threshold: 0.1 }

### Control Flow
- if: { visible: ".banner", then: [steps...] }
- repeat: { times: 3, steps: [steps...] }
- repeat: { while: { visible: ".more" }, maxIterations: 10, steps: [steps...] }
- runHunt: "other-hunt" — run another hunt file
- mockRoute: { url: "**/api/data", response: { status: 200, body: "{}" } }
- unmockRoute: { url: "**/api/data" }
`.trim();

export function buildGenerationPrompt(analysis: AnalysisResult, intent: string): string {
  return `You are a QA test generator for ProwlQA. Generate a YAML hunt file that tests the described intent using the page analysis data below.

${STEP_REFERENCE}

## Page Analysis
\`\`\`json
${JSON.stringify(analysis, null, 2)}
\`\`\`

## Test Intent
${intent}

## Instructions
1. Output ONLY a valid ProwlQA YAML hunt between \`\`\`yaml fences
2. Use shorthand syntax when possible (click: "Text", fill: { "Label": "value" })
3. Prefer stable selectors: data-testid > aria-label > text > CSS selectors
4. Include assertions to verify expected outcomes
5. Add a descriptive name and description
6. Keep steps focused and minimal — test exactly what the intent describes

\`\`\`yaml
`;
}

export function extractYamlFromResponse(response: string): string {
  const fenceMatch = response.match(/```ya?ml\n?([\s\S]*?)```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return response.trim();
}
