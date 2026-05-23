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

type LineSpan = {
  line: string;
  start: number;
  end: number;
  hasNewline: boolean;
  lineNumber: number;
};

type IndentDelta =
  | { type: "none" }
  | { type: "add"; value: string }
  | { type: "remove"; value: string };

type IndentInsensitiveCandidate = {
  start: number;
  end: number;
  hasTrailingNewline: boolean;
  lineNumber: number;
  lines: string[];
  indentDelta?: IndentDelta;
  unsafeReason?: string;
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

    const candidates = findIndentInsensitiveCandidates(content, hunk.oldLines, cursor);
    const candidate = candidates.length === 1 ? candidates[0] : undefined;
    const indentDelta = candidate?.indentDelta;
    if (candidate && indentDelta && !candidate.unsafeReason) {
      const adjustedNewLines = adjustNewLinesIndent(hunk.newLines, hunk.oldLines, indentDelta);
      if (adjustedNewLines) {
        const replacement = `${adjustedNewLines.join("\n")}${candidate.hasTrailingNewline ? "\n" : ""}`;
        content = `${content.slice(0, candidate.start)}${replacement}${content.slice(candidate.end)}`;
        cursor = candidate.start + replacement.length;
        continue;
      }
      candidate.unsafeReason = "new lines could not be safely reindented";
    }

    throw new Error(hunkFailureMessage(content, path, hunk, index, cursor, candidates));
  }
  return content;
}

function findIndentInsensitiveCandidates(content: string, oldLines: string[], cursor: number): IndentInsensitiveCandidate[] {
  if (oldLines.length === 0) return [];
  const spans = lineSpans(content);
  const startIndex = spans.findIndex((span) => span.end > cursor);
  if (startIndex === -1) return [];
  const candidates: IndentInsensitiveCandidate[] = [];
  for (let index = startIndex; index <= spans.length - oldLines.length; index += 1) {
    const window = spans.slice(index, index + oldLines.length);
    if (!oldLines.every((line, offset) => stripLeadingWhitespace(line) === stripLeadingWhitespace(window[offset].line))) {
      continue;
    }
    const indentDelta = inferIndentDelta(oldLines, window.map((span) => span.line));
    const candidate: IndentInsensitiveCandidate = {
      start: window[0].start,
      end: window[window.length - 1].end,
      hasTrailingNewline: window[window.length - 1].hasNewline,
      lineNumber: window[0].lineNumber,
      lines: window.map((span) => span.line)
    };
    if (indentDelta) {
      candidate.indentDelta = indentDelta;
    } else {
      candidate.unsafeReason = "leading whitespace differs inconsistently";
    }
    candidates.push(candidate);
  }
  return candidates;
}

function lineSpans(content: string): LineSpan[] {
  const spans: LineSpan[] = [];
  let start = 0;
  let lineNumber = 1;
  while (start < content.length) {
    const newline = content.indexOf("\n", start);
    if (newline === -1) {
      spans.push({ line: content.slice(start), start, end: content.length, hasNewline: false, lineNumber });
      break;
    }
    spans.push({ line: content.slice(start, newline), start, end: newline + 1, hasNewline: true, lineNumber });
    start = newline + 1;
    lineNumber += 1;
  }
  return spans;
}

function inferIndentDelta(oldLines: string[], actualLines: string[]): IndentDelta | undefined {
  let delta: IndentDelta | undefined;
  for (let index = 0; index < oldLines.length; index += 1) {
    const expected = oldLines[index];
    const actual = actualLines[index];
    if (stripLeadingWhitespace(expected).length === 0) continue;
    const expectedIndent = leadingWhitespace(expected);
    const actualIndent = leadingWhitespace(actual);
    const nextDelta = compareIndent(expectedIndent, actualIndent);
    if (!nextDelta || nextDelta.type === "none") continue;
    if (!delta) {
      delta = nextDelta;
      continue;
    }
    if (delta.type !== nextDelta.type || ("value" in delta && "value" in nextDelta && delta.value !== nextDelta.value)) {
      return undefined;
    }
  }
  return delta ?? { type: "none" };
}

function compareIndent(expected: string, actual: string): IndentDelta | undefined {
  if (expected === actual) return { type: "none" };
  if (actual.startsWith(expected)) return { type: "add", value: actual.slice(expected.length) };
  if (expected.startsWith(actual)) return { type: "remove", value: expected.slice(actual.length) };
  return undefined;
}

function adjustNewLinesIndent(newLines: string[], oldLines: string[], delta: IndentDelta): string[] | undefined {
  if (delta.type === "none") return newLines;
  const commonIndent = commonLeadingWhitespace(oldLines);
  const adjusted: string[] = [];
  for (const line of newLines) {
    if (stripLeadingWhitespace(line).length === 0) {
      adjusted.push(line);
      continue;
    }
    if (delta.type === "add") {
      if (!leadingWhitespace(line).startsWith(commonIndent)) return undefined;
      adjusted.push(`${delta.value}${line}`);
      continue;
    }
    if (!line.startsWith(delta.value)) return undefined;
    adjusted.push(line.slice(delta.value.length));
  }
  return adjusted;
}

function commonLeadingWhitespace(lines: string[]): string {
  const indents = lines
    .filter((line) => stripLeadingWhitespace(line).length > 0)
    .map(leadingWhitespace);
  if (indents.length === 0) return "";
  let prefix = indents[0];
  for (const indent of indents.slice(1)) {
    while (!indent.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return "";
    }
  }
  return prefix;
}

function hunkFailureMessage(
  content: string,
  path: string,
  hunk: Hunk,
  index: number,
  cursor: number,
  candidates: IndentInsensitiveCandidate[]
): string {
  const lines = [`hunk context not found in ${path} (hunk ${index + 1})`];
  const nearest = candidates[0] ?? nearestLineWindow(content, hunk.oldLines, cursor);
  if (candidates.length > 1) {
    lines.push(`indentation-insensitive context matched ${candidates.length} locations; refusing ambiguous fallback`);
  } else if (candidates.length === 1 && candidates[0].unsafeReason) {
    lines.push(`indentation-insensitive context matched line ${candidates[0].lineNumber}, but ${candidates[0].unsafeReason}`);
  } else if (candidates.length === 0 && nearest) {
    lines.push(`nearest partial context starts at line ${nearest.lineNumber}`);
  }
  if (nearest) {
    lines.push(...formatWhitespaceComparison(hunk.oldLines, nearest.lines, nearest.lineNumber));
    lines.push(`tip: inspect exact leading whitespace with: sed -n '${nearest.lineNumber},${nearest.lineNumber + nearest.lines.length - 1}p' ${path} | cat -vet`);
  }
  return lines.join("\n");
}

function nearestLineWindow(content: string, oldLines: string[], cursor: number): IndentInsensitiveCandidate | undefined {
  if (oldLines.length === 0) return undefined;
  const spans = lineSpans(content);
  const startIndex = spans.findIndex((span) => span.end > cursor);
  if (startIndex === -1) return undefined;
  let best: { score: number; window: LineSpan[] } | undefined;
  for (let index = startIndex; index <= spans.length - oldLines.length; index += 1) {
    const window = spans.slice(index, index + oldLines.length);
    const score = oldLines.reduce(
      (total, line, offset) => total + (stripLeadingWhitespace(line) === stripLeadingWhitespace(window[offset].line) ? 1 : 0),
      0
    );
    if (score > 0 && (!best || score > best.score)) best = { score, window };
  }
  if (!best) return undefined;
  return {
    start: best.window[0].start,
    end: best.window[best.window.length - 1].end,
    hasTrailingNewline: best.window[best.window.length - 1].hasNewline,
    lineNumber: best.window[0].lineNumber,
    lines: best.window.map((span) => span.line)
  };
}

function formatWhitespaceComparison(oldLines: string[], actualLines: string[], firstLineNumber: number): string[] {
  const limit = Math.min(oldLines.length, actualLines.length, 6);
  const output = ["leading whitespace comparison:"];
  for (let index = 0; index < limit; index += 1) {
    const expected = oldLines[index];
    const actual = actualLines[index];
    output.push(`patch line ${index + 1}: ${whitespaceSummary(expected)} ${JSON.stringify(stripLeadingWhitespace(expected))}`);
    output.push(`file  line ${firstLineNumber + index}: ${whitespaceSummary(actual)} ${JSON.stringify(stripLeadingWhitespace(actual))}`);
  }
  if (oldLines.length > limit) output.push(`... ${oldLines.length - limit} more hunk lines omitted`);
  return output;
}

function whitespaceSummary(line: string): string {
  const indent = leadingWhitespace(line);
  const tabs = [...indent].filter((char) => char === "\t").length;
  const spaces = [...indent].filter((char) => char === " ").length;
  return `tabs=${tabs} spaces=${spaces}`;
}

function leadingWhitespace(line: string): string {
  return /^[\t ]*/.exec(line)?.[0] ?? "";
}

function stripLeadingWhitespace(line: string): string {
  return line.replace(/^[\t ]+/, "");
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
