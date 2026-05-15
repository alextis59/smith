import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initConfig, parseCliConfigOverrides, userConfigPath } from "./config.js";

export type ParsedArgs = {
  command: "help" | "version" | "run" | "remote" | "config" | "benchmark";
  prompt?: string;
  rest: string[];
};

export function parseArgs(args: string[]): ParsedArgs {
  const [first, ...rest] = args;
  if (!first || first === "-h" || first === "--help" || first === "help") {
    return { command: "help", rest };
  }
  if (first === "-v" || first === "--version" || first === "version") {
    return { command: "version", rest };
  }
  if (first === "remote" || first === "config" || first === "benchmark") {
    return { command: first, rest };
  }
  return { command: "run", prompt: args.join(" "), rest: [] };
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(args);
  if (parsed.command === "help") {
    process.stdout.write(helpText());
    return;
  }
  if (parsed.command === "version") {
    process.stdout.write(`${packageVersion()}\n`);
    return;
  }
  if (parsed.command === "config") {
    await runConfigCommand(parsed.rest);
    return;
  }

  throw new Error(`${parsed.command} is not implemented yet`);
}

export function helpText(): string {
  return `Smith

Usage:
  smith [options] "task"
  smith remote [options] "task"
  smith config path
  smith config init
  smith benchmark run <task-or-directory>

Smith is a terminal-first coding agent. This build currently contains the CLI skeleton; runtime features are being implemented by milestone.
`;
}

async function runConfigCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const { overrides } = parseCliConfigOverrides(rest);
  const path = overrides.cwd ? join(overrides.cwd, ".smith", "config.toml") : userConfigPath();

  if (subcommand === "path") {
    process.stdout.write(`${path}\n`);
    return;
  }
  if (subcommand === "init") {
    process.stdout.write(`${initConfig(path)}\n`);
    return;
  }
  throw new Error("usage: smith config path|init [--cwd <directory>]");
}

function packageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const packagePath = join(here, "../../package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
  return packageJson.version ?? "0.0.0";
}
