import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("vitest config", () => {
  it("keeps retained benchmark sandboxes out of the default test run", () => {
    const config = readFileSync(join(process.cwd(), "vitest.config.ts"), "utf8");

    expect(config).toContain('include: ["tests/**/*.test.ts"]');
    expect(config).toContain('".smith-bench/**"');
  });
});
