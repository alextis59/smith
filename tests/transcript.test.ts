import { describe, expect, it } from "vitest";
import {
  appendChatIn,
  appendTerminalTurn,
  appendTranscriptObservation,
  compactTranscriptToTokenBudget,
  parseChatOutSentinel,
  stripShellFence,
  transcriptToMessages
} from "../src/transcript.js";

describe("transcript helpers", () => {
  it("strips shell fences only around full responses", () => {
    expect(stripShellFence("```bash\necho hi\n```")).toBe("echo hi");
    expect(stripShellFence("~~~sh\necho hi\n~~~")).toBe("echo hi");
    expect(stripShellFence("echo hi")).toBe("echo hi");
  });

  it("parses chat_out sentinels while preserving visible output", () => {
    const parsed = parseChatOutSentinel("hello\n__SMITH_CHAT_OUT_START__\nanswer\n__SMITH_CHAT_OUT_END__\n");
    expect(parsed.chatOut).toBe("answer");
    expect(parsed.output).toBe("hello\n\n");
  });

  it("formats user input and terminal turns", () => {
    expect(appendChatIn("hello")).toContain("smith$ # user input");
    expect(appendTerminalTurn("", "cat README.md", "smith")).toContain("smith$ cat README.md");
    expect(appendTranscriptObservation("", "tool reason", "run: inspect files")).toBe(
      "smith$ # tool reason\nrun: inspect files"
    );
  });

  it("keeps system prompt and truncates transcript to context budget", () => {
    const messages = transcriptToMessages("system", "a".repeat(80), 10);
    expect(messages[0]).toEqual({ role: "system", content: "system" });
    expect(messages[1].content).toBe("a".repeat(32));
  });

  it("keeps a user message even when the system prompt consumes the nominal budget", () => {
    const messages = transcriptToMessages("s".repeat(100), appendChatIn("Fix the task."), 10);

    expect(messages[0].role).toBe("system");
    expect(messages[1]).toEqual({ role: "user", content: appendChatIn("Fix the task.") });
  });

  it("preserves the initial user request when truncating long transcripts", () => {
    const transcript = [
      appendChatIn("Fix the benchmark bug."),
      appendTerminalTurn("", "sed -n '1,200p' big.go", "x".repeat(200)),
      appendTerminalTurn("", "sed -n '200,400p' big.go", "y".repeat(200))
    ].join("\n");

    const messages = transcriptToMessages("system", transcript, 130);
    expect(messages[1].content).toContain("Fix the benchmark bug.");
    expect(messages.some((message) => message.content.includes("Earlier terminal transcript omitted"))).toBe(true);
    expect(messages.at(-1)?.content).toContain("yyyy");
  });

  it("renders terminal turns as assistant commands followed by user terminal output", () => {
    const transcript = [
      appendChatIn("Fix the benchmark bug."),
      "smith$ # memory files\nNo local SMITH.md or SMITH.TASK.md found.",
      appendTerminalTurn("", "cat README.md", "small project")
    ].join("\n");

    const messages = transcriptToMessages("system", transcript, 10_000);

    expect(messages).toHaveLength(4);
    expect(messages[0]).toEqual({ role: "system", content: "system" });
    expect(messages[1].content).toContain("Fix the benchmark bug.");
    expect(messages[1].content).toContain("No local SMITH.md or SMITH.TASK.md found.");
    expect(messages[2]).toEqual({ role: "assistant", content: "cat README.md" });
    expect(messages[3]).toEqual({ role: "user", content: "small project" });
  });

  it("keeps compacted context notes with the stable prefix while truncating terminal tail", () => {
    const transcript = [
      appendChatIn("Fix the benchmark bug."),
      "smith$ # memory files\nNo local SMITH.md or SMITH.TASK.md found.",
      "smith$ # context compacted\nContext has been compacted.",
      appendTerminalTurn("", "sed -n '1,200p' big.go", "x".repeat(200)),
      appendTerminalTurn("", "sed -n '200,400p' big.go", "y".repeat(200))
    ].join("\n");

    const messages = transcriptToMessages("system", transcript, 160);

    expect(messages[0]).toEqual({ role: "system", content: "system" });
    expect(messages[1].content).toContain("Fix the benchmark bug.");
    expect(messages[1].content).toContain("No local SMITH.md or SMITH.TASK.md found.");
    expect(messages[1].content).toContain("Context has been compacted.");
    expect(messages.some((message) => message.content.includes("Earlier terminal transcript omitted"))).toBe(true);
    expect(messages.at(-2)).toEqual({ role: "assistant", content: "sed -n '200,400p' big.go" });
    expect(messages.at(-1)?.content).toContain("yyyy");
    expect(messages.some((message) => message.content.includes("sed -n '1,200p' big.go"))).toBe(false);
  });

  it("redacts older action parameters and results when the token threshold is reached", () => {
    const transcript = [
      appendChatIn("Implement the requested source change."),
      appendTranscriptObservation("", "tool reason", "run: inspect the file"),
      appendTerminalTurn("", "sed -n '1,200p' src/app.ts", "large output ".repeat(40)),
      appendTranscriptObservation("", "tool reason", "patch: apply the focused fix"),
      appendTerminalTurn("", "patch", "Applied patch to src/app.ts")
    ].join("\n");
    const result = compactTranscriptToTokenBudget(transcript, { maxTokens: 160, systemPrompt: "system" });

    expect(result.changed).toBe(true);
    expect(result.redactedActions).toBe(1);
    expect(result.transcript).toContain("Implement the requested source change.");
    expect(result.transcript).toContain("smith$ # compacted action\nrun: inspect the file");
    expect(result.transcript).toContain("smith$ # context compacted");
    expect(result.transcript).not.toContain("sed -n '1,200p'");
    expect(result.transcript).not.toContain("large output");
    expect(result.transcript).toContain("smith$ # tool reason\npatch: apply the focused fix");
    expect(result.transcript).toContain("smith$ patch\nApplied patch to src/app.ts");
  });

  it("preserves every user input while compacting actions", () => {
    const transcript = [
      appendChatIn("Implement the requested source change."),
      appendTranscriptObservation("", "tool reason", "run: first inspection"),
      appendTerminalTurn("", "cat first.txt", "x".repeat(300)),
      appendChatIn("Additional user constraint."),
      appendTranscriptObservation("", "tool reason", "run: second inspection"),
      appendTerminalTurn("", "cat second.txt", "y".repeat(300))
    ].join("\n");
    const result = compactTranscriptToTokenBudget(transcript, { maxTokens: 60, systemPrompt: "system" });

    expect(result.transcript).toContain("Implement the requested source change.");
    expect(result.transcript).toContain("Additional user constraint.");
    expect(result.transcript).not.toContain("cat first.txt");
    expect(result.transcript).toContain("cat second.txt");
  });

  it("removes oldest compacted actions when redaction still exceeds the token budget", () => {
    const transcript = [
      appendChatIn("Keep this user request."),
      appendTranscriptObservation("", "tool reason", `run: ${"first ".repeat(40)}`),
      appendTerminalTurn("", "first-command", "first output"),
      appendTranscriptObservation("", "tool reason", `run: ${"second ".repeat(40)}`),
      appendTerminalTurn("", "second-command", "second output"),
      appendTranscriptObservation("", "tool reason", `run: ${"third ".repeat(40)}`),
      appendTerminalTurn("", "third-command", "third output")
    ].join("\n");
    const result = compactTranscriptToTokenBudget(transcript, { maxTokens: 90, systemPrompt: "system" });

    expect(result.removedActions).toBeGreaterThan(0);
    expect(result.targetTokens).toBe(45);
    expect(result.transcript).toContain("Keep this user request.");
    expect(result.transcript).toContain("smith$ # context compacted");
    expect(result.transcript).not.toContain("first-command");
    expect(result.transcript).not.toContain("first output");
  });

  it("does not duplicate the context compaction notice", () => {
    const transcript = [
      appendChatIn("Keep this user request."),
      appendTranscriptObservation("", "tool reason", "run: inspect"),
      appendTerminalTurn("", "cat file.txt", "x".repeat(300))
    ].join("\n");
    const first = compactTranscriptToTokenBudget(transcript, { maxTokens: 40, systemPrompt: "system" });
    const secondTranscript = [
      first.transcript,
      appendTranscriptObservation("", "tool reason", "run: inspect another file"),
      appendTerminalTurn("", "cat other.txt", "y".repeat(300))
    ].join("\n");
    const second = compactTranscriptToTokenBudget(secondTranscript, { maxTokens: 40, systemPrompt: "system" });

    expect((second.transcript.match(/smith\$ # context compacted/g) ?? [])).toHaveLength(1);
    expect(second.transcript.endsWith("Rerun focused commands if those details are needed.")).toBe(true);
  });
});
