/**
 * PROWL-074 / PROWL-052 — `prowl macdriver` subcommand group: manage the
 * prebuilt, signed macOS helper (`prowl-macdriver`) so the macOS target works
 * without Xcode or a Swift toolchain.
 *
 *   prowl macdriver install   download + verify + install the pinned helper
 *   prowl macdriver status     report resolved binary, versions, TCC guidance
 *
 * This is deliberately NOT a general `prowl doctor` (that's PROWL-026); it stays
 * scoped to the macdriver helper.
 */
import chalk from "chalk";
import { Command } from "commander";
import { MACDRIVER_VERSION, macdriverReleaseTag } from "../../browser/macdriver-release.js";
import {
  collectMacdriverStatus,
  installMacdriver,
  tccGuidance
} from "../../browser/macdriver-install.js";

function buildInstallCommand(): Command {
  return new Command("install")
    .description("Download and install the prebuilt, signed prowl-macdriver helper")
    .option("--force", "Reinstall even if the pinned version is already present")
    .action(async (options: { force?: boolean }) => {
      try {
        console.log(
          chalk.cyan(
            `Installing prowl-macdriver ${MACDRIVER_VERSION} (${macdriverReleaseTag(MACDRIVER_VERSION)})…`
          )
        );
        const result = await installMacdriver({ force: options.force });
        if (result.alreadyInstalled) {
          console.log(
            chalk.green(`Already installed at ${result.binaryPath}`) +
              chalk.dim(" (use --force to reinstall)")
          );
        } else {
          console.log(chalk.green(`Installed prowl-macdriver ${result.version} → ${result.binaryPath}`));
        }
        console.log("");
        console.log(tccGuidance());
      } catch (error) {
        const message = error instanceof Error ? error.message : "Install failed";
        console.error(chalk.red(`Error: ${message}`));
        process.exitCode = 1;
      }
    });
}

function buildStatusCommand(): Command {
  return new Command("status")
    .description("Report the resolved prowl-macdriver binary, installed versions, and permissions guidance")
    .action(async () => {
      try {
        const status = await collectMacdriverStatus();

        console.log(chalk.bold("prowl-macdriver status"));
        console.log(`  pinned version:   ${status.pinnedVersion}`);

        if (status.resolved) {
          const label =
            status.resolved.source === "env"
              ? "PROWL_MACDRIVER_BIN override"
              : status.resolved.source === "user-install"
                ? "user install (~/.prowl/macdriver)"
                : "repo source build (macdriver/.build)";
          console.log(`  resolved binary:  ${status.resolved.path}`);
          console.log(`  resolved via:     ${label}`);
          console.log(
            `  runs:             ${
              status.probedVersion
                ? chalk.green(`yes (reports ${status.probedVersion})`)
                : chalk.yellow("no (binary did not respond to `version`)")
            }`
          );
        } else {
          console.log(`  resolved binary:  ${chalk.yellow("none")}`);
          console.log(chalk.dim("  search order: PROWL_MACDRIVER_BIN → ~/.prowl/macdriver → macdriver/.build"));
          console.log(chalk.cyan("  Run `prowl macdriver install` to install the prebuilt helper."));
        }

        if (status.installed.length > 0) {
          console.log("  installed versions:");
          for (const entry of status.installed) {
            const marker = entry.version === status.pinnedVersion ? chalk.green(" (pinned)") : "";
            console.log(`    - ${entry.version}${marker}  ${chalk.dim(entry.binaryPath)}`);
          }
        } else {
          console.log("  installed versions: none");
        }

        console.log("");
        console.log(tccGuidance());
      } catch (error) {
        const message = error instanceof Error ? error.message : "Status failed";
        console.error(chalk.red(`Error: ${message}`));
        process.exitCode = 1;
      }
    });
}

export function buildMacdriverCommand(): Command {
  const command = new Command("macdriver").description(
    "Manage the macOS helper binary (prowl-macdriver) for the macOS target"
  );
  command.addCommand(buildInstallCommand());
  command.addCommand(buildStatusCommand());
  return command;
}
