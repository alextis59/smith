import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ProfileConfig, RuntimeConfig } from "./config.js";
import { addUsageCost, formatUsageCost, summarizeUsage, type TokenUsageCost } from "./cost.js";
import { reviewDangerousCommand } from "./danger-review.js";
import { applySmithPatch } from "./patch.js";
import { createProviderDebugJsonLogger } from "./provider-debug.js";
import { completeWithProfile, ProviderError, type ProviderFetch } from "./providers/index.js";
import { smithToolName, SMITH_TOOLS, toolBooleanArgument, toolReason, toolTextArgument } from "./providers/tools.js";
import type { SmithModelResponse, SmithProviderState, SmithToolCall } from "./providers/types.js";
import { PtyShellRunner } from "./pty.js";
import { summarizeProviderEvents } from "./session-log.js";
import {
  appendChatIn,
  appendProviderTerminalTurn,
  appendProviderUserObservation,
  appendTerminalTurn,
  appendTranscriptObservation,
  compactTranscriptToTokenBudget,
  providerMessagesToMessages,
  transcriptToProviderMessages,
  type TranscriptEntry
} from "./transcript.js";
import type { TraceLogger } from "./trace.js";

export type RunMode = "single" | "remote" | "interactive";

const MAX_SUB_AGENT_DEPTH = 2;
const RIPGREP_CHECK_TIMEOUT_MS = 5_000;
const RIPGREP_BOOTSTRAP_MAX_TURNS = 6;
const PROGRESS_REMINDER_TOOL_INTERVAL = 12;
const RUN_DEADLINE_REMINDER_THRESHOLDS = [0.75, 0.9] as const;
const RIPGREP_UNAVAILABLE_PROMPT_NOTE =
  "Environment note: the `rg` command is not available in this environment. Smith already checked at startup and, when allowed, attempted a straightforward install without confirming `rg` on PATH. Use grep, find, or language-specific tools instead, and do not spend task time trying to install `rg` unless the user explicitly asks.";

const execFileAsync = promisify(execFile);

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
  subAgentDepth?: number;
  initialUsage?: TokenUsageCost;
};

export type SmithRunResult = {
  chatOut: string;
  turns: number;
  transcript: string;
  usage?: TokenUsageCost;
};

export class SmithRunFailure extends Error {
  usage?: TokenUsageCost;

  constructor(message: string, options: { usage?: TokenUsageCost } = {}) {
    super(message);
    this.name = "SmithRunFailure";
    this.usage = options.usage;
  }
}

export type SmithEnvironmentPreparation = {
  systemPrompt: string;
  ripgrepAvailable: boolean;
  ripgrepBootstrapAttempted: boolean;
  usage?: TokenUsageCost;
};

export async function prepareSmithEnvironment(options: SmithRunOptions): Promise<SmithEnvironmentPreparation> {
  if (await isRipgrepAvailable(options)) {
    options.trace?.write("ripgrep startup check", "available: true");
    return {
      systemPrompt: options.systemPrompt,
      ripgrepAvailable: true,
      ripgrepBootstrapAttempted: false
    };
  }

  options.trace?.write(
    "ripgrep startup check",
    [
      "available: false",
      options.runtime.readOnly ? "bootstrap: skipped because read_only mode is active" : "bootstrap: starting install agent"
    ].join("\n")
  );

  if (options.runtime.readOnly) {
    return {
      systemPrompt: systemPromptWithRipgrepUnavailableNote(options.systemPrompt),
      ripgrepAvailable: false,
      ripgrepBootstrapAttempted: false
    };
  }

  let usage: TokenUsageCost | undefined;
  try {
    const result = await runSmithTask({
      ...options,
      prompt: ripgrepBootstrapPrompt(),
      initialTranscript: undefined,
      maxTurns: Math.min(options.maxTurns ?? options.runtime.maxTurns, RIPGREP_BOOTSTRAP_MAX_TURNS),
      onTerminalOutput: undefined,
      onModelOutput: undefined,
      subAgentDepth: MAX_SUB_AGENT_DEPTH
    });
    usage = result.usage;
    options.trace?.write(
      "ripgrep bootstrap output",
      [`turns: ${result.turns}`, result.chatOut].filter(Boolean).join("\n")
    );
  } catch (error) {
    usage = error instanceof SmithRunFailure ? error.usage : undefined;
    options.trace?.write("ripgrep bootstrap failed", errorMessage(error));
  }

  if (usage) options.trace?.write("ripgrep bootstrap usage", formatUsageCost(usage));

  const available = await isRipgrepAvailable(options);
  options.trace?.write("ripgrep startup check", `available_after_bootstrap: ${available ? "true" : "false"}`);
  return {
    systemPrompt: available ? options.systemPrompt : systemPromptWithRipgrepUnavailableNote(options.systemPrompt),
    ripgrepAvailable: available,
    ripgrepBootstrapAttempted: true,
    ...(usage ? { usage } : {})
  };
}

export async function runSmithTask(options: SmithRunOptions): Promise<SmithRunResult> {
  const maxTurns = options.maxTurns ?? options.runtime.maxTurns;
  let transcript = options.initialTranscript ?? initialTranscript(options.cwd, options.prompt);
  let providerMessages = transcriptToProviderMessages(transcript);
  let systemPrompt = options.systemPrompt;
  let totalUsage: TokenUsageCost | undefined = options.initialUsage;
  let statefulResponses = options.profile.adapter === "chatgpt-codex" ? false : options.profile.statefulResponses;
  let previousResponseId: string | undefined;
  let previousToolCallId: string | undefined;
  let pendingStatefulOutput: string | undefined;
  let responsesInputItems: Record<string, unknown>[] | undefined;
  let codexTurnState: string | undefined;
  let toolCallsSincePatchOrFinish = 0;
  let runDeadlineReminderIndex = 0;
  const runStartedAt = Date.now();
  const promptCacheKey = resolvePromptCacheKey(options.profile, options.cwd, options.prompt);
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
        promptCacheRetention: options.profile.promptCacheRetention,
        responsesInputItems,
        codexTurnState
      });
      const response = await completeModelTurn({
        options,
        systemPrompt,
        providerMessages,
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
          providerMessages,
          statefulTurn: false,
          providerState: providerStateForTurn({
            statefulResponses: false,
            promptCacheKey,
            promptCacheRetention: options.profile.promptCacheRetention,
            responsesInputItems,
            codexTurnState
          }),
          debugJson: providerDebugJson?.write
        });
      });
      const responseProviderState = response.providerState;
      const responseItemsWithOutput = responseProviderState?.responsesInputItems;
      const responseToolCallId = responseProviderState?.previousToolCallId;
      codexTurnState = responseProviderState?.codexTurnState ?? codexTurnState;
      if (statefulResponses) {
        const nextState = responseProviderState;
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
      const toolCalls = response.toolCalls ?? [];
      let nextResponsesInputItems = responseItemsWithOutput;
      let nextPendingOutput = "";
      if (toolCalls.length === 0) {
        const output = missingToolCallOutput(response.text, availableSmithTools(options).map((tool) => tool.name));
        transcript = appendTerminalTurn(transcript, "# tool observation", output);
        providerMessages = appendProviderUserObservation(providerMessages, output);
        nextResponsesInputItems = appendResponsesUserMessage(nextResponsesInputItems, output);
        nextPendingOutput = output;
        options.trace?.write("tool output", output);
      } else {
        for (const toolCall of toolCalls) {
          const toolName = smithToolName(toolCall.name);
          const action = await handleToolCall({
            toolCall,
            options,
            shell,
            transcript,
            providerMessages,
            responsesInputItems: nextResponsesInputItems,
            fallbackToolCallId: responseToolCallId,
            totalUsage
          });
          totalUsage = action.totalUsage;
          transcript = action.transcript;
          providerMessages = action.providerMessages;
          nextResponsesInputItems = action.responsesInputItems;
          nextPendingOutput = [nextPendingOutput, action.toolOutput].filter(Boolean).join("\n");
          const madeTaskPatch =
            toolName === "patch" && action.changedFiles !== undefined && !changedFilesAreOnlySmithMemory(action.changedFiles);
          toolCallsSincePatchOrFinish = madeTaskPatch || action.finished ? 0 : toolCallsSincePatchOrFinish + 1;
          if (action.finished) {
            if (totalUsage) options.trace?.write("run usage", formatUsageCost(totalUsage));
            return { chatOut: action.finished, turns: turn, transcript, ...(totalUsage ? { usage: totalUsage } : {}) };
          }
          if (action.timedOut) {
            const timeoutOutput = action.timeoutOutput;
            if (timeoutOutput) {
              transcript = appendTerminalTurn(transcript, "# timeout", timeoutOutput);
              providerMessages = appendProviderUserObservation(providerMessages, timeoutOutput);
              nextResponsesInputItems = appendResponsesUserMessage(nextResponsesInputItems, timeoutOutput);
              nextPendingOutput = [nextPendingOutput, timeoutOutput].filter(Boolean).join("\n");
              options.trace?.write("timeout", timeoutOutput);
              options.onTerminalOutput?.(timeoutOutput);
            }
          }
          if (toolCallsSincePatchOrFinish > 0 && toolCallsSincePatchOrFinish % PROGRESS_REMINDER_TOOL_INTERVAL === 0) {
            const reminder = progressReminderOutput(options, toolCallsSincePatchOrFinish, turn, maxTurns);
            transcript = appendTerminalTurn(transcript, "# progress", reminder);
            providerMessages = appendProviderUserObservation(providerMessages, reminder);
            nextResponsesInputItems = appendResponsesUserMessage(nextResponsesInputItems, reminder);
            nextPendingOutput = [nextPendingOutput, reminder].filter(Boolean).join("\n");
            options.trace?.write("progress reminder", reminder);
          }
          const deadlineReminder = runDeadlineReminderOutput(options, runStartedAt, runDeadlineReminderIndex);
          if (deadlineReminder) {
            runDeadlineReminderIndex += 1;
            transcript = appendTerminalTurn(transcript, "# deadline", deadlineReminder);
            providerMessages = appendProviderUserObservation(providerMessages, deadlineReminder);
            nextResponsesInputItems = appendResponsesUserMessage(nextResponsesInputItems, deadlineReminder);
            nextPendingOutput = [nextPendingOutput, deadlineReminder].filter(Boolean).join("\n");
            options.trace?.write("deadline reminder", deadlineReminder);
          }
        }
      }
      responsesInputItems = nextResponsesInputItems;
      pendingStatefulOutput = nextPendingOutput;
      const compaction = compactTranscriptToTokenBudget(transcript, {
        maxTokens: options.runtime.maxContextTokens,
        systemPrompt
      });
      if (compaction.changed) {
        transcript = compaction.transcript;
        providerMessages = transcriptToProviderMessages(transcript);
        responsesInputItems = undefined;
        options.trace?.write(
          "transcript compacted",
          [
            `turn: ${turn}`,
            `tokens_before: ${compaction.beforeTokens}`,
            `tokens_after: ${compaction.afterTokens}`,
            `max_tokens: ${options.runtime.maxContextTokens}`,
            `redacted_actions: ${compaction.redactedActions}`,
            `removed_actions: ${compaction.removedActions}`,
            compaction.targetTokens ? `backup_target_tokens: ${compaction.targetTokens}` : ""
          ]
            .filter(Boolean)
            .join("\n")
        );
      } else {
        transcript = compaction.transcript;
      }
    }
  } finally {
    process.off("SIGINT", killShell);
    process.off("SIGTERM", killShell);
    shell.kill();
  }

  throw new SmithRunFailure(`model did not call finish within ${maxTurns} turns`, { usage: totalUsage });
}

type ToolActionResult = {
  transcript: string;
  providerMessages: TranscriptEntry[];
  responsesInputItems?: Record<string, unknown>[];
  toolOutput: string;
  totalUsage?: TokenUsageCost;
  changedFiles?: string[];
  finished?: string;
  timedOut?: boolean;
  timeoutOutput?: string;
};

type ToolCallContext = {
  toolCall: SmithToolCall;
  options: SmithRunOptions;
  shell: PtyShellRunner;
  transcript: string;
  providerMessages: TranscriptEntry[];
  responsesInputItems?: Record<string, unknown>[];
  fallbackToolCallId?: string;
  totalUsage?: TokenUsageCost;
};

async function handleToolCall(context: ToolCallContext): Promise<ToolActionResult> {
  const toolName = smithToolName(context.toolCall.name);
  const callId = context.toolCall.id ?? context.fallbackToolCallId;
  const reason = toolReason(context.toolCall.arguments);
  const childBaseTranscript = context.transcript;
  context.options.trace?.write(
    "tool call",
    JSON.stringify(
      { name: context.toolCall.name, reason, arguments: context.toolCall.arguments },
      null,
      2
    )
  );
  const reasonState = appendToolReason(context.transcript, context.providerMessages, toolName ?? context.toolCall.name, reason);
  const parentContext = { ...context, transcript: reasonState.transcript, providerMessages: reasonState.providerMessages };
  const availableToolNames = availableSmithTools(context.options).map((tool) => tool.name);

  if (!toolName || !availableToolNames.includes(toolName)) {
    return appendToolObservation(
      parentContext,
      callId,
      `Unknown or unavailable tool '${context.toolCall.name}'. Available tools: ${availableToolNames.join(", ")}.`
    );
  }

  if (toolName === "finish") {
    const message = toolTextArgument(parentContext.toolCall.arguments, ["message", "answer", "text", "output"]) ?? "";
    const transcript = appendTerminalTurn(parentContext.transcript, "finish", message);
    const providerMessages = appendProviderTerminalTurn(parentContext.providerMessages, "finish", message);
    parentContext.options.trace?.write("finish", message);
    return { ...parentContext, transcript, providerMessages, toolOutput: message, finished: message };
  }

  if (toolName === "sub_agent") {
    return runSubAgentTool(parentContext, callId, childBaseTranscript);
  }

  if (toolName === "patch") {
    const patch = toolTextArgument(parentContext.toolCall.arguments, ["patch", "diff"]);
    if (!patch || patch.trim().length === 0) {
      return appendToolObservation(parentContext, callId, "patch failed: missing required string argument 'patch'.");
    }
    return runPatchTool(parentContext, callId, patch);
  }

  const command = toolTextArgument(parentContext.toolCall.arguments, ["command", "cmd"]);
  if (!command || command.trim().length === 0) {
    return appendToolObservation(parentContext, callId, "run failed: missing required string argument 'command'.");
  }
  return runShellCommandTool(parentContext, callId, command);
}

async function runPatchTool(
  parentContext: ToolCallContext,
  callId: string | undefined,
  rawPatch: string
): Promise<ToolActionResult> {
  const review = await reviewDangerousCommand({
    command: "smith_patch",
    cwd: parentContext.options.cwd,
    recentTranscript: parentContext.transcript,
    runtime: parentContext.options.runtime,
    reviewerProfile: parentContext.options.reviewerProfile,
    env: parentContext.options.env,
    fetch: parentContext.options.fetch
  });
  const totalUsage = addUsageCost(parentContext.totalUsage, review.usage);
  if (review.usage) parentContext.options.trace?.write("danger review usage", formatUsageCost(review.usage));
  if (!review.allowed) {
    const blockedOutput = "Command too dangerous";
    const transcript = appendTerminalTurn(parentContext.transcript, "patch", blockedOutput);
    const providerMessages = appendProviderTerminalTurn(parentContext.providerMessages, "patch", blockedOutput);
    const responsesInputItems = appendResponsesTerminalOutput(parentContext.responsesInputItems, callId, blockedOutput);
    parentContext.options.trace?.write("tool output", blockedOutput);
    parentContext.options.onTerminalOutput?.(blockedOutput);
    return { transcript, providerMessages, responsesInputItems, toolOutput: blockedOutput, totalUsage };
  }

  const patch = stripPatchFence(rawPatch).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let output: string;
  let changedFiles: string[] | undefined;
  try {
    const result = applySmithPatch(patch, parentContext.options.cwd);
    changedFiles = result.changedFiles;
    output = `Applied patch to ${result.changedFiles.join(", ")}`;
  } catch (error) {
    output = `patch failed: ${errorMessage(error)}`;
  }
  const transcript = appendTerminalTurn(parentContext.transcript, "patch", output);
  const providerMessages = appendProviderTerminalTurn(parentContext.providerMessages, "patch", output);
  const responsesInputItems = appendResponsesTerminalOutput(parentContext.responsesInputItems, callId, output);
  parentContext.options.trace?.write("tool output", output);
  if (output) parentContext.options.onTerminalOutput?.(output);
  return { transcript, providerMessages, responsesInputItems, toolOutput: output, totalUsage, ...(changedFiles ? { changedFiles } : {}) };
}

function changedFilesAreOnlySmithMemory(changedFiles: string[]): boolean {
  return changedFiles.length > 0 && changedFiles.every(isRootSmithMemoryFile);
}

function isRootSmithMemoryFile(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  return normalized === "SMITH.md" || normalized === "SMITH.TASK.md";
}

async function runShellCommandTool(
  parentContext: ToolCallContext,
  callId: string | undefined,
  command: string,
  transcriptCommand?: string
): Promise<ToolActionResult> {
  const review = await reviewDangerousCommand({
    command,
    cwd: parentContext.options.cwd,
    recentTranscript: parentContext.transcript,
    runtime: parentContext.options.runtime,
    reviewerProfile: parentContext.options.reviewerProfile,
    env: parentContext.options.env,
    fetch: parentContext.options.fetch
  });
  const totalUsage = addUsageCost(parentContext.totalUsage, review.usage);
  if (review.usage) parentContext.options.trace?.write("danger review usage", formatUsageCost(review.usage));
  if (!review.allowed) {
    const blockedOutput = "Command too dangerous";
    const transcript = appendTerminalTurn(parentContext.transcript, transcriptCommand ?? command, blockedOutput);
    const providerMessages = appendProviderTerminalTurn(parentContext.providerMessages, transcriptCommand ?? command, blockedOutput);
    const responsesInputItems = appendResponsesTerminalOutput(parentContext.responsesInputItems, callId, blockedOutput);
    parentContext.options.trace?.write("terminal output", blockedOutput);
    parentContext.options.onTerminalOutput?.(blockedOutput);
    return { transcript, providerMessages, responsesInputItems, toolOutput: blockedOutput, totalUsage };
  }

  const timeoutMs = timeoutFromToolCall(parentContext.toolCall.arguments, parentContext.options.runtime.timeoutMs);
  const result = await parentContext.shell.run(command, timeoutMs);
  const terminalOutput = limitToolOutput(
    formatTerminalOutput(result.output, result.exitCode),
    parentContext.options.runtime.maxToolOutputChars
  );
  const recordedCommand = transcriptCommand ?? result.command;
  const transcript = appendTerminalTurn(parentContext.transcript, recordedCommand, terminalOutput);
  const providerMessages = appendProviderTerminalTurn(parentContext.providerMessages, recordedCommand, terminalOutput);
  const responsesInputItems = appendResponsesTerminalOutput(parentContext.responsesInputItems, callId, terminalOutput);
  parentContext.options.trace?.write("terminal output", terminalOutput);
  if (terminalOutput) parentContext.options.onTerminalOutput?.(terminalOutput);
  if (result.chatOut !== undefined) {
    parentContext.options.trace?.write("finish", result.chatOut);
    return { transcript, providerMessages, responsesInputItems, toolOutput: terminalOutput, totalUsage, finished: result.chatOut };
  }

  return {
    transcript,
    providerMessages,
    responsesInputItems,
    toolOutput: terminalOutput,
    totalUsage,
    timedOut: result.timedOut,
    timeoutOutput: result.timedOut
      ? limitToolOutput(formatTimeoutOutput(result.command, result.elapsedMs, result.lastOutput), parentContext.options.runtime.maxToolOutputChars)
      : undefined
  };
}

async function runSubAgentTool(
  context: ToolCallContext,
  callId: string | undefined,
  inheritedTranscript: string
): Promise<ToolActionResult> {
  const task = toolTextArgument(context.toolCall.arguments, ["task", "prompt"]);
  if (!task || task.trim().length === 0) {
    return appendToolObservation(context, callId, "sub_agent failed: missing required string argument 'task'.");
  }
  const depth = context.options.subAgentDepth ?? 0;
  if (depth >= MAX_SUB_AGENT_DEPTH) {
    return appendToolObservation(context, callId, "sub_agent failed: maximum sub_agent nesting depth reached.");
  }
  const cwdArg = toolTextArgument(context.toolCall.arguments, ["cwd", "workdir"]);
  const cwd = cwdArg ? resolve(context.options.cwd, cwdArg) : context.options.cwd;
  const parentMaxTurns = context.options.maxTurns ?? context.options.runtime.maxTurns;
  const maxTurns =
    context.options.runtime.subAgentMaxTurns > 0
      ? Math.min(parentMaxTurns, context.options.runtime.subAgentMaxTurns)
      : parentMaxTurns;
  const inheritContext = context.options.runtime.subAgentInheritContext !== false;
  const explicitReadOnly = toolBooleanArgument(context.toolCall.arguments, ["read_only", "readonly"]);
  const readOnly = context.options.runtime.readOnly || (explicitReadOnly ?? inferSubAgentReadOnly(task));
  const childPrompt = subAgentTaskPrompt(task, readOnly);
  const initialTranscript = inheritContext ? appendSubAgentTaskToTranscript(inheritedTranscript, childPrompt) : undefined;
  context.options.trace?.write(
    "sub_agent",
    [
      `cwd: ${cwd}`,
      `max_turns: ${maxTurns}`,
      `inherit_context: ${inheritContext ? "true" : "false"}`,
      `read_only: ${readOnly ? "true" : "false"}`,
      `task: ${task}`
    ].join("\n")
  );

  try {
    const result = await runSmithTask({
      ...context.options,
      cwd,
      prompt: childPrompt,
      initialTranscript,
      maxTurns,
      runtime: { ...context.options.runtime, readOnly },
      onTerminalOutput: undefined,
      onModelOutput: undefined,
      subAgentDepth: depth + 1
    });
    const output = limitToolOutput(
      `Sub-agent finished in ${result.turns} turns:\n${result.chatOut}`,
      context.options.runtime.maxToolOutputChars
    );
    const totalUsage = addUsageCost(context.totalUsage, result.usage);
    const label = subAgentTranscriptLabel(task);
    const transcript = appendTerminalTurn(context.transcript, label, output);
    const providerMessages = appendProviderTerminalTurn(context.providerMessages, label, output);
    const responsesInputItems = appendResponsesTerminalOutput(context.responsesInputItems, callId, output);
    context.options.trace?.write("sub_agent output", output);
    context.options.onTerminalOutput?.(output);
    return { transcript, providerMessages, responsesInputItems, toolOutput: output, totalUsage };
  } catch (error) {
    const totalUsage = addUsageCost(context.totalUsage, error instanceof SmithRunFailure ? error.usage : undefined);
    const output = `sub_agent failed: ${errorMessage(error)}`;
    return appendToolObservation({ ...context, totalUsage }, callId, output);
  }
}

function appendToolObservation(
  context: {
    transcript: string;
    providerMessages: TranscriptEntry[];
    responsesInputItems?: Record<string, unknown>[];
    totalUsage?: TokenUsageCost;
    options: SmithRunOptions;
  },
  callId: string | undefined,
  output: string
): ToolActionResult {
  const transcript = appendTerminalTurn(context.transcript, "# tool observation", output);
  const providerMessages = appendProviderUserObservation(context.providerMessages, output);
  const responsesInputItems = appendResponsesTerminalOutput(context.responsesInputItems, callId, output);
  context.options.trace?.write("tool output", output);
  context.options.onTerminalOutput?.(output);
  return { transcript, providerMessages, responsesInputItems, toolOutput: output, totalUsage: context.totalUsage };
}

function appendToolReason(
  transcript: string,
  providerMessages: TranscriptEntry[],
  toolName: string,
  reason: string | undefined
): { transcript: string; providerMessages: TranscriptEntry[] } {
  const text = reason?.trim();
  if (!text) return { transcript, providerMessages };
  const output = `${toolName}: ${text}`;
  return {
    transcript: appendTranscriptObservation(transcript, "tool reason", output),
    providerMessages: appendProviderUserObservation(providerMessages, output)
  };
}

function missingToolCallOutput(text: string, toolNames: string[]): string {
  const trimmed = text.trim();
  return [
    `Model response did not call a Smith tool. Use ${toolNames.join(", ")}.`,
    trimmed ? `Provider text:\n${trimmed}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function stripPatchFence(value: string): string {
  const trimmed = value.trim();
  const match = /^(?:```|~~~)(?:patch|diff)?\s*\n([\s\S]*?)\n(?:```|~~~)\s*$/i.exec(trimmed);
  return match ? match[1] : value;
}

function timeoutFromToolCall(args: Record<string, unknown>, fallback: number): number {
  const value = args.timeout_ms;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function subAgentTranscriptLabel(task: string): string {
  const compact = task.replace(/\s+/g, " ").trim();
  const label = compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
  return `sub_agent ${JSON.stringify(label)}`;
}

function appendSubAgentTaskToTranscript(transcript: string, taskPrompt: string): string {
  const taskEntry = appendChatIn(taskPrompt);
  return transcript ? `${transcript}\n${taskEntry}` : taskEntry;
}

async function completeModelTurn(context: {
  options: SmithRunOptions;
  systemPrompt: string;
  providerMessages: TranscriptEntry[];
  statefulTurn: boolean;
  providerState?: SmithProviderState;
  debugJson?: (record: Record<string, unknown>) => void;
}): Promise<SmithModelResponse> {
  const tools = availableSmithTools(context.options);
  const systemPrompt = systemPromptForAvailableTools(context.systemPrompt, tools, context.options);
  const messages =
    context.statefulTurn && context.providerState?.previousResponseId
      ? providerMessagesToMessages(
          systemPrompt,
          [{ role: "user", content: context.providerState.toolOutput || "(no terminal output)" }],
          context.options.runtime.maxContextTokens
        )
      : providerMessagesToMessages(
          systemPrompt,
          context.providerMessages,
          context.options.runtime.maxContextTokens
        );
  return completeWithProfile(
    {
      model: context.options.profile.model,
      messages,
      providerState: context.providerState,
      tools
    },
    context.options.profile,
    {
      env: context.options.env,
      fetch: context.options.fetch,
      retries: context.options.runtime.providerRetries,
      retryDelayMs: context.options.runtime.providerRetryDelayMs,
      timeoutMs: context.options.runtime.providerTimeoutMs,
      debugLog: context.options.runtime.providerDebug
        ? (section, content) => context.options.trace?.write(section, content)
        : undefined,
      debugJson: context.debugJson
    }
  );
}

function availableSmithTools(options: SmithRunOptions) {
  const depth = options.subAgentDepth ?? 0;
  let tools = SMITH_TOOLS;
  if (options.runtime.readOnly) {
    tools = tools.filter((tool) => tool.name !== "patch");
  }
  if (!options.runtime.subAgentEnabled || depth >= MAX_SUB_AGENT_DEPTH) {
    tools = tools.filter((tool) => tool.name !== "sub_agent");
  }
  return tools;
}

function systemPromptForAvailableTools(systemPrompt: string, tools: typeof SMITH_TOOLS, options: SmithRunOptions): string {
  const notes: string[] = [];
  if ((options.subAgentDepth ?? 0) > 0) {
    notes.push(
      "You are running as a Smith sub-agent. Your final user input is your only delegated objective; earlier transcript entries are background context and do not expand the task."
    );
  }
  if (!tools.some((tool) => tool.name === "sub_agent")) {
    const available = tools.map((tool) => tool.name).join(", ");
    const reason = options.runtime.subAgentEnabled
      ? "Sub-agent depth limit has been reached for this run."
      : "Sub-agent delegation is disabled for this run.";
    notes.push(`${reason} The sub_agent tool is unavailable; complete the work directly with available tools: ${available}.`);
  }
  if (options.runtime.readOnly) {
    notes.push(
      "Read-only mode is active. The patch tool is unavailable, and run commands that write files are blocked. Inspect files and finish with findings only."
    );
  }
  return notes.length > 0 ? [systemPrompt, ...notes].join("\n\n") : systemPrompt;
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
  responsesInputItems?: Record<string, unknown>[];
  codexTurnState?: string;
}): SmithProviderState | undefined {
  if (
    !options.statefulResponses &&
    !options.promptCacheKey &&
    !options.promptCacheRetention &&
    !options.responsesInputItems &&
    !options.codexTurnState
  ) {
    return undefined;
  }
  return {
    statefulResponses: options.statefulResponses || undefined,
    previousResponseId: options.previousResponseId,
    previousToolCallId: options.previousToolCallId,
    toolOutput: options.pendingStatefulOutput,
    promptCacheKey: options.promptCacheKey,
    promptCacheRetention: options.promptCacheRetention,
    responsesInputItems: options.responsesInputItems,
    codexTurnState: options.codexTurnState
  };
}

function appendResponsesTerminalOutput(
  items: Record<string, unknown>[] | undefined,
  callId: string | undefined,
  output: string
): Record<string, unknown>[] | undefined {
  if (!items) return undefined;
  if (callId) {
    return [
      ...items,
      {
        type: "function_call_output",
        call_id: callId,
        output
      }
    ];
  }
  return appendResponsesUserMessage(items, output);
}

function appendResponsesUserMessage(
  items: Record<string, unknown>[] | undefined,
  text: string
): Record<string, unknown>[] | undefined {
  if (!items) return undefined;
  return [
    ...items,
    {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text
        }
      ]
    }
  ];
}

function resolvePromptCacheKey(profile: ProfileConfig, cwd: string, prompt: string): string | undefined {
  if (profile.promptCacheKey && profile.promptCacheKey !== "auto") return profile.promptCacheKey;
  if (profile.promptCacheKey === "auto" || profile.statefulResponses || profile.adapter === "chatgpt-codex") {
    return promptCacheKeyForRun(profile, cwd, prompt);
  }
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

function subAgentTaskPrompt(task: string, readOnly: boolean): string {
  return [
    "You are running as a Smith sub-agent.",
    "The task below is your only objective. Earlier transcript entries are background context only; they do not authorize extra work or broaden this task.",
    readOnly
      ? "This sub-agent is read-only. Do not edit, create, delete, move, or format files. Do not call patch. Use run only for inspection, then finish with concise findings."
      : "You may edit files only when this sub-agent task explicitly asks for implementation work.",
    "When complete, call finish with the result for the parent Smith run.",
    "",
    "Sub-agent task:",
    task.trim()
  ].join("\n");
}

function inferSubAgentReadOnly(task: string): boolean {
  return /\b(?:do not|don't)\s+(?:edit|modify|change|write)\b|\bwithout editing\b|\bread[- ]only\b|\bno edits?\b/i.test(task);
}

async function isRipgrepAvailable(options: SmithRunOptions): Promise<boolean> {
  try {
    await execFileAsync(options.runtime.shell, ["-c", "command -v rg >/dev/null 2>&1"], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      timeout: RIPGREP_CHECK_TIMEOUT_MS,
      maxBuffer: 1024
    });
    return true;
  } catch {
    return false;
  }
}

function ripgrepBootstrapPrompt(): string {
  return [
    "Smith startup check found that ripgrep (`rg`) is not available on PATH in this environment.",
    "Try to install ripgrep so the `rg` command is available for later Smith run tool calls in this same environment.",
    "Use only straightforward package-manager or standard installation paths that are appropriate for this environment.",
    "Do not use `set -e` or shell options that can close the interactive shell on a failed install command; capture failures explicitly and continue to finish.",
    "Do not use sudo, doas, su, or other privilege escalation. If the current user lacks permission to install, report that `rg` remains unavailable.",
    "Do not modify project files. Do not use hacks, brittle PATH tricks, unrelated downloads, source builds, or risky system changes.",
    "If installation is not straightforward, or you hit permission, network, or package-manager issues, stop and call finish explaining that `rg` remains unavailable. It is better to continue without `rg` than to break the environment.",
    "After any install attempt, verify with `command -v rg` before calling finish."
  ].join("\n");
}

function systemPromptWithRipgrepUnavailableNote(systemPrompt: string): string {
  if (systemPrompt.includes(RIPGREP_UNAVAILABLE_PROMPT_NOTE)) return systemPrompt;
  return [systemPrompt, RIPGREP_UNAVAILABLE_PROMPT_NOTE].join("\n\n");
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

function progressReminderOutput(options: SmithRunOptions, toolCallsSincePatchOrFinish: number, turn: number, maxTurns: number): string {
  const availableTools = availableSmithTools(options).map((tool) => tool.name).join(", ");
  const patchAvailable = availableSmithTools(options).some((tool) => tool.name === "patch");
  const status = `Smith progress: ${toolCallsSincePatchOrFinish} tool calls have completed without ${
    patchAvailable ? "a task patch or finish" : "finish"
  }; turn ${turn} of ${maxTurns}; available tools: ${availableTools}.`;
  if (!patchAvailable) {
    return `${status} If the requested read-only findings are sufficient, finish with the result; otherwise continue focused inspection.`;
  }
  return `${status} If the task requires file changes and current evidence identifies a safe edit, use patch; if no actionable edit is possible, finish with the blocker.`;
}

function runDeadlineReminderOutput(
  options: SmithRunOptions,
  runStartedAt: number,
  reminderIndex: number
): string | undefined {
  const maxRunMs = options.runtime.maxRunMs;
  if (maxRunMs <= 0 || reminderIndex >= RUN_DEADLINE_REMINDER_THRESHOLDS.length) return undefined;
  const threshold = RUN_DEADLINE_REMINDER_THRESHOLDS[reminderIndex];
  const elapsedMs = Date.now() - runStartedAt;
  if (elapsedMs < maxRunMs * threshold) return undefined;
  const percentage = Math.round(threshold * 100);
  const availableTools = availableSmithTools(options).map((tool) => tool.name).join(", ");
  const patchAvailable = availableSmithTools(options).some((tool) => tool.name === "patch");
  const status = `Smith deadline: elapsed ${formatDurationMs(elapsedMs)} of ${formatDurationMs(
    maxRunMs
  )} max run time (${percentage}% threshold); available tools: ${availableTools}.`;
  if (!patchAvailable) {
    return `${status} If findings are sufficient, use finish now; otherwise continue only the highest-value remaining inspection.`;
  }
  return `${status} If the task is complete, use finish now. If required changes are still pending and evidence supports a safe edit, use patch before more inspection; otherwise finish with the blocker.`;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
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

function limitToolOutput(output: string, maxChars: number): string {
  if (maxChars <= 0 || output.length <= maxChars) return output;
  const marker = `[smith truncated tool output: ${output.length} chars exceeded max_tool_output_chars=${maxChars}; showing head and tail]`;
  const separator = (omitted: number) => `\n[... omitted ${omitted} chars ...]\n`;
  const overhead = marker.length + separator(0).length;
  const budget = Math.max(0, maxChars - overhead);
  const headChars = Math.ceil(budget / 2);
  const tailChars = Math.floor(budget / 2);
  const omitted = Math.max(0, output.length - headChars - tailChars);
  const tail = tailChars > 0 ? output.slice(output.length - tailChars) : "";
  return `${marker}\n${output.slice(0, headChars)}${separator(omitted)}${tail}`;
}
