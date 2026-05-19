import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProfileConfig, RuntimeConfig } from "./config.js";
import { addUsageCost, formatUsageCost, summarizeUsage, type TokenUsageCost } from "./cost.js";
import { reviewDangerousCommand } from "./danger-review.js";
import { createProviderDebugJsonLogger } from "./provider-debug.js";
import { completeWithProfile, ProviderError, type ProviderFetch } from "./providers/index.js";
import type { SmithModelResponse, SmithProviderState } from "./providers/types.js";
import { PtyShellRunner } from "./pty.js";
import { summarizeProviderEvents } from "./session-log.js";
import {
  appendChatIn,
  appendProviderTerminalTurn,
  appendProviderUserObservation,
  appendTerminalTurn,
  compactProviderMessages,
  compactTranscript,
  providerMessagesToMessages,
  transcriptToProviderMessages,
  transcriptToMessages,
  type TranscriptEntry
} from "./transcript.js";
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
  reloadSystemPrompt?: () => string;
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
  let transcript = options.initialTranscript ?? initialTranscript(options.cwd, options.prompt);
  let providerMessages = transcriptToProviderMessages(transcript);
  let systemPrompt = options.systemPrompt;
  let totalUsage: TokenUsageCost | undefined;
  let statefulResponses = options.profile.statefulResponses;
  let previousResponseId: string | undefined;
  let previousToolCallId: string | undefined;
  let pendingStatefulOutput: string | undefined;
  const promptCacheKey = resolvePromptCacheKey(options.profile, options.cwd, options.prompt);
  const providerMessageChain = options.runtime.providerMessageChain;
  const providerDebugJson =
    options.runtime.providerDebug && options.trace ? createProviderDebugJsonLogger(options.trace.path) : undefined;
  if (providerDebugJson) options.trace?.write("provider debug", `path: ${providerDebugJson.path}`);
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
      const statefulTurn = Boolean(statefulResponses && previousResponseId);
      const providerState = providerStateForTurn({
        statefulResponses,
        previousResponseId,
        previousToolCallId,
        pendingStatefulOutput,
        promptCacheKey,
        promptCacheRetention: options.profile.promptCacheRetention
      });
      const response = await completeModelTurn({
        options,
        systemPrompt,
        transcript,
        providerMessages,
        providerMessageChain,
        statefulTurn,
        providerState,
        debugJson: providerDebugJson?.write
      }).catch(async (error: unknown) => {
        if (!statefulTurn || !isProviderStateFallbackError(error)) throw error;
        statefulResponses = false;
        previousResponseId = undefined;
        previousToolCallId = undefined;
        pendingStatefulOutput = undefined;
        options.trace?.write("provider state disabled", `turn: ${turn}\nreason: ${errorMessage(error)}`);
        return completeModelTurn({
          options,
          systemPrompt,
          transcript,
          providerMessages,
          providerMessageChain,
          statefulTurn: false,
          providerState: providerStateForTurn({
            statefulResponses: false,
            promptCacheKey,
            promptCacheRetention: options.profile.promptCacheRetention
          }),
          debugJson: providerDebugJson?.write
        });
      });
      if (statefulResponses) {
        const nextState = response.providerState;
        if (nextState?.previousResponseId) {
          previousResponseId = nextState.previousResponseId;
          previousToolCallId = nextState.previousToolCallId;
          options.trace?.write(
            "provider state",
            [
              `turn: ${turn}`,
              `previous_response_id: ${previousResponseId}`,
              previousToolCallId ? `previous_tool_call_id: ${previousToolCallId}` : "previous_tool_call_id: (none)"
            ].join("\n")
          );
        } else {
          statefulResponses = false;
          previousResponseId = undefined;
          previousToolCallId = undefined;
          pendingStatefulOutput = undefined;
          options.trace?.write("provider state disabled", `turn: ${turn}\nreason: provider response did not include id`);
        }
      }
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
        providerMessages = appendProviderTerminalTurn(providerMessages, response.text, blockedOutput);
        pendingStatefulOutput = blockedOutput;
        options.trace?.write("terminal output", blockedOutput);
        options.onTerminalOutput?.(blockedOutput);
        continue;
      }

      const result = await shell.run(response.text, options.runtime.timeoutMs);
      const terminalOutput = formatTerminalOutput(result.output, result.exitCode);
      transcript = appendTerminalTurn(transcript, result.command, terminalOutput);
      providerMessages = appendProviderTerminalTurn(providerMessages, result.command, terminalOutput);
      pendingStatefulOutput = terminalOutput;
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
        providerMessages = appendProviderUserObservation(providerMessages, timeoutOutput);
        pendingStatefulOutput = [pendingStatefulOutput, timeoutOutput].filter(Boolean).join("\n");
        options.trace?.write("timeout", timeoutOutput);
        options.onTerminalOutput?.(timeoutOutput);
      }
      const compactedTranscript = compactTranscript(transcript, {
        keepTurns: options.runtime.transcriptTurns,
        maxSummaryChars: options.runtime.transcriptCompactionChars,
        minChars: options.runtime.transcriptCompactionMinChars,
        hysteresisTurns: options.runtime.transcriptCompactionHysteresisTurns
      });
      if (compactedTranscript !== transcript) {
        const beforeChars = transcript.length;
        transcript = compactedTranscript;
        providerMessages = compactProviderMessages(providerMessages, {
          keepTurns: options.runtime.transcriptTurns,
          maxSummaryChars: options.runtime.transcriptCompactionChars
        });
        options.trace?.write(
          "transcript compacted",
          [
            `turn: ${turn}`,
            `chars_before: ${beforeChars}`,
            `chars_after: ${transcript.length}`,
            `keep_turns: ${options.runtime.transcriptTurns}`,
            `min_chars: ${options.runtime.transcriptCompactionMinChars}`,
            `hysteresis_turns: ${options.runtime.transcriptCompactionHysteresisTurns}`
          ].join("\n")
        );
      } else {
        transcript = compactedTranscript;
      }
    }
  } finally {
    process.off("SIGINT", killShell);
    process.off("SIGTERM", killShell);
    shell.kill();
  }

  throw new Error(`model did not call chat_out within ${maxTurns} turns`);
}

async function completeModelTurn(context: {
  options: SmithRunOptions;
  systemPrompt: string;
  transcript: string;
  providerMessages: TranscriptEntry[];
  providerMessageChain: boolean;
  statefulTurn: boolean;
  providerState?: SmithProviderState;
  debugJson?: (record: Record<string, unknown>) => void;
}): Promise<SmithModelResponse> {
  const messages =
    context.statefulTurn && context.providerState?.previousResponseId
      ? providerMessagesToMessages(
          context.systemPrompt,
          [{ role: "user", content: context.providerState.toolOutput || "(no terminal output)" }],
          context.options.runtime.maxContextChars
        )
      : context.providerMessageChain
        ? providerMessagesToMessages(
            context.systemPrompt,
            context.providerMessages,
            context.options.runtime.maxContextChars
          )
        : transcriptToMessages(context.systemPrompt, context.transcript, context.options.runtime.maxContextChars);
  return completeWithProfile(
    {
      model: context.options.profile.model,
      messages,
      providerState: context.providerState
    },
    context.options.profile,
    {
      env: context.options.env,
      fetch: context.options.fetch,
      retries: context.options.runtime.providerRetries,
      retryDelayMs: context.options.runtime.providerRetryDelayMs,
      debugLog: context.options.runtime.providerDebug
        ? (section, content) => context.options.trace?.write(section, content)
        : undefined,
      debugJson: context.debugJson
    }
  );
}

function isProviderStateFallbackError(error: unknown): boolean {
  return error instanceof ProviderError && (error.status === 400 || error.status === 404);
}

function providerStateForTurn(options: {
  statefulResponses: boolean;
  previousResponseId?: string;
  previousToolCallId?: string;
  pendingStatefulOutput?: string;
  promptCacheKey?: string;
  promptCacheRetention?: "in_memory" | "24h";
}): SmithProviderState | undefined {
  if (!options.statefulResponses && !options.promptCacheKey && !options.promptCacheRetention) return undefined;
  return {
    statefulResponses: options.statefulResponses || undefined,
    previousResponseId: options.previousResponseId,
    previousToolCallId: options.previousToolCallId,
    toolOutput: options.pendingStatefulOutput,
    promptCacheKey: options.promptCacheKey,
    promptCacheRetention: options.promptCacheRetention
  };
}

function resolvePromptCacheKey(profile: ProfileConfig, cwd: string, prompt: string): string | undefined {
  if (profile.promptCacheKey && profile.promptCacheKey !== "auto") return profile.promptCacheKey;
  if (profile.promptCacheKey === "auto" || profile.statefulResponses) return promptCacheKeyForRun(profile, cwd, prompt);
  return undefined;
}

function promptCacheKeyForRun(profile: ProfileConfig, cwd: string, prompt: string): string {
  const hash = createHash("sha256").update([profile.adapter, profile.model, cwd, prompt].join("\0")).digest("hex");
  const chars = hash.slice(0, 32).split("");
  chars[12] = "4";
  chars[16] = (8 + (Number.parseInt(chars[16], 16) % 4)).toString(16);
  const uuid = chars.join("");
  return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function initialTranscript(cwd: string, prompt: string): string {
  return `${appendChatIn(prompt)}\n${memoryFilePresence(cwd)}`;
}

function memoryFilePresence(cwd: string): string {
  const projectMemory = existsSync(join(cwd, "SMITH.md"));
  const taskMemory = existsSync(join(cwd, "SMITH.TASK.md"));
  if (!projectMemory && !taskMemory) return "smith$ # memory files\nNo local SMITH.md or SMITH.TASK.md found.";

  return [
    "smith$ # memory files",
    projectMemory ? "Local SMITH.md exists; read it with cat SMITH.md before broad inspection." : "No local SMITH.md found.",
    taskMemory ? "Local SMITH.TASK.md exists; read it with cat SMITH.TASK.md before broad inspection." : "No local SMITH.TASK.md found."
  ].join("\n");
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
