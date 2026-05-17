import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse as parsePath, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function loadSystemPrompt(cwd = process.cwd()): string {
  const basePrompt = readPackagedPrompt();
  const projectPrompt = findInstructionFile(cwd, "SMITH.md");
  const taskPrompt = findInstructionFile(cwd, "SMITH.TASK.md");
  return [
    basePrompt,
    projectPrompt ? `Project memory from SMITH.md:\n\n${projectPrompt}` : undefined,
    taskPrompt ? `Task memory from SMITH.TASK.md:\n\n${taskPrompt}` : undefined
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function findProjectInstructions(start: string): string | undefined {
  return findInstructionFile(start, "SMITH.md");
}

export function findInstructionFile(start: string, filename: string): string | undefined {
  let current = resolve(start);
  while (true) {
    const file = join(current, filename);
    if (existsSync(file)) return readFileSync(file, "utf8").trim();
    if (existsSync(join(current, ".git"))) return undefined;
    const parent = parsePath(current).dir;
    if (parent === current) return undefined;
    current = parent;
  }
}

function readPackagedPrompt(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "../../prompts/system.txt"), join(process.cwd(), "prompts/system.txt")];
  for (const file of candidates) {
    if (existsSync(file)) return readFileSync(file, "utf8").trim();
  }
  throw new Error("packaged system prompt not found");
}
