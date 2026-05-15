import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PtyShellRunner } from "../src/pty.js";

describe("PTY shell runner", () => {
  it("runs shell commands and captures chat_out", async () => {
    const runner = await PtyShellRunner.start({
      cwd: mkdtempSync(join(tmpdir(), "smith-pty-")),
      shell: "bash",
      timeoutMs: 2000
    });
    try {
      const echo = await runner.run("echo hello", 2000);
      expect(echo.output).toContain("hello");

      const result = await runner.run("chat_out done", 2000);
      expect(result.chatOut).toBe("done");
      expect(result.output).toContain("done");
      expect(result.output).not.toContain("__SMITH_CHAT_OUT_START__");
    } finally {
      runner.kill();
    }
  });
});
