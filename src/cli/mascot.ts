import chalk from "chalk";

const FIGLET_LOGO = [
  " ____  ____   ___  _    _ _     ___    _",
  "|  _ \\|  _ \\ / _ \\| |  | | |   / _ \\  / \\",
  "| |_) | |_) | | | | |  | | |  | | | |/ _ \\",
  "|  __/|  _ <| |_| | |/\\| | |__| |_| / ___ \\",
  "|_|   |_| \\_\\\\___/|_/  \\_\\____\\\\__\\_\\_/   \\_\\",
];

export function welcomeBanner(): string {
  const logo = FIGLET_LOGO.map((line) => chalk.cyan(line)).join("\n");
  return `\n${logo}\n\n  ${chalk.gray("QA testing for the web")}\n`;
}

export function resultMascot(state: "pass" | "fail", huntName: string): string {
  const isPassing = state === "pass";
  const icon = isPassing ? "\u2713" : "\u2717";
  const label = isPassing ? "PASS" : "FAIL";
  const color = isPassing ? chalk.green : chalk.red;

  const content = `  ${icon} ${label}  ${huntName} `;
  // Strip ANSI for width calculation
  const innerWidth = content.length;
  const top = `  \u250C${"─".repeat(innerWidth)}\u2510`;
  const mid = `  \u2502${content}\u2502`;
  const bot = `  \u2514${"─".repeat(innerWidth)}\u2518`;

  return color(`${top}\n${mid}\n${bot}`);
}
