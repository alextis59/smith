import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProfileConfig, RuntimeConfig } from "./config.js";

export type TraceLogger = {
  path: string;
  write(section: string, content: string): void;
};

export function runsDir(homeDir = homedir()): string {
  return join(homeDir, ".smith", "runs");
}

export function createTraceLogger(options: {
  cwd: string;
  profileName: string;
  profile: ProfileConfig;
  runtime: RuntimeConfig;
  systemPrompt: string;
  homeDir?: string;
}): TraceLogger {
  const dir = runsDir(options.homeDir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.trace`);
  const logger: TraceLogger = {
    path,
    write(section, content) {
      appendFileSync(path, `\n## ${section}\n${content.trimEnd()}\n`, "utf8");
    }
  };
  logger.write(
    "run",
    [
      `cwd: ${options.cwd}`,
      `profile: ${options.profileName}`,
      `adapter: ${options.profile.adapter}`,
      `model: ${options.profile.model}`,
      `danger_review: ${options.runtime.dangerReview}`,
      `system_prompt_chars: ${options.systemPrompt.length}`
    ].join("\n")
  );
  return logger;
}
