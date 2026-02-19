import chalk from "chalk";
import type { Step, StepResult, RunResult } from "../types/index.js";

export function describeStep(step: Step): string {
  if ("navigate" in step) return `navigate "${step.navigate}"`;
  if ("click" in step) {
    if (typeof step.click === "string") return `click "${step.click}"`;
    return `click "${step.click.selector}"`;
  }
  if ("fill" in step) {
    if ("selector" in step.fill && "value" in step.fill) {
      return `fill "${(step.fill as { selector: string }).selector}"`;
    }
    const label = Object.keys(step.fill)[0];
    return `fill "${label}"`;
  }
  if ("type" in step) return `type "${truncate(step.type, 20)}"`;
  if ("selectOption" in step) return `selectOption "${step.selectOption.selector}"`;
  if ("select" in step) {
    const label = Object.keys(step.select)[0];
    return `select "${label}"`;
  }
  if ("onDialog" in step) return `onDialog ${step.onDialog.action}`;
  if ("setInputFiles" in step) return `setInputFiles "${step.setInputFiles.selector}"`;
  if ("runHunt" in step) {
    const name = typeof step.runHunt === "string" ? step.runHunt : step.runHunt.name;
    return `runHunt "${name}"`;
  }
  if ("press" in step) return `press "${step.press.key}"`;
  if ("assert" in step) {
    const a = step.assert;
    if (a.visible) return `assert visible "${a.visible}"`;
    if (a.notVisible) return `assert notVisible "${a.notVisible}"`;
    if (a.urlIncludes) return `assert urlIncludes "${a.urlIncludes}"`;
    if (a.urlEquals) return `assert urlEquals "${a.urlEquals}"`;
    return "assert";
  }
  if ("wait" in step) {
    if (typeof step.wait === "string") return `wait "${step.wait}"`;
    return `wait "${step.wait.for}"`;
  }
  if ("waitForSelector" in step) return `waitForSelector "${step.waitForSelector.selector}"`;
  if ("waitForUrl" in step) return `waitForUrl "${step.waitForUrl.value}"`;
  if ("waitForNetworkIdle" in step) return "waitForNetworkIdle";
  if ("hover" in step) return `hover "${step.hover.selector}"`;
  if ("scroll" in step) return `scroll ${step.scroll.direction} ${step.scroll.amount ?? 500}px`;
  if ("scrollTo" in step) return `scrollTo "${step.scrollTo.selector}"`;
  if ("screenshot" in step) return `screenshot "${step.screenshot.name ?? "auto"}"`;
  if ("if" in step) {
    if (step.if.visible !== undefined) return `if visible "${step.if.visible}"`;
    if (step.if.notVisible !== undefined) return `if notVisible "${step.if.notVisible}"`;
    return "if condition unspecified";
  }
  if ("repeat" in step) {
    if (step.repeat.times !== undefined) return `repeat ${step.repeat.times} times`;
    if (step.repeat.while?.visible !== undefined) {
      return `repeat while visible "${step.repeat.while.visible}"`;
    }
    if (step.repeat.while?.notVisible !== undefined) {
      return `repeat while not visible "${step.repeat.while.notVisible}"`;
    }
    return "repeat while condition unspecified";
  }
  if ("mockRoute" in step) return `mockRoute "${step.mockRoute.url}"`;
  if ("unmockRoute" in step) return `unmockRoute "${step.unmockRoute.url}"`;
  return "unknown step";
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}

export function printHuntHeader(huntName: string): void {
  console.log(`\n  ${chalk.cyan("\u25CF")} ${chalk.bold("Running hunt:")} ${huntName}`);
}

export function printStepResult(result: StepResult, step: Step | undefined, _index: number): void {
  const label = step ? describeStep(step) : result.type;
  const duration = chalk.gray(`(${result.durationMs}ms)`);

  if (result.status === "pass") {
    console.log(`    ${chalk.green("\u2713")} ${label} ${duration}`);
  } else {
    const error = result.error ? chalk.gray(` \u2014 ${result.error}`) : "";
    console.log(`    ${chalk.red("\u2717")} ${label} ${duration}${error}`);
  }
}

export function printHuntSummary(result: RunResult, runDir: string): void {
  const passed = result.steps.filter((s) => s.status === "pass").length;
  const total = result.steps.length;
  const status =
    result.status === "pass"
      ? chalk.green.bold("PASS")
      : chalk.red.bold("FAIL");
  const stepCount = chalk.gray(`${passed}/${total} steps`);
  const duration = chalk.gray(`(${result.durationMs}ms)`);

  console.log(`\n  ${status} ${chalk.bold(result.hunt)} ${duration} ${stepCount}`);
  console.log(`  ${chalk.gray("Artifacts:")} ${runDir}\n`);
}
