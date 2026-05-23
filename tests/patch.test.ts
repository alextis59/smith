import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySmithPatch, parseSmithPatch } from "../src/patch.js";

describe("smith_patch", () => {
  it("adds, updates, and deletes files", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "old.txt"), "remove\n", "utf8");
    applySmithPatch(
      `*** Begin Patch
*** Add File: added.txt
+hello
*** Update File: old.txt
@@
-remove
+kept
*** Delete File: added.txt
*** End Patch`,
      cwd
    );

    expect(readFileSync(join(cwd, "old.txt"), "utf8")).toBe("kept\n");
    expect(existsSync(join(cwd, "added.txt"))).toBe(false);
  });

  it("rejects malformed patches", () => {
    expect(() => parseSmithPatch("*** Begin Patch\n*** End Patch")).toThrow("no operations");
    expect(() =>
      applySmithPatch(
        `*** Begin Patch
*** Add File: ../escape.txt
+bad
*** End Patch`,
        tempDir()
      )
    ).toThrow("escapes workspace");
  });

  it("fails when update context cannot be found", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "file.txt"), "actual\n", "utf8");
    expect(() =>
      applySmithPatch(
        `*** Begin Patch
*** Update File: file.txt
@@
-missing
+new
*** End Patch`,
        cwd
      )
    ).toThrow("hunk context not found");
  });

  it("reports visible whitespace details when indentation-insensitive context is ambiguous", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "file.txt"), "\t\talpha\n\t\tbeta\nmiddle\n\t\talpha\n\t\tbeta\n", "utf8");

    expect(() =>
      applySmithPatch(
        `*** Begin Patch
*** Update File: file.txt
@@
-	alpha
-	beta
+	alpha
+	gamma
*** End Patch`,
        cwd
      )
    ).toThrow(/indentation-insensitive context matched 2 locations[\s\S]*patch line 1: tabs=1 spaces=0[\s\S]*file  line 1: tabs=2 spaces=0/);
  });

  it("applies a unique indentation-insensitive hunk and preserves the file indentation", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "file.txt"), "before\n\t\talpha\n\t\tbeta\n", "utf8");

    applySmithPatch(
      `*** Begin Patch
*** Update File: file.txt
@@
-	alpha
-	beta
+	alpha
+		child
*** End Patch`,
      cwd
    );

    expect(readFileSync(join(cwd, "file.txt"), "utf8")).toBe("before\n\t\talpha\n\t\t\tchild\n");
  });

  it("does not leave partial changes when a later operation fails", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "first.txt"), "old\n", "utf8");
    writeFileSync(join(cwd, "second.txt"), "actual\n", "utf8");

    expect(() =>
      applySmithPatch(
        `*** Begin Patch
*** Update File: first.txt
@@
-old
+new
*** Update File: second.txt
@@
-missing
+changed
*** End Patch`,
        cwd
      )
    ).toThrow("hunk context not found");

    expect(readFileSync(join(cwd, "first.txt"), "utf8")).toBe("old\n");
    expect(readFileSync(join(cwd, "second.txt"), "utf8")).toBe("actual\n");
  });

  it("applies repeated update contexts in file order instead of matching earlier replacements", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "file.txt"), "section\nvalue\nsection\nvalue\n", "utf8");

    applySmithPatch(
      `*** Begin Patch
*** Update File: file.txt
@@
 section
 value
+first
@@
 section
 value
+second
*** End Patch`,
      cwd
    );

    expect(readFileSync(join(cwd, "file.txt"), "utf8")).toBe("section\nvalue\nfirst\nsection\nvalue\nsecond\n");
  });
});

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "smith-patch-"));
}
