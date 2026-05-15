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

export function applySmithPatch(patch: string, cwd = process.cwd()): PatchResult {
  const operations = parseSmithPatch(patch);
  const changedFiles: string[] = [];

  for (const operation of operations) {
    const file = resolvePatchPath(cwd, operation.path);
    if (operation.type === "add") {
      if (existsSync(file)) throw new Error(`file already exists: ${operation.path}`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${operation.lines.join("\n")}${operation.lines.length ? "\n" : ""}`, "utf8");
      changedFiles.push(operation.path);
      continue;
    }

    if (operation.type === "delete") {
      if (!existsSync(file)) throw new Error(`file does not exist: ${operation.path}`);
      rmSync(file);
      changedFiles.push(operation.path);
      continue;
    }

    if (!existsSync(file)) throw new Error(`file does not exist: ${operation.path}`);
    let content = readFileSync(file, "utf8");
    for (const hunk of operation.hunks) {
      const oldBlock = hunk.oldLines.join("\n");
      const newBlock = hunk.newLines.join("\n");
      const oldWithNewline = `${oldBlock}\n`;
      const newWithNewline = `${newBlock}\n`;
      if (oldBlock && content.includes(oldWithNewline)) {
        content = content.replace(oldWithNewline, newWithNewline);
      } else if (oldBlock && content.includes(oldBlock)) {
        content = content.replace(oldBlock, newBlock);
      } else if (!oldBlock) {
        content = `${newWithNewline}${content}`;
      } else {
        throw new Error(`hunk context not found in ${operation.path}`);
      }
    }
    writeFileSync(file, content, "utf8");
    changedFiles.push(operation.path);
  }

  return { changedFiles };
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
