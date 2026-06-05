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
  return [
    "# SMITH.TASK.md",
    "",
    "Ephemeral task memory for this Smith run. Keep it concise and factual.",
    "",
    "## Current Task",
    summarizeInitialTask(task),
    "",
    "## Working Set",
    "- Important files/functions: (unknown yet)",
    "- Current hypothesis: (unknown yet)",
    "- Verifier or local check: (unknown yet)",
    "",
    "## Decisions And Constraints",
    "- Keep durable project guidance in SMITH.md; keep task-specific state here.",
    "",
    "## Next Steps",
    "- Inspect the task and workspace first.",
    "- For long or broad investigations, update the Working Set with important files, the current hypothesis, verifier status, and next edit."
  ].join("\n") + "\n";
}

function summarizeInitialTask(task?: string): string {
  const trimmedTask = task?.trim();
  if (!trimmedTask) return "(interactive Smith session)";
  return [
    "(initial request is preserved in the first user input transcript; do not copy it here)",
    "If this run becomes long enough to need task memory, replace this with a one-line objective."
  ].join("\n");
}
