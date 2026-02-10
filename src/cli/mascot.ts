import chalk from "chalk";

type MascotState = "running" | "pass" | "fail" | "warning" | "welcome";

const RACCOON = [
  "      /\\_/\\  ",
  "     ( o.o ) ",
  "      > ^ <  ",
  "     /|   |\\ ",
  "    (_|   |_)",
];

const stateColor: Record<MascotState, (text: string) => string> = {
  running: chalk.cyan,
  pass: chalk.green,
  fail: chalk.red,
  warning: chalk.yellow,
  welcome: chalk.cyan,
};

export function renderMascot(state: MascotState, message?: string): string {
  const color = stateColor[state];
  const lines = RACCOON.map((line) => color(line));

  if (message) {
    const padded = lines.map((line, i) => {
      if (i === 2) return `${line}  ${message}`;
      return line;
    });
    return padded.join("\n");
  }

  return lines.join("\n");
}

export function welcomeBanner(): string {
  const color = chalk.cyan;
  const lines = [
    "",
    color("      /\\_/\\"),
    color("     ( o.o )  ") + chalk.bold("Prowl") + chalk.gray(" — QA testing for the web"),
    color("      > ^ <"),
    color("     /|   |\\"),
    color("    (_|   |_)"),
    "",
  ];
  return lines.join("\n");
}

export function resultMascot(state: "pass" | "fail"): string {
  const color = stateColor[state];
  const eyes = state === "pass" ? "^.^" : "x.x";
  const art = [
    `      /\\_/\\`,
    `     ( ${eyes} )`,
    `      > ^ <`,
    `     /|   |\\`,
    `    (_|   |_)`,
  ];
  return art.map((line) => color(line)).join("\n");
}
