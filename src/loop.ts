import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProfileConfig, RuntimeConfig } from "./config.js";
import { addUsageCost, formatUsageCost, summarizeUsage, type TokenUsageCost } from "./cost.js";
import { reviewDangerousCommand } from "./danger-review.js";
import { createProviderDebugJsonLogger } from "./provider-debug.js";
import { completeWithProfile, ProviderError, type ProviderFetch } from "./providers/index.js";
import { smithToolName, SMITH_TOOLS, toolReason, toolTextArgument } from "./providers/tools.js";
import type { SmithModelResponse, SmithProviderState, SmithToolCall } from "./providers/types.js";
import { PtyShellRunner } from "./pty.js";
import { summarizeProviderEvents } from "./session-log.js";
import {
  appendChatIn,
  appendProviderTerminalTurn,
  appendProviderUserObservation,
  appendTerminalTurn,
  appendTranscriptObservation,
  compactProviderMessages,
  compactTranscript,
  providerMessagesToMessages,
  transcriptToProviderMessages,
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
  subAgentDepth?: number;
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
  let statefulResponses = options.profile.adapter === "chatgpt-codex" ? false : options.profile.statefulResponses;
  let previousResponseId: string | undefined;
  let previousToolCallId: string | undefined;
  let pendingStatefulOutput: string | undefined;
  let responsesInputItems: Record<string, unknown>[] | undefined;
  let codexTurnState: string | undefined;
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
        const output = missingToolCallOutput(response.text);
        transcript = appendTerminalTurn(transcript, "# tool observation", output);
        providerMessages = appendProviderUserObservation(providerMessages, output);
        nextResponsesInputItems = appendResponsesUserMessage(nextResponsesInputItems, output);
        nextPendingOutput = output;
        options.trace?.write("tool output", output);
      } else {
        for (const toolCall of toolCalls) {
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
        }
      }
      responsesInputItems = nextResponsesInputItems;
      pendingStatefulOutput = nextPendingOutput;
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
        responsesInputItems = undefined;
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

  throw new Error(`model did not call finish within ${maxTurns} turns`);
}

type ToolActionResult = {
  transcript: string;
  providerMessages: TranscriptEntry[];
  responsesInputItems?: Record<string, unknown>[];
  toolOutput: string;
  totalUsage?: TokenUsageCost;
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

  if (!toolName) {
    return appendToolObservation(
      parentContext,
      callId,
      `Unknown tool '${context.toolCall.name}'. Available tools: run, patch, sub_agent, finish.`
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
    return runShellCommandTool(parentContext, callId, smithPatchCommand(patch), "patch");
  }

  const command = toolTextArgument(parentContext.toolCall.arguments, ["command", "cmd"]);
  if (!command || command.trim().length === 0) {
    return appendToolObservation(parentContext, callId, "run failed: missing required string argument 'command'.");
  }
  return runShellCommandTool(parentContext, callId, command);
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
  const terminalOutput = formatTerminalOutput(result.output, result.exitCode);
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
    timeoutOutput: result.timedOut ? formatTimeoutOutput(result.command, result.elapsedMs, result.lastOutput) : undefined
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
  if (depth >= 2) {
    return appendToolObservation(context, callId, "sub_agent failed: maximum sub_agent nesting depth reached.");
  }
  const cwdArg = toolTextArgument(context.toolCall.arguments, ["cwd", "workdir"]);
  const cwd = cwdArg ? resolve(context.options.cwd, cwdArg) : context.options.cwd;
  const maxTurns = maxTurnsFromToolCall(context.toolCall.arguments, context.options.runtime.maxTurns);
  const inheritContext = context.options.runtime.subAgentInheritContext !== false;
  const initialTranscript = inheritContext ? appendSubAgentTaskToTranscript(inheritedTranscript, task) : undefined;
  context.options.trace?.write(
    "sub_agent",
    [`cwd: ${cwd}`, `max_turns: ${maxTurns}`, `inherit_context: ${inheritContext ? "true" : "false"}`, `task: ${task}`].join(
      "\n"
    )
  );

  try {
    const result = await runSmithTask({
      ...context.options,
      cwd,
      prompt: task,
      initialTranscript,
      maxTurns,
      onTerminalOutput: undefined,
      onModelOutput: undefined,
      subAgentDepth: depth + 1
    });
    const output = `Sub-agent finished in ${result.turns} turns:\n${result.chatOut}`;
    const totalUsage = addUsageCost(context.totalUsage, result.usage);
    const label = subAgentTranscriptLabel(task);
    const transcript = appendTerminalTurn(context.transcript, label, output);
    const providerMessages = appendProviderTerminalTurn(context.providerMessages, label, output);
    const responsesInputItems = appendResponsesTerminalOutput(context.responsesInputItems, callId, output);
    context.options.trace?.write("sub_agent output", output);
    context.options.onTerminalOutput?.(output);
    return { transcript, providerMessages, responsesInputItems, toolOutput: output, totalUsage };
  } catch (error) {
    const output = `sub_agent failed: ${errorMessage(error)}`;
    return appendToolObservation(context, callId, output);
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

function missingToolCallOutput(text: string): string {
  const trimmed = text.trim();
  return [
    "Model response did not call a Smith tool. Use run, patch, sub_agent, or finish.",
    trimmed ? `Provider text:\n${trimmed}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function smithPatchCommand(rawPatch: string): string {
  const patch = stripPatchFence(rawPatch).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let delimiter = `SMITH_PATCH_${createHash("sha256").update(patch).digest("hex").slice(0, 16)}`;
  for (let attempt = 0; patch.includes(delimiter); attempt += 1) {
    delimiter = `SMITH_PATCH_${createHash("sha256").update(`${patch}\0${attempt}`).digest("hex").slice(0, 16)}`;
  }
  const body = patch.endsWith("\n") ? patch : `${patch}\n`;
  return `smith_patch <<'${delimiter}'\n${body}${delimiter}`;
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

function maxTurnsFromToolCall(args: Record<string, unknown>, fallback: number): number {
  const value = args.max_turns;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return Math.min(fallback, 20);
  return Math.max(1, Math.min(Math.floor(value), fallback));
}

function subAgentTranscriptLabel(task: string): string {
  const compact = task.replace(/\s+/g, " ").trim();
  const label = compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
  return `sub_agent ${JSON.stringify(label)}`;
}

function appendSubAgentTaskToTranscript(transcript: string, task: string): string {
  const taskEntry = appendChatIn(task);
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
  const messages =
    context.statefulTurn && context.providerState?.previousResponseId
      ? providerMessagesToMessages(
          context.systemPrompt,
          [{ role: "user", content: context.providerState.toolOutput || "(no terminal output)" }],
          context.options.runtime.maxContextChars
        )
      : providerMessagesToMessages(
          context.systemPrompt,
          context.providerMessages,
          context.options.runtime.maxContextChars
        );
  return completeWithProfile(
    {
      model: context.options.profile.model,
      messages,
      providerState: context.providerState,
      tools: SMITH_TOOLS
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
