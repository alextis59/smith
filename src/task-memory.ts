import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const TASK_MEMORY_FILE = "SMITH.TASK.md";
const MAX_INITIAL_TASK_CHARS = 1600;

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
  const taskSummary = summarizeInitialTask(task);
  return [
    "# SMITH.TASK.md",
    "",
    "Ephemeral task memory for this Smith run. Keep it concise and factual.",
    "",
    "## Current Task",
    taskSummary,
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
    "- Inspect the task, identify likely source files, then replace the unknown entries above before broad further investigation."
  ].join("\n") + "\n";
}

function summarizeInitialTask(task?: string): string {
  const trimmedTask = task?.trim();
  if (!trimmedTask) return "(interactive Smith session)";
  if (trimmedTask.length <= MAX_INITIAL_TASK_CHARS) return trimmedTask;
  return [
    trimmedTask.slice(0, MAX_INITIAL_TASK_CHARS).trimEnd(),
    "",
    `(...initial task truncated in SMITH.TASK.md; continue using the preserved initial chat_in for the full request.)`
  ].join("\n");
}
