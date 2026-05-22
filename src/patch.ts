import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { mkdirSync } from "node:fs";

export type PatchResult = {
  changedFiles: string[];
};

type Operation =
  | { type: "add"; path: string; lines: string[] }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; hunks: Hunk[] };

type Hunk = {
  oldLines: string[];
  newLines: string[];
};

type StagedFile = {
  content?: string;
};

export function applySmithPatch(patch: string, cwd = process.cwd()): PatchResult {
  const operations = parseSmithPatch(patch);
  const changedFiles: string[] = [];
  const staged = new Map<string, StagedFile>();

  for (const operation of operations) {
    const file = resolvePatchPath(cwd, operation.path);
    if (operation.type === "add") {
      if (readStagedOrFile(staged, file) !== undefined) throw new Error(`file already exists: ${operation.path}`);
      staged.set(file, { content: `${operation.lines.join("\n")}${operation.lines.length ? "\n" : ""}` });
      changedFiles.push(operation.path);
      continue;
    }

    if (operation.type === "delete") {
      if (readStagedOrFile(staged, file) === undefined) throw new Error(`file does not exist: ${operation.path}`);
      staged.set(file, {});
      changedFiles.push(operation.path);
      continue;
    }

    const current = readStagedOrFile(staged, file);
    if (current === undefined) throw new Error(`file does not exist: ${operation.path}`);
    const content = applyUpdateHunks(current, operation.path, operation.hunks);
    staged.set(file, { content });
    changedFiles.push(operation.path);
  }

  for (const [file, change] of staged) {
    if (change.content === undefined) {
      if (existsSync(file)) rmSync(file);
      continue;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, change.content, "utf8");
  }

  return { changedFiles };
}

function readStagedOrFile(staged: Map<string, StagedFile>, file: string): string | undefined {
  if (staged.has(file)) return staged.get(file)?.content;
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

function applyUpdateHunks(initialContent: string, path: string, hunks: Hunk[]): string {
  let content = initialContent;
  let cursor = 0;
  for (const [index, hunk] of hunks.entries()) {
    const oldBlock = hunk.oldLines.join("\n");
    const newBlock = hunk.newLines.join("\n");
    const oldWithNewline = `${oldBlock}\n`;
    const newWithNewline = `${newBlock}\n`;
    if (!oldBlock) {
      content = `${content.slice(0, cursor)}${newWithNewline}${content.slice(cursor)}`;
      cursor += newWithNewline.length;
      continue;
    }

    const withNewlineIndex = content.indexOf(oldWithNewline, cursor);
    if (withNewlineIndex !== -1) {
      content = `${content.slice(0, withNewlineIndex)}${newWithNewline}${content.slice(withNewlineIndex + oldWithNewline.length)}`;
      cursor = withNewlineIndex + newWithNewline.length;
      continue;
    }

    const blockIndex = content.indexOf(oldBlock, cursor);
    if (blockIndex !== -1) {
      content = `${content.slice(0, blockIndex)}${newBlock}${content.slice(blockIndex + oldBlock.length)}`;
      cursor = blockIndex + newBlock.length;
      continue;
    }

    throw new Error(`hunk context not found in ${path} (hunk ${index + 1})`);
  }
  return content;
}

export function parseSmithPatch(patch: string): Operation[] {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  if (lines[index] !== "*** Begin Patch") throw new Error("patch must start with *** Begin Patch");
  index += 1;
  const operations: Operation[] = [];

  while (index < lines.length) {
    const line = lines[index];
    if (line === "*** End Patch" || line === "") break;
    if (line.startsWith("*** Add File: ")) {
      const path = line.slice("*** Add File: ".length);
      const addLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("*** ")) {
        if (!lines[index].startsWith("+")) throw new Error(`add file lines must start with +: ${path}`);
        addLines.push(lines[index].slice(1));
        index += 1;
      }
      operations.push({ type: "add", path, lines: addLines });
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      operations.push({ type: "delete", path: line.slice("*** Delete File: ".length) });
      index += 1;
      continue;
    }
    if (line.startsWith("*** Update File: ")) {
      const path = line.slice("*** Update File: ".length);
      const hunks: Hunk[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("*** ")) {
        if (lines[index] !== "@@" && !lines[index].startsWith("@@ ")) {
          throw new Error(`expected hunk marker in ${path}`);
        }
        index += 1;
        const hunk: Hunk = { oldLines: [], newLines: [] };
        while (index < lines.length && !lines[index].startsWith("@@") && !lines[index].startsWith("*** ")) {
          const hunkLine = lines[index];
          if (hunkLine.startsWith("-")) {
            hunk.oldLines.push(hunkLine.slice(1));
          } else if (hunkLine.startsWith("+")) {
            hunk.newLines.push(hunkLine.slice(1));
          } else if (hunkLine.startsWith(" ")) {
            hunk.oldLines.push(hunkLine.slice(1));
            hunk.newLines.push(hunkLine.slice(1));
          } else if (hunkLine === "") {
            hunk.oldLines.push("");
            hunk.newLines.push("");
          } else {
            throw new Error(`invalid hunk line in ${path}: ${hunkLine}`);
          }
          index += 1;
        }
        hunks.push(hunk);
      }
      operations.push({ type: "update", path, hunks });
      continue;
    }
    throw new Error(`unknown patch operation: ${line}`);
  }

  if (lines[index] !== "*** End Patch") throw new Error("patch must end with *** End Patch");
  if (operations.length === 0) throw new Error("patch contains no operations");
  return operations;
}

function resolvePatchPath(cwd: string, path: string): string {
  const resolved = resolve(cwd, path);
  const root = resolve(cwd);
  if (resolved !== root && !resolved.startsWith(`${root}/`)) {
    throw new Error(`patch path escapes workspace: ${path}`);
  }
  return resolved;
}
