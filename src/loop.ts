import type { ProfileConfig, RuntimeConfig } from "./config.js";
import { addUsageCost, formatUsageCost, summarizeUsage, type TokenUsageCost } from "./cost.js";
import { reviewDangerousCommand } from "./danger-review.js";
import { completeWithProfile, type ProviderFetch } from "./providers/index.js";
import { PtyShellRunner } from "./pty.js";
import { summarizeProviderEvents } from "./session-log.js";
import { appendChatIn, appendTerminalTurn, compactTranscript, transcriptToMessages } from "./transcript.js";
import type { TraceLogger } from "./trace.js";

export type RunMode = "single" | "remote" | "interactive";

export type SmithRunOptions = {
  cwd: string;
  prompt: string;
  initialTranscript?: string;
  profile: ProfileConfig;
  reviewerProfile?: ProfileConfig;
  runtime: RuntimeConfig;
  systemPrompt: string;
  maxTurns?: number;
  env?: NodeJS.ProcessEnv;
  fetch?: ProviderFetch;
  onTerminalOutput?: (output: string) => void;
  onModelOutput?: (output: string) => void;
  trace?: TraceLogger;
};

export type SmithRunResult = {
  chatOut: string;
  turns: number;
  transcript: string;
  usage?: TokenUsageCost;
};

export async function runSmithTask(options: SmithRunOptions): Promise<SmithRunResult> {
  const maxTurns = options.maxTurns ?? options.runtime.maxTurns;
  let transcript = options.initialTranscript ?? appendChatIn(options.prompt);
  let totalUsage: TokenUsageCost | undefined;
  const shell = await PtyShellRunner.start({
    cwd: options.cwd,
    shell: options.runtime.shell,
    timeoutMs: options.runtime.timeoutMs,
    env: options.env
  });
  const killShell = (): void => shell.kill();
  process.once("SIGINT", killShell);
  process.once("SIGTERM", killShell);

  try {
    for (let turn = 1; turn <= maxTurns; turn += 1) {
      const response = await completeWithProfile(
        {
          model: options.profile.model,
          messages: transcriptToMessages(options.systemPrompt, transcript, options.runtime.maxContextChars)
        },
        options.profile,
        {
          env: options.env,
          fetch: options.fetch,
          retries: options.runtime.providerRetries,
          retryDelayMs: options.runtime.providerRetryDelayMs,
          debugLog: options.runtime.providerDebug
            ? (section, content) => options.trace?.write(section, content)
            : undefined
        }
      );
      const responseUsage = summarizeUsage(response.usage, options.profile);
      totalUsage = addUsageCost(totalUsage, responseUsage);
      if (responseUsage) options.trace?.write("model usage", formatUsageCost(responseUsage));
      options.trace?.write("model output", response.text);
      const parsedEvents = summarizeProviderEvents(response.raw);
      if (parsedEvents.length > 0) options.trace?.write("parsed events", JSON.stringify(parsedEvents, null, 2));
      options.onModelOutput?.(response.text);
      const review = await reviewDangerousCommand({
        command: response.text,
        cwd: options.cwd,
        recentTranscript: transcript,
        runtime: options.runtime,
        reviewerProfile: options.reviewerProfile,
        env: options.env,
        fetch: options.fetch
      });
      totalUsage = addUsageCost(totalUsage, review.usage);
      if (review.usage) options.trace?.write("danger review usage", formatUsageCost(review.usage));
      if (!review.allowed) {
        const blockedOutput = "Command too dangerous";
        transcript = appendTerminalTurn(transcript, response.text, blockedOutput);
        options.trace?.write("terminal output", blockedOutput);
        options.onTerminalOutput?.(blockedOutput);
        continue;
      }

      const result = await shell.run(response.text, options.runtime.timeoutMs);
      const terminalOutput = formatTerminalOutput(result.output, result.exitCode);
      transcript = appendTerminalTurn(transcript, result.command, terminalOutput);
      options.trace?.write("terminal output", terminalOutput);
      if (terminalOutput) options.onTerminalOutput?.(terminalOutput);
      if (result.chatOut !== undefined) {
        options.trace?.write("chat_out", result.chatOut);
        if (totalUsage) options.trace?.write("run usage", formatUsageCost(totalUsage));
        return { chatOut: result.chatOut, turns: turn, transcript, ...(totalUsage ? { usage: totalUsage } : {}) };
      }
      if (result.timedOut) {
        const timeoutOutput = formatTimeoutOutput(result.command, result.elapsedMs, result.lastOutput);
        transcript = appendTerminalTurn(transcript, "# timeout", timeoutOutput);
        options.trace?.write("timeout", timeoutOutput);
        options.onTerminalOutput?.(timeoutOutput);
      }
      transcript = compactTranscript(transcript, {
        keepTurns: options.runtime.transcriptTurns,
        maxSummaryChars: options.runtime.transcriptCompactionChars
      });
    }
  } finally {
    process.off("SIGINT", killShell);
    process.off("SIGTERM", killShell);
    shell.kill();
  }

  throw new Error(`model did not call chat_out within ${maxTurns} turns`);
}

function formatTimeoutOutput(command: string, elapsedMs: number, lastOutput: string): string {
  return [
    `Command timed out after ${elapsedMs}ms`,
    `Command running: ${command}`,
    lastOutput ? `Last terminal output:\n${lastOutput}` : "Last terminal output: (none)"
  ].join("\n");
}

function formatTerminalOutput(output: string, exitCode: number | undefined): string {
  if (exitCode === undefined) return output;
  const status = `exit_status: ${exitCode}`;
  return output.trim().length > 0 ? `${output.trimEnd()}\n${status}` : status;
}
