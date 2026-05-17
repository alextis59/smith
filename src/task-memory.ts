import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const TASK_MEMORY_FILE = "SMITH.TASK.md";

export type TaskMemoryHandle = {
  path: string;
  created: boolean;
};

export function ensureTaskMemoryFile(cwd: string, task?: string): TaskMemoryHandle {
  const path = join(cwd, TASK_MEMORY_FILE);
  if (existsSync(path)) return { path, created: false };

  writeFileSync(path, initialTaskMemory(task), "utf8");
  return { path, created: true };
}

export function cleanupTaskMemoryFile(handle: TaskMemoryHandle | undefined): void {
  if (!handle?.created) return;
  rmSync(handle.path, { force: true });
}

function initialTaskMemory(task?: string): string {
  const trimmedTask = task?.trim();
  return [
    "# SMITH.TASK.md",
    "",
    "Ephemeral task memory for this Smith run. Keep it concise and factual.",
    "",
    "## Current Task",
    trimmedTask || "(interactive Smith session)",
    "",
    "## Essential Context",
    "- Add only stable project/task facts that future turns or child agents need.",
    "",
    "## Decisions And Constraints",
    "- Keep durable project guidance in SMITH.md; keep task-specific state here.",
    "",
    "## Next Steps",
    "- Update this file only when a meaningful stable fact, decision, or next step changes."
  ].join("\n") + "\n";
}
