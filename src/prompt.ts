import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse as parsePath, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function loadSystemPrompt(cwd = process.cwd()): string {
  const basePrompt = readPackagedPrompt();
  const projectPrompt = findProjectInstructions(cwd);
  return projectPrompt ? `${basePrompt}\n\nProject instructions from SMITH.md:\n\n${projectPrompt}` : basePrompt;
}

export function findProjectInstructions(start: string): string | undefined {
  let current = resolve(start);
  while (true) {
    const file = join(current, "SMITH.md");
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
