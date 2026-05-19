import { appendFileSync, writeFileSync } from "node:fs";

export type ProviderDebugJsonLogger = {
  path: string;
  write(record: Record<string, unknown>): void;
};

export function createProviderDebugJsonLogger(tracePath: string): ProviderDebugJsonLogger {
  const path = `${tracePath}.provider-debug.jsonl`;
  writeFileSync(path, "", "utf8");
  return {
    path,
    write(record) {
      appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`, "utf8");
    }
  };
}
