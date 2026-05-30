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
import { PtyShellRunner, type ShellRunner } from "./pty.js";
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
const INSPECTION_PAUSE_TOOL_INTERVAL = PROGRESS_REMINDER_TOOL_INTERVAL * 3;
const RUN_EDIT_REJECTION_PAUSE_THRESHOLD = 2;
const RUN_DEADLINE_REMINDER_THRESHOLDS = [0.75, 0.9] as const;
const POST_DEADLINE_VALIDATION_RUN_TIMEOUT_MS = 60_000;
const POST_DEADLINE_INSPECTION_RUN_TIMEOUT_MS = 15_000;
const VALIDATION_RUN_MIN_TIMEOUT_MS = 60_000;
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
  transcript?: string;

  constructor(message: string, options: { usage?: TokenUsageCost; transcript?: string } = {}) {
    super(message);
    this.name = "SmithRunFailure";
    this.usage = options.usage;
    this.transcript = options.transcript;
  }
}

type ToolAvailabilityState = {
  subAgentDisabledReason?: string;
  inspectionDisabledReason?: string;
  deadlineFinalizationReason?: string;
  postDeadlineValidationRunReason?: string;
  postDeadlineInspectionRunReason?: string;
};

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
  let toolAvailabilityState: ToolAvailabilityState = {};
  let unsafeRunEditRejectionsSincePatch = 0;
  let subAgentTurnLimitFailures = 0;
  let runDeadlineReminderIndex = 0;
  let unvalidatedTaskPatch = false;
  let pendingValidationFiles = new Set<string>();
  let noOpValidationSinceLastCheck = false;
  let unresolvedReadOnlyTestPatchFailure = false;
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
        debugJson: providerDebugJson?.write,
        toolAvailabilityState
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
          debugJson: providerDebugJson?.write,
          toolAvailabilityState
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
      const appendReminders = (pendingOutput: string): string => {
        let output = pendingOutput;
        toolAvailabilityState = enforceRunDeadlineFinalization(options, toolAvailabilityState, runStartedAt, unvalidatedTaskPatch);
        if (toolCallsSincePatchOrFinish > 0 && toolCallsSincePatchOrFinish % PROGRESS_REMINDER_TOOL_INTERVAL === 0) {
          toolAvailabilityState = pauseInspectionAfterSustainedNoPatch(
            options,
            toolAvailabilityState,
            toolCallsSincePatchOrFinish,
            unvalidatedTaskPatch
          );
          const reminder = progressReminderOutput(options, toolAvailabilityState, toolCallsSincePatchOrFinish, turn, maxTurns);
          transcript = appendTerminalTurn(transcript, "# progress", reminder);
          providerMessages = appendProviderUserObservation(providerMessages, reminder);
          nextResponsesInputItems = appendResponsesUserMessage(nextResponsesInputItems, reminder);
          output = [output, reminder].filter(Boolean).join("\n");
          options.trace?.write("progress reminder", reminder);
        }
        const deadlineReminder = runDeadlineReminderOutput(options, toolAvailabilityState, runStartedAt, runDeadlineReminderIndex);
        if (deadlineReminder) {
          runDeadlineReminderIndex += 1;
          transcript = appendTerminalTurn(transcript, "# deadline", deadlineReminder);
          providerMessages = appendProviderUserObservation(providerMessages, deadlineReminder);
          nextResponsesInputItems = appendResponsesUserMessage(nextResponsesInputItems, deadlineReminder);
          output = [output, deadlineReminder].filter(Boolean).join("\n");
          options.trace?.write("deadline reminder", deadlineReminder);
        }
        return output;
      };
      if (toolCalls.length === 0) {
        const output = missingToolCallOutput(response.text, availableSmithTools(options, toolAvailabilityState).map((tool) => tool.name));
        transcript = appendTerminalTurn(transcript, "# tool observation", output);
        providerMessages = appendProviderUserObservation(providerMessages, output);
        nextResponsesInputItems = appendResponsesUserMessage(nextResponsesInputItems, output);
        nextPendingOutput = output;
        options.trace?.write("tool output", output);
        toolCallsSincePatchOrFinish += 1;
        nextPendingOutput = appendReminders(nextPendingOutput);
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
            totalUsage,
            toolAvailabilityState,
            unvalidatedTaskPatch,
            pendingValidationFiles: [...pendingValidationFiles],
            noOpValidationSinceLastCheck,
            unresolvedReadOnlyTestPatchFailure
          });
          totalUsage = action.totalUsage;
          transcript = action.transcript;
          providerMessages = action.providerMessages;
          nextResponsesInputItems = action.responsesInputItems;
          nextPendingOutput = [nextPendingOutput, action.toolOutput].filter(Boolean).join("\n");
          const madeTaskPatch = action.changedFiles !== undefined && !changedFilesAreOnlySmithMemory(action.changedFiles);
          const hadUnvalidatedTaskPatch = unvalidatedTaskPatch;
          if (action.readOnlyTestPatchFailed) {
            unresolvedReadOnlyTestPatchFailure = true;
          }
          if (madeTaskPatch && subAgentTurnLimitFailures < 2) {
            unsafeRunEditRejectionsSincePatch = 0;
            toolAvailabilityState = availabilityAfterTaskPatch(retainPersistentToolAvailability(toolAvailabilityState));
          } else if (action.subAgentTurnLimitFailure) {
            subAgentTurnLimitFailures += 1;
            toolAvailabilityState = {
              ...toolAvailabilityState,
              subAgentDisabledReason:
                subAgentTurnLimitFailures >= 2
                  ? "Multiple sub_agent child runs did not finish within their turn budgets, so sub_agent is unavailable for the rest of this run."
                  : "A previous sub_agent child run did not finish within its turn budget, so sub_agent is temporarily unavailable until a task patch succeeds."
            };
          } else if (madeTaskPatch) {
            unsafeRunEditRejectionsSincePatch = 0;
            toolAvailabilityState = availabilityAfterTaskPatch({ ...toolAvailabilityState, inspectionDisabledReason: undefined });
          } else if (action.postDeadlineValidationRunConsumed) {
            toolAvailabilityState = {
              ...toolAvailabilityState,
              postDeadlineValidationRunReason: undefined,
              postDeadlineInspectionRunReason: undefined
            };
          } else if (action.postDeadlineInspectionRunConsumed) {
            toolAvailabilityState = { ...toolAvailabilityState, postDeadlineInspectionRunReason: undefined };
          } else if (action.postDeadlineValidationFailed) {
            toolAvailabilityState = {
              ...toolAvailabilityState,
              postDeadlineInspectionRunReason:
                "A post-deadline validation command failed, so run is available for one short inspection command to inspect the failure before patching or finalizing."
            };
          } else if (action.patchContextFailed && toolAvailabilityState.deadlineFinalizationReason) {
            toolAvailabilityState = {
              ...toolAvailabilityState,
              postDeadlineInspectionRunReason:
                "A post-deadline patch failed because its context did not match, so run is available for one short inspection command to inspect exact current lines before patching or finalizing."
            };
          } else if (action.unsafeRunEditRejected) {
            unsafeRunEditRejectionsSincePatch += 1;
            if (unsafeRunEditRejectionsSincePatch >= RUN_EDIT_REJECTION_PAUSE_THRESHOLD) {
              toolAvailabilityState = pauseInspectionAfterRepeatedRunEditRejections(options, toolAvailabilityState);
            }
          }
          if (madeTaskPatch) {
            unvalidatedTaskPatch = true;
            for (const changedFile of action.changedFiles ?? []) {
              if (!isRootSmithMemoryFile(changedFile)) pendingValidationFiles.add(changedFile);
            }
          } else if (action.validationRunExecuted) {
            unvalidatedTaskPatch = false;
            pendingValidationFiles = new Set();
            if (hadUnvalidatedTaskPatch) unresolvedReadOnlyTestPatchFailure = false;
          } else if (action.sourcePatchValidationEvidence && hadUnvalidatedTaskPatch) {
            unresolvedReadOnlyTestPatchFailure = false;
          }
          if (action.noOpValidationRun) {
            noOpValidationSinceLastCheck = true;
          } else if (action.nonNoOpValidationRun) {
            noOpValidationSinceLastCheck = false;
          }
          toolCallsSincePatchOrFinish = madeTaskPatch || action.finished ? 0 : toolCallsSincePatchOrFinish + 1;
          if (action.finished) {
            if (totalUsage) options.trace?.write("run usage", formatUsageCost(totalUsage));
            return { chatOut: action.finished, turns: turn, transcript, ...(totalUsage ? { usage: totalUsage } : {}) };
          }
          nextPendingOutput = appendReminders(nextPendingOutput);
          if (
            action.patchContextFailed &&
            toolAvailabilityState.deadlineFinalizationReason &&
            !toolAvailabilityState.postDeadlineInspectionRunReason
          ) {
            toolAvailabilityState = {
              ...toolAvailabilityState,
              postDeadlineInspectionRunReason:
                "A post-deadline patch failed because its context did not match, so run is available for one short inspection command to inspect exact current lines before patching or finalizing."
            };
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

  throw new SmithRunFailure(`model did not call finish within ${maxTurns} turns`, { usage: totalUsage, transcript });
}

type ToolActionResult = {
  transcript: string;
  providerMessages: TranscriptEntry[];
  responsesInputItems?: Record<string, unknown>[];
  toolOutput: string;
  totalUsage?: TokenUsageCost;
  changedFiles?: string[];
  finished?: string;
  subAgentTurnLimitFailure?: boolean;
  postDeadlineValidationRunConsumed?: boolean;
  postDeadlineInspectionRunConsumed?: boolean;
  postDeadlineValidationFailed?: boolean;
  patchContextFailed?: boolean;
  unsafeRunEditRejected?: boolean;
  noOpValidationRun?: boolean;
  nonNoOpValidationRun?: boolean;
  validationRunExecuted?: boolean;
  sourcePatchValidationEvidence?: boolean;
  readOnlyTestPatchFailed?: boolean;
};

type ToolCallContext = {
  toolCall: SmithToolCall;
  options: SmithRunOptions;
  shell: ShellRunner;
  transcript: string;
  providerMessages: TranscriptEntry[];
  responsesInputItems?: Record<string, unknown>[];
  fallbackToolCallId?: string;
  totalUsage?: TokenUsageCost;
  toolAvailabilityState: ToolAvailabilityState;
  unvalidatedTaskPatch: boolean;
  pendingValidationFiles: string[];
  noOpValidationSinceLastCheck: boolean;
  unresolvedReadOnlyTestPatchFailure: boolean;
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
  const availableToolNames = availableSmithTools(context.options, context.toolAvailabilityState).map((tool) => tool.name);

  if (!toolName || !availableToolNames.includes(toolName)) {
    return appendToolObservation(
      parentContext,
      callId,
      `Unknown or unavailable tool '${context.toolCall.name}'. Available tools: ${availableToolNames.join(", ")}.`
    );
  }

  if (toolName === "finish") {
    const message = toolTextArgument(parentContext.toolCall.arguments, ["message", "answer", "text", "output"]) ?? "";
    if (shouldRejectUnsupportedReadOnlyFinish(message, parentContext, availableToolNames)) {
      return appendToolObservation(
        parentContext,
        callId,
        "Finish rejected: read-only mode is not active and patch is available. Do not claim a read-only or permission blocker unless a tool output shows a read-only or permission failure. Use patch for a safe edit, or finish with the actual blocker from the tool evidence."
      );
    }
    if (shouldRejectCompletedReadOnlyTestPatchFinish(message, parentContext, availableToolNames)) {
      return appendToolObservation(
        parentContext,
        callId,
        "Finish rejected: a read-only test/spec patch failed, but the finish message still presents the task as complete. Treat read-only tests/specs as existing behavior to satisfy through source changes unless the user explicitly asked to edit them. Continue source compatibility work, or finish with a clear blocker/partial result if the requested work cannot be completed."
      );
    }
    if (shouldRejectReadOnlyTestPatchBlockerFinish(message, parentContext, availableToolNames)) {
      return appendToolObservation(
        parentContext,
        callId,
        "Finish rejected: a read-only test/spec patch failed, but the user did not explicitly ask to edit tests. Treat read-only tests/specs as existing behavior to satisfy through source changes, or finish with the actual non-test blocker."
      );
    }
    if (shouldRejectUnsupportedValidationUnavailableFinish(message, availableToolNames)) {
      return appendToolObservation(
        parentContext,
        callId,
        "Finish rejected: run is currently available. Do not claim validation is impossible because only patch/finish or no run tool is available. Run a relevant validation command, or finish with the actual blocker."
      );
    }
    if (shouldRejectActionableInspectionBlockerFinish(message, availableToolNames)) {
      return appendToolObservation(
        parentContext,
        callId,
        "Finish rejected: run is currently available, and the finish message says more inspection or diagnosis is needed. Use run to inspect the relevant failure, file, or script, or finish with the actual blocker."
      );
    }
    if (shouldRejectNoOpValidationClaimFinish(message, parentContext)) {
      return appendToolObservation(
        parentContext,
        callId,
        "Finish rejected: a previous validation command appeared to run no tests, but the finish message presents it as successful validation. Run a validation command that executes checks, or report validation as pending/not performed."
      );
    }
    const dirtyFinishTestFiles = await dirtyUnrequestedTestFiles(parentContext);
    if (
      dirtyFinishTestFiles.length > 0 &&
      (finishClaimsComplete(message) || finishClaimsValidationSuccess(message)) &&
      !finishAcknowledgesPendingValidation(message)
    ) {
      return appendToolObservation(
        parentContext,
        callId,
        `Finish rejected: test files are currently modified or untracked (${formatChangedFiles(dirtyFinishTestFiles)}), but the user did not explicitly ask to edit tests and the finish message claims completion or validation. Restore unrelated test edits, preserve compatibility with existing tests, or finish with an explicit pending-validation/blocker report.`
      );
    }
    if (shouldRejectContradictoryCompletionFinish(message, availableToolNames)) {
      return appendToolObservation(
        parentContext,
        callId,
        "Finish rejected: the message claims the task is done while also reporting incomplete or blocked requested work. Continue with available tools, or finish with a clear partial/blocker report that does not present the task as complete."
      );
    }
    if (shouldRejectUnvalidatedTaskPatchValidationClaimFinish(message, parentContext.unvalidatedTaskPatch)) {
      return appendToolObservation(
        parentContext,
        callId,
        "Finish rejected: a task patch is still not validated as complete, but the finish message claims successful validation. Finish with an explicit pending-validation or blocker report, or continue if tools are available."
      );
    }
    if (shouldRejectIncompleteRequirementsFinish(message, parentContext, availableToolNames)) {
      return appendToolObservation(
        parentContext,
        callId,
        "Finish rejected: the prompt has explicit requirements, and the finish message says requested items remain incomplete without a concrete external blocker. Continue implementing the remaining requirements, or finish with a specific environment, access, dependency, or user-input blocker that prevents further progress."
      );
    }
    if (shouldRejectUnvalidatedTaskPatchFinish(message, parentContext.unvalidatedTaskPatch, availableToolNames)) {
      return appendToolObservation(
        parentContext,
        callId,
        "Finish rejected: a task patch is still pending validation. Run a relevant validation command, or finish with an explicit blocker or pending-validation report if validation is not practical."
      );
    }
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
  let patchContextFailed = false;
  let readOnlyTestPatchFailed = false;
  try {
    const result = applySmithPatch(patch, parentContext.options.cwd);
    changedFiles = result.changedFiles;
    output = `Applied patch to ${result.changedFiles.join(", ")}`;
    if (!changedFilesAreOnlySmithMemory(result.changedFiles)) {
      output = `${output}\nTask patch pending validation: run a relevant test, build, lint, typecheck, check, or verify command before finish when practical. Inspection commands do not validate the patch.`;
      const removedDeclarations = removedDeclarationNamesFromPatch(patch);
      if (removedDeclarations.length > 0) {
        output = `${output}\nCompatibility note: this patch removes or renames declarations: ${removedDeclarations.map((name) => `\`${name}\``).join(", ")}. Search for remaining callers or keep compatibility wrappers when existing callers may still use them before treating validation as complete.`;
      }
      const changedDeclarationSignatures = changedDeclarationSignatureNamesFromPatch(patch);
      if (changedDeclarationSignatures.length > 0) {
        output = `${output}\nCompatibility note: this patch changes declaration signatures: ${changedDeclarationSignatures.map((name) => `\`${name}\``).join(", ")}. Search for existing callers and keep wrappers or adapters when existing callers may use the old signature before treating validation as complete.`;
      }
      const changedTestFiles = result.changedFiles.filter(isLikelyTestFilePath);
      if (changedTestFiles.length > 0) {
        output = `${output}\nTest files changed: ${formatChangedFiles(changedTestFiles)}. Local validation may include the changed tests; if the user did not ask to update tests, preserve compatibility with the existing test behavior too.`;
      }
    }
  } catch (error) {
    patchContextFailed = isPatchContextMismatchError(error);
    readOnlyTestPatchFailed = isReadOnlyTestPatchFailure(error);
    output = formatPatchFailure(error);
  }
  const transcript = appendTerminalTurn(parentContext.transcript, "patch", output);
  const providerMessages = appendProviderTerminalTurn(parentContext.providerMessages, "patch", output);
  const responsesInputItems = appendResponsesTerminalOutput(parentContext.responsesInputItems, callId, output);
  parentContext.options.trace?.write("tool output", output);
  if (output) parentContext.options.onTerminalOutput?.(output);
  return {
    transcript,
    providerMessages,
    responsesInputItems,
    toolOutput: output,
    totalUsage,
    ...(changedFiles ? { changedFiles } : {}),
    ...(patchContextFailed ? { patchContextFailed: true } : {}),
    ...(readOnlyTestPatchFailed ? { readOnlyTestPatchFailed: true } : {})
  };
}

function changedFilesAreOnlySmithMemory(changedFiles: string[]): boolean {
  return changedFiles.length > 0 && changedFiles.every(isRootSmithMemoryFile);
}

function removedDeclarationNamesFromPatch(patch: string): string[] {
  const removed = new Set<string>();
  const added = new Set<string>();
  for (const line of patch.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    const marker = line[0];
    if (marker !== "-" && marker !== "+") continue;
    for (const name of declarationNamesFromLine(line.slice(1))) {
      if (marker === "-") removed.add(name);
      else added.add(name);
    }
  }
  return [...removed].filter((name) => !added.has(name)).slice(0, 8);
}

function changedDeclarationSignatureNamesFromPatch(patch: string): string[] {
  const removed = new Map<string, Set<string>>();
  const added = new Map<string, Set<string>>();
  for (const line of patch.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    const marker = line[0];
    if (marker !== "-" && marker !== "+") continue;
    const signature = declarationSignatureFromLine(line.slice(1));
    if (!signature) continue;
    const target = marker === "-" ? removed : added;
    const signatures = target.get(signature.name) ?? new Set<string>();
    signatures.add(signature.normalized);
    target.set(signature.name, signatures);
  }
  return [...removed]
    .filter(([name, removedSignatures]) => {
      const addedSignatures = added.get(name);
      if (!addedSignatures) return false;
      return [...removedSignatures].some((signature) => !addedSignatures.has(signature));
    })
    .map(([name]) => name)
    .slice(0, 8);
}

function declarationNamesFromLine(line: string): string[] {
  const patterns = [
    /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/,
    /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/,
    /^\s*def\s+([A-Za-z_]\w*)\s*\(/,
    /^\s*class\s+([A-Za-z_]\w*)\b/
  ];
  return patterns.flatMap((pattern) => {
    const match = pattern.exec(line);
    return match ? [match[1]] : [];
  });
}

function declarationSignatureFromLine(line: string): { name: string; normalized: string } | undefined {
  const patterns = [
    /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/,
    /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/,
    /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(line);
    if (match) {
      return { name: match[1], normalized: normalizeDeclarationSignature(line) };
    }
  }
  return undefined;
}

function normalizeDeclarationSignature(line: string): string {
  return line
    .replace(/\s*(?:\{|=>).*$/, "")
    .replace(/:\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function trackedGitChangeSet(cwd: string, options: { includeUntracked?: boolean } = {}): Promise<Set<string> | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain=v1", options.includeUntracked ? "--untracked-files=all" : "--untracked-files=no"],
      {
        cwd,
        timeout: 5_000,
        maxBuffer: 1_000_000
      }
    );
    return new Set(
      stdout
        .split("\n")
        .map((line) => line.slice(3).trim())
        .filter(Boolean)
        .map((path) => path.split(" -> ").at(-1) ?? path)
    );
  } catch {
    return undefined;
  }
}

function changedTrackedFiles(before: Set<string> | undefined, after: Set<string> | undefined): string[] {
  if (!before || !after) return [];
  return [...after].filter((path) => !before.has(path)).sort();
}

function changedTrackedTestFiles(changes: Set<string> | undefined): string[] {
  if (!changes) return [];
  return [...changes].filter(isLikelyTestFilePath).sort();
}

function changedSourceFiles(changes: string[]): string[] {
  return changes.filter((path) => !isLikelyTestFilePath(path) && !isRootSmithMemoryFile(path)).sort();
}

function formatChangedFiles(changedFiles: string[]): string {
  const visible = changedFiles.slice(0, 8).join(", ");
  return changedFiles.length > 8 ? `${visible}, and ${changedFiles.length - 8} more` : visible;
}

function isRootSmithMemoryFile(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  return normalized === "SMITH.md" || normalized === "SMITH.TASK.md";
}

function isLikelyTestFilePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  return (
    /(?:^|\/)(?:tests?|spec|__tests__)(?:\/|$)/i.test(normalized) ||
    /(?:^|\/)[^\/]+(?:\.test|\.spec|_test)\.[^\/]+$/i.test(normalized)
  );
}

async function runShellCommandTool(
  parentContext: ToolCallContext,
  callId: string | undefined,
  command: string,
  transcriptCommand?: string
): Promise<ToolActionResult> {
  const validationCommand = isLikelyValidationCommand(command);
  const inspectionCommand = isLikelyInspectionCommand(command);
  const postDeadlineValidationRun = Boolean(parentContext.toolAvailabilityState.postDeadlineValidationRunReason);
  const postDeadlineInspectionRun = Boolean(parentContext.toolAvailabilityState.postDeadlineInspectionRunReason);
  if (
    (postDeadlineValidationRun || postDeadlineInspectionRun) &&
    !((postDeadlineValidationRun && validationCommand) || (postDeadlineInspectionRun && inspectionCommand))
  ) {
    return appendToolObservation(
      parentContext,
      callId,
      "Post-deadline run is reserved for validation commands such as test, build, lint, typecheck, check, or verify, or for one short inspection command after a failed validation. Use patch for a known final edit or finish with the current result."
    );
  }
  if (isLikelyHeredocFileWrite(command)) {
    return {
      ...appendToolObservation(
        parentContext,
        callId,
        "Run command rejected: heredoc-style file rewrites through the interactive shell can corrupt source text, especially indentation and tab-heavy code. Use the patch tool for file edits, or use run only for generated artifacts after verifying the command changed the intended file."
      ),
      unsafeRunEditRejected: true
    };
  }
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

  const trackedChangesBefore = await trackedGitChangeSet(parentContext.options.cwd);
  const requestedTimeoutMs = timeoutFromToolCall(parentContext.toolCall.arguments, parentContext.options.runtime.timeoutMs);
  const validationTimeoutFloorMs = validationCommand
    ? Math.min(parentContext.options.runtime.timeoutMs, VALIDATION_RUN_MIN_TIMEOUT_MS)
    : requestedTimeoutMs;
  const effectiveRequestedTimeoutMs = validationCommand
    ? Math.max(requestedTimeoutMs, validationTimeoutFloorMs)
    : requestedTimeoutMs;
  const timeoutMs =
    postDeadlineInspectionRun && inspectionCommand && !validationCommand
      ? Math.min(effectiveRequestedTimeoutMs, POST_DEADLINE_INSPECTION_RUN_TIMEOUT_MS)
      : postDeadlineValidationRun && validationCommand
        ? Math.min(effectiveRequestedTimeoutMs, POST_DEADLINE_VALIDATION_RUN_TIMEOUT_MS)
        : effectiveRequestedTimeoutMs;
  const result = await parentContext.shell.run(command, timeoutMs);
  const trackedChangesAfter = await trackedGitChangeSet(parentContext.options.cwd);
  const allChangesAfter = await trackedGitChangeSet(parentContext.options.cwd, { includeUntracked: true });
  const runChangedFiles = changedTrackedFiles(trackedChangesBefore, trackedChangesAfter);
  const dirtyTestFiles = changedTrackedTestFiles(allChangesAfter);
  const rawTerminalOutput = result.timedOut
    ? formatTimeoutOutput(result.command, result.elapsedMs, result.lastOutput)
    : formatTerminalOutput(result.output, result.exitCode);
  const noOpValidation = validationCommand && isNoOpValidationOutput(rawTerminalOutput);
  const failedValidation = validationCommand && !noOpValidation && (result.timedOut || result.exitCode !== 0);
  const cachedValidation =
    validationCommand &&
    parentContext.unvalidatedTaskPatch &&
    !noOpValidation &&
    !failedValidation &&
    isCachedValidationOutput(command, rawTerminalOutput);
  const uncoveredValidation =
    validationCommand &&
    parentContext.unvalidatedTaskPatch &&
    !noOpValidation &&
    !failedValidation &&
    !cachedValidation &&
    validationMissesChangedSourceFiles(command, parentContext.pendingValidationFiles);
  const narrowValidation =
    validationCommand && !noOpValidation && !failedValidation && !uncoveredValidation && isNarrowValidationCommand(command);
  const testModifiedValidation =
    validationCommand &&
    parentContext.unvalidatedTaskPatch &&
    !noOpValidation &&
    !failedValidation &&
    !cachedValidation &&
    !uncoveredValidation &&
    changedSourceFiles(parentContext.pendingValidationFiles).length > 0 &&
    dirtyTestFiles.length > 0;
  const unrequestedTestModifiedValidation =
    validationCommand &&
    parentContext.unvalidatedTaskPatch &&
    !noOpValidation &&
    !failedValidation &&
    !cachedValidation &&
    !uncoveredValidation &&
    dirtyTestFiles.length > 0 &&
    !promptExplicitlyRequestsTestEdits(parentContext.options.prompt);
  const sourcePatchValidationEvidence =
    validationCommand &&
    !noOpValidation &&
    !failedValidation &&
    !cachedValidation &&
    !uncoveredValidation &&
    !testModifiedValidation &&
    !unrequestedTestModifiedValidation;
  let annotatedTerminalOutput = rawTerminalOutput;
  if (noOpValidation) {
    annotatedTerminalOutput = `${rawTerminalOutput}\nValidation warning: this command appears to have run no tests, so any pending task patch still needs a relevant validation command.`;
  } else if (failedValidation) {
    annotatedTerminalOutput = `${rawTerminalOutput}\nValidation failed: any pending task patch is not validated as complete. Inspect referenced files or failure locations before follow-up patches, then fix the failure, run a passing validation command, or finish with the blocker.`;
    if (
      parentContext.unvalidatedTaskPatch &&
      changedSourceFiles(parentContext.pendingValidationFiles).length > 0 &&
      failedValidationReportsMissingDeclarations(rawTerminalOutput)
    ) {
      annotatedTerminalOutput = `${annotatedTerminalOutput}\nCompatibility hint: validation reports missing declarations, fields, methods, or symbols after source changes. Search for the referenced names and existing callers, then add or restore source declarations or compatibility wrappers when appropriate.`;
    }
    if (
      parentContext.unvalidatedTaskPatch &&
      changedSourceFiles(parentContext.pendingValidationFiles).length > 0 &&
      failedValidationReportsSignatureMismatches(rawTerminalOutput)
    ) {
      annotatedTerminalOutput = `${annotatedTerminalOutput}\nCompatibility hint: validation reports argument, assignment, or return-value mismatches after source changes. Prefer a small source compatibility fix: update call sites when the new signature is intentional, or keep wrappers/adapters for existing callers before broader rewrites.`;
    }
  } else if (cachedValidation) {
    annotatedTerminalOutput = `${rawTerminalOutput}\nValidation warning: this command reused cached test results while a task patch is pending. Rerun validation with caching disabled, for example with an appropriate no-cache or force-recheck option, before treating the patch as validated.`;
  } else if (uncoveredValidation) {
    annotatedTerminalOutput = `${rawTerminalOutput}\nValidation warning: this command did not appear to cover all changed source directories: ${formatChangedFiles(uncoveredChangedSourceDirs(command, parentContext.pendingValidationFiles))}. Run validation for the remaining changed directories or a broader package/project check before treating the patch as validated.`;
  } else if (narrowValidation) {
    annotatedTerminalOutput = `${rawTerminalOutput}\nValidation warning: this command selected a subset of checks. Any pending task patch is only narrowly validated; run a broader package or project test, build, lint, typecheck, check, or verify command before finish when practical.`;
  }
  if (validationCommand && !noOpValidation && !failedValidation && dirtyTestFiles.length > 0) {
    annotatedTerminalOutput = `${annotatedTerminalOutput}\nValidation warning: test files are currently modified or untracked: ${formatChangedFiles(dirtyTestFiles)}. Passing results may reflect those edited tests; if the user did not ask to update tests, preserve compatibility with the existing test behavior too.`;
  }
  if (testModifiedValidation) {
    annotatedTerminalOutput = `${annotatedTerminalOutput}\nValidation warning: a source patch is still pending validation because this passing command ran while test files were modified or newly added. Re-run a relevant validation after restoring unrelated test edits, or finish with an explicit pending-validation note if the edited tests are intentional.`;
  }
  if (unrequestedTestModifiedValidation && !testModifiedValidation) {
    annotatedTerminalOutput = `${annotatedTerminalOutput}\nValidation warning: a task patch is still pending validation because this passing command ran while test files were modified or newly added, and the user did not explicitly ask to edit tests. Restore unrelated test edits or preserve compatibility with existing tests before treating validation as complete.`;
  }
  if (runChangedFiles.length > 0) {
    annotatedTerminalOutput = `${annotatedTerminalOutput}\nRun command changed tracked files: ${formatChangedFiles(runChangedFiles)}\nTask patch pending validation: run a relevant test, build, lint, typecheck, check, or verify command before finish when practical.`;
  }
  const terminalOutput = limitToolOutput(annotatedTerminalOutput, parentContext.options.runtime.maxToolOutputChars);
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
    ...(noOpValidation ? { noOpValidationRun: true } : {}),
    ...(validationCommand && !noOpValidation ? { nonNoOpValidationRun: true } : {}),
    ...(postDeadlineValidationRun &&
    !noOpValidation &&
    !failedValidation &&
    !cachedValidation &&
    !uncoveredValidation &&
    !narrowValidation &&
    !testModifiedValidation &&
    !unrequestedTestModifiedValidation
      ? { postDeadlineValidationRunConsumed: true }
      : {}),
    ...(postDeadlineInspectionRun && inspectionCommand && !validationCommand ? { postDeadlineInspectionRunConsumed: true } : {}),
    ...(postDeadlineValidationRun && failedValidation ? { postDeadlineValidationFailed: true } : {}),
    ...(validationCommand &&
    !noOpValidation &&
    !failedValidation &&
    !cachedValidation &&
    !uncoveredValidation &&
    !narrowValidation &&
    !testModifiedValidation &&
    !unrequestedTestModifiedValidation
      ? { validationRunExecuted: true }
      : {}),
    ...(sourcePatchValidationEvidence ? { sourcePatchValidationEvidence: true } : {}),
    ...(runChangedFiles.length > 0 ? { changedFiles: runChangedFiles } : {})
  };
}

function isLikelyValidationCommand(command: string): boolean {
  const trimmed = command.trim();
  if (isLikelyInspectionCommand(trimmed) && !hasValidationSegmentAfterShellOperator(trimmed)) {
    return false;
  }
  return containsValidationCommand(trimmed);
}

function hasValidationSegmentAfterShellOperator(command: string): boolean {
  const segments = command.split(/(?:&&|\|\||;|\n)/).map((segment) => segment.trim());
  return segments.slice(1).some((segment) => segment.length > 0 && !isLikelyInspectionCommand(segment) && containsValidationCommand(segment));
}

function containsValidationCommand(command: string): boolean {
  return /\b(?:go\s+test|cargo\s+test|pytest|vitest|jest|mocha|rspec|npm\s+(?:run\s+)?test|yarn\s+test|pnpm\s+test|mvn\s+test|gradle\s+test|test|build|compile|lint|typecheck|tsc|check|verify(?:\.sh)?)\b/i.test(
    command
  );
}

function isLikelyHeredocFileWrite(command: string): boolean {
  return /\bcat\s*>\s*(?:\.\/)?[^\s<>|;&]+[\s\S]*<<-?\s*['"]?\w+['"]?/i.test(command);
}

function validationMissesChangedSourceFiles(command: string, changedFiles: string[]): boolean {
  return uncoveredChangedSourceDirs(command, changedFiles).length > 0;
}

function uncoveredChangedSourceDirs(command: string, changedFiles: string[]): string[] {
  const goPackages = goTestPackageArgs(command);
  if (!goPackages) return [];
  return [
    ...new Set(
      changedFiles
        .map((path) => path.replace(/\\/g, "/").replace(/^\.\//, ""))
        .filter((path) => path.endsWith(".go") && !isLikelyTestFilePath(path))
        .map((path) => path.split("/").slice(0, -1).join("/") || ".")
        .filter((dir) => !goPackages.some((pkg) => goPackageCoversDir(pkg, dir)))
    )
  ].sort();
}

function goTestPackageArgs(command: string): string[] | undefined {
  const tokens = command.match(/"[^"]+"|'[^']+'|\S+/g)?.map((token) => token.replace(/^["']|["']$/g, "")) ?? [];
  const goIndex = tokens.findIndex((token) => token === "go");
  if (goIndex < 0 || tokens[goIndex + 1] !== "test") return undefined;
  const packages: string[] = [];
  for (let i = goIndex + 2; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    if (token === "--") continue;
    if (token.startsWith("-")) {
      if (goTestFlagConsumesValue(token) && !token.includes("=")) i += 1;
      continue;
    }
    if (/^(?:\.|\/|[A-Za-z0-9_.-]+\/)/.test(token)) packages.push(token);
  }
  return packages.length > 0 ? packages : undefined;
}

function goTestFlagConsumesValue(flag: string): boolean {
  return /^-(?:run|bench|benchtime|count|coverprofile|coverpkg|cpu|list|mod|modfile|o|outputdir|parallel|shuffle|tags|timeout|vet)$/i.test(
    flag
  );
}

function goPackageCoversDir(pkg: string, dir: string): boolean {
  const normalizedPkg = pkg.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  const normalizedDir = dir.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "") || ".";
  if (normalizedPkg === "..." || normalizedPkg === "./...") return true;
  if (normalizedPkg.endsWith("/...")) {
    const prefix = normalizedPkg.slice(0, -4) || ".";
    if (prefix === ".") return true;
    return normalizedDir === prefix || normalizedDir.startsWith(`${prefix}/`);
  }
  if (normalizedPkg === "." || normalizedPkg === "") return normalizedDir === ".";
  return normalizedDir === normalizedPkg;
}

function isLikelyInspectionCommand(command: string): boolean {
  return /^(?:env\s+)?(?:sed|cat|less|more|head|tail|grep|rg|find|ls|pwd|wc|nl|printf|echo)\b/i.test(command.trim());
}

function isNoOpValidationOutput(output: string): boolean {
  return /\b(?:no tests? to run|no tests? found|collected 0 items|0 tests? (?:run|collected|found))\b/i.test(output);
}

function isCachedValidationOutput(command: string, output: string): boolean {
  return /\bgo\s+test\b/i.test(command) && /\bok\s+\S+\s+\(cached\)/i.test(output);
}

function failedValidationReportsMissingDeclarations(output: string): boolean {
  return /\b(?:undefined|not defined|is not defined|cannot find name|cannot find symbol|unresolved reference|unresolved symbol|symbol not found|no field or method|no member named|has no member|does not exist|unknown field|undefined:)\b/i.test(
    output
  );
}

function failedValidationReportsSignatureMismatches(output: string): boolean {
  return /\b(?:assignment mismatch|too (?:few|many) (?:arguments|values)|not enough (?:arguments|values)|expected \d+ arguments?,? but got \d+|got \d+ arguments? but (?:takes|expected)|takes? \d+ (?:positional )?arguments? but \d+ (?:were )?given|multiple-value .* in single-value context|single-value context|returns? \d+ values?)\b/i.test(
    output
  );
}

function isNarrowValidationCommand(command: string): boolean {
  if (
    /(?:^|\s)(?:-run|-[km]|--(?:grep|fgrep|filter|only|include|exclude|spec|file|files|testNamePattern|testPathPattern|testPathPatterns|runTestsByPath))(?:[=\s]|$)/i.test(
      command
    )
  ) {
    return true;
  }
  if (/\bnode\s+(?:--[^\s]+\s+)*(?:\.\/)?(?:[^\/\s]+\/)*(?:tests?|spec)\.(?:js|jsx|ts|tsx|mjs|cjs)(?:\s|$)/i.test(command)) {
    return true;
  }
  const tokens = command.match(/"[^"]+"|'[^']+'|\S+/g) ?? [];
  return tokens.some((rawToken) => {
    const token = rawToken.replace(/^["']|["']$/g, "");
    if (token.includes("::")) return true;
    return /(?:^|\/)(?:test_[^\/]+|[^\/]+(?:\.test|\.spec|_test))\.(?:py|js|jsx|ts|tsx|go|rb|java|rs)$/i.test(
      token
    );
  });
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
    const output = failedSubAgentOutput(error, context.options.runtime.maxToolOutputChars);
    return {
      ...appendToolObservation({ ...context, totalUsage }, callId, output),
      ...(isSubAgentTurnLimitFailure(error) ? { subAgentTurnLimitFailure: true } : {})
    };
  }
}

function failedSubAgentOutput(error: unknown, maxChars: number): string {
  const message = `sub_agent failed: ${errorMessage(error)}`;
  if (!(error instanceof SmithRunFailure) || !error.transcript?.trim()) return message;
  const tail = tailText(error.transcript, maxChars > 0 ? Math.min(maxChars, 8000) : 8000);
  return limitToolOutput(`${message}\nRecent failed sub-agent transcript tail:\n${tail}`, maxChars);
}

function tailText(text: string, maxChars: number): string {
  if (maxChars <= 0 || text.length <= maxChars) return text;
  return `[showing last ${maxChars} of ${text.length} chars]\n${text.slice(text.length - maxChars)}`;
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

function shouldRejectUnsupportedReadOnlyFinish(
  message: string,
  context: ToolCallContext,
  availableToolNames: string[]
): boolean {
  if (context.options.runtime.readOnly || !availableToolNames.includes("patch")) return false;
  if (!/\b(?:read-only|readonly|not writable|permission)\b/i.test(message)) return false;
  if (!/\b(?:cannot|can't|could not|couldn't|unable|blocked|not able|no permission|permission denied)\b/i.test(message)) {
    return false;
  }
  return !transcriptHasReadOnlyEvidence(context.transcript);
}

function transcriptHasReadOnlyEvidence(transcript: string): boolean {
  return /\b(?:Read-only mode is active|patch failed:[\s\S]{0,200}(?:EACCES|EROFS|EPERM|permission denied|read-only file system|not writable)|(?:EACCES|EROFS|EPERM|permission denied|read-only file system))\b/i.test(
    transcript
  );
}

function shouldRejectCompletedReadOnlyTestPatchFinish(
  message: string,
  context: ToolCallContext,
  availableToolNames: string[]
): boolean {
  if (context.options.runtime.readOnly || !availableToolNames.includes("patch")) return false;
  if (!context.unresolvedReadOnlyTestPatchFailure) return false;
  if (finishAcknowledgesPendingValidation(message)) return false;
  return /\b(?:done|complete[sd]?|implemented|fixed|resolved|passes?|passing|validated|verified|compile[sd]?|builds?|works?)\b/i.test(
    message
  );
}

function shouldRejectReadOnlyTestPatchBlockerFinish(
  message: string,
  context: ToolCallContext,
  availableToolNames: string[]
): boolean {
  if (context.options.runtime.readOnly || !availableToolNames.includes("patch")) return false;
  if (!context.unresolvedReadOnlyTestPatchFailure) return false;
  if (promptExplicitlyRequestsTestEdits(context.options.prompt)) return false;
  if (!/\b(?:read-only|readonly|not writable|permission denied|permission|EROFS)\b/i.test(message)) return false;
  if (!/\b(?:test|tests|spec|specs|_test|\.test|\.spec)\b/i.test(message)) return false;
  return /\b(?:cannot|can't|could not|couldn't|unable|blocked|not able|no permission|permission denied)\b/i.test(message);
}

function promptExplicitlyRequestsTestEdits(prompt: string): boolean {
  return /\b(?:add|write|create|update|modify|edit|change|fix|patch)\b[\s\S]{0,80}\b(?:tests?|specs?|test coverage|coverage)\b/i.test(
    prompt
  );
}

function shouldRejectUnsupportedValidationUnavailableFinish(message: string, availableToolNames: string[]): boolean {
  if (!availableToolNames.includes("run")) return false;
  if (!/\b(?:validat\w*|test|build|lint|typecheck|check|verify)\b/i.test(message)) return false;
  if (!/\b(?:not able|unable|cannot|can't|could not|couldn't|wasn'?t able|blocked|impossible)\b/i.test(message)) {
    return false;
  }
  return /\b(?:only\s+(?:patch\s*(?:\/|,|\s+and\s+)\s*finish|finish\s*(?:\/|,|\s+and\s+)\s*patch)|no\s+(?:(?:inspection\s*\/\s*)?validation|run)\s+tools?|run\s+(?:is\s+)?unavailable|no further tool)\b/i.test(
    message
  ) || /\b(?:validation|test|build|lint|typecheck|check|verify)\s+(?:commands?|tooling)\s+(?:were|are|is|was)?\s*unavailable\b/i.test(message);
}

function shouldRejectActionableInspectionBlockerFinish(message: string, availableToolNames: string[]): boolean {
  if (!availableToolNames.includes("run")) return false;
  if (!/\b(?:need|needs|needed|must|should|would need|blocked)\b[\s\S]{0,160}\b(?:inspect|diagnose|read|check|look at|examine|review)\b/i.test(message)) {
    return false;
  }
  return /\b(?:failure|failed|failing|error|trace|log|file|script|test|before (?:I )?(?:can )?(?:safely )?(?:finish|complete|continue|proceed))\b/i.test(
    message
  );
}

function shouldRejectNoOpValidationClaimFinish(message: string, context: ToolCallContext): boolean {
  if (!context.noOpValidationSinceLastCheck) return false;
  if (finishAcknowledgesValidationNotPerformed(message)) return false;
  return /\b(?:validat(?:e|ed|ion)|tests?|checks?|build|compile|lint|typecheck|verify|verified)\b[\s\S]{0,120}\b(?:pass(?:ed|es)?|ok|success(?:ful)?|clean|validated|verified|complete)\b/i.test(
    message
  ) || /\b(?:pass(?:ed|es)?|ok|success(?:ful)?|clean|validated|verified|complete)\b[\s\S]{0,120}\b(?:validat(?:e|ed|ion)|tests?|checks?|build|compile|lint|typecheck|verify|verified)\b/i.test(
    message
  );
}

async function dirtyUnrequestedTestFiles(context: ToolCallContext): Promise<string[]> {
  if (context.options.runtime.readOnly || promptExplicitlyRequestsTestEdits(context.options.prompt)) return [];
  return changedTrackedTestFiles(await trackedGitChangeSet(context.options.cwd, { includeUntracked: true }));
}

function shouldRejectContradictoryCompletionFinish(message: string, availableToolNames: string[]): boolean {
  if (!availableToolNames.some((toolName) => toolName === "run" || toolName === "patch")) return false;
  if (!finishClaimsComplete(message)) return false;
  return finishReportsIncompleteRequirements(message);
}

function finishClaimsComplete(message: string): boolean {
  return /^\s*(?:done|complete[sd]?|fixed|resolved)\b/i.test(message) || /\b(?:fully|all)\s+(?:done|complete[sd]?|implemented|fixed|resolved|validated)\b/i.test(
    message
  ) || /\b(?:implemented|fixed|resolved)\s+and\s+(?:validated|verified|tested)\b/i.test(message);
}

function finishAcknowledgesValidationNotPerformed(message: string): boolean {
  return /\b(?:validation (?:is |remains )?pending|pending validation|not validated|not fully validated|needs validation|need(?:s|ed)? (?:more )?validation|could not validate|couldn't validate|unable to validate|not able to validate|validation did not run|no tests? (?:ran|were run)|ran no tests|without validation)\b/i.test(
    message
  );
}

function shouldRejectUnvalidatedTaskPatchFinish(
  message: string,
  unvalidatedTaskPatch: boolean,
  availableToolNames: string[]
): boolean {
  if (!unvalidatedTaskPatch || !availableToolNames.includes("run")) return false;
  if (finishAcknowledgesPendingValidation(message)) return false;
  return true;
}

function shouldRejectUnvalidatedTaskPatchValidationClaimFinish(message: string, unvalidatedTaskPatch: boolean): boolean {
  if (!unvalidatedTaskPatch) return false;
  if (finishAcknowledgesPendingValidation(message)) return false;
  return finishClaimsValidationSuccess(message);
}

function finishClaimsValidationSuccess(message: string): boolean {
  return /\b(?:validat(?:e|ed|ion)|tests?|checks?|build|compile|lint|typecheck|verify|verified)\b[\s\S]{0,120}\b(?:pass(?:ed|es)?|ok|success(?:ful)?|clean|validated|verified|complete)\b/i.test(
    message
  ) || /\b(?:pass(?:ed|es)?|ok|success(?:ful)?|clean|validated|verified|complete)\b[\s\S]{0,120}\b(?:validat(?:e|ed|ion)|tests?|checks?|build|compile|lint|typecheck|verify|verified)\b/i.test(
    message
  );
}

function shouldRejectIncompleteRequirementsFinish(
  message: string,
  context: ToolCallContext,
  availableToolNames: string[]
): boolean {
  if (!promptHasExplicitRequirements(context.options.prompt)) return false;
  if (!availableToolNames.some((toolName) => toolName === "run" || toolName === "patch")) return false;
  if (!finishReportsIncompleteRequirements(message)) return false;
  return !finishReportsConcreteBlocker(message);
}

function finishReportsIncompleteRequirements(message: string): boolean {
  return /(?:^|\n)\s*[-*]\s*\[\s\]/.test(message) || /\b(?:remaining (?:requirements?|checklist|items)|incomplete|not (?:fixed|implemented|done|complete)|not yet|has not been|have not been|still (?:needs?|relies|uses|emits|missing))\b/i.test(
    message
  );
}

function finishReportsConcreteBlocker(message: string): boolean {
  return /\b(?:permission denied|not writable|read-only|missing (?:dependency|package|tool|service|credential|credentials)|dependency (?:is )?missing|environment (?:issue|limitation|does not support|is missing)|network (?:unavailable|blocked|failure)|access (?:denied|blocked|unavailable)|requires? (?:user|manual|external|network|credential|credentials)|cannot continue because (?:the )?(?:required )?(?:dependency|tool|service|credential|credentials|environment|network)|not practical (?:in|with|without) (?:this|the) (?:environment|workspace|available tools)|impossible (?:in|with|without) (?:this|the) (?:environment|workspace|available tools))\b/i.test(
    message
  );
}

function finishAcknowledgesPendingValidation(message: string): boolean {
  return /\b(?:validation (?:is |remains )?pending|pending validation|not validated|not fully validated|needs validation|need(?:s|ed)? (?:more )?validation|could not validate|couldn't validate|unable to validate|not able to validate|validation failed|tests? failed|build failed|lint failed|typecheck failed|blocked|blocker|partial|incomplete)\b/i.test(
    message
  );
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

function formatPatchFailure(error: unknown): string {
  const message = errorMessage(error);
  const nonWritable = /\b(?:EACCES|EBUSY|EROFS|EPERM)\b|permission denied|read-only file system|resource busy or locked/i.test(message);
  const guidance = nonWritable
    ? [
        "The target path is not writable in this workspace; do not keep retrying the same patch unless permissions change. If the task can be solved by changing other writable files, patch those instead of treating this path as the whole blocker.",
        patchFailureMentionsLikelyTestPath(message)
          ? "The unwritable path appears to be a test or spec file. If the user did not explicitly ask to update tests, treat the test as existing behavior to satisfy by changing source files instead of reporting the test file as the blocker."
          : ""
      ]
        .filter(Boolean)
        .join("\n")
    : /\bhunk context not found\b/i.test(message)
      ? "Patch context did not match the current file. Before retrying, inspect the exact current lines and send a smaller patch anchored to that output."
    : "";
  return ["patch failed: " + message, guidance].filter(Boolean).join("\n");
}

function isReadOnlyTestPatchFailure(error: unknown): boolean {
  const message = errorMessage(error);
  return /\b(?:EACCES|EBUSY|EROFS|EPERM)\b|permission denied|read-only file system|resource busy or locked/i.test(message) && patchFailureMentionsLikelyTestPath(message);
}

function isPatchContextMismatchError(error: unknown): boolean {
  return /\bhunk context not found\b/i.test(errorMessage(error));
}

function patchFailureMentionsLikelyTestPath(message: string): boolean {
  const matches = message.match(/[A-Za-z0-9._/@:+-]+(?:\\|\/)[A-Za-z0-9._/@:+\\/-]+/g) ?? [];
  return matches.some(isLikelyTestFilePath);
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
  toolAvailabilityState: ToolAvailabilityState;
}): Promise<SmithModelResponse> {
  const tools = availableSmithTools(context.options, context.toolAvailabilityState);
  const systemPrompt = systemPromptForAvailableTools(context.systemPrompt, tools, context.options, context.toolAvailabilityState);
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

function availableSmithTools(options: SmithRunOptions, availability: ToolAvailabilityState = {}) {
  const depth = options.subAgentDepth ?? 0;
  let tools = SMITH_TOOLS;
  if (options.runtime.readOnly) {
    tools = tools.filter((tool) => tool.name !== "patch");
  }
  if (availability.subAgentDisabledReason || !options.runtime.subAgentEnabled || depth >= MAX_SUB_AGENT_DEPTH) {
    tools = tools.filter((tool) => tool.name !== "sub_agent");
  }
  const hasPostDeadlineRunSlot = Boolean(
    availability.postDeadlineValidationRunReason || availability.postDeadlineInspectionRunReason
  );
  if (availability.inspectionDisabledReason && !hasPostDeadlineRunSlot) {
    tools = tools.filter((tool) => tool.name !== "run" && tool.name !== "sub_agent");
  } else if (availability.inspectionDisabledReason) {
    tools = tools.filter((tool) => tool.name !== "sub_agent");
  }
  if (availability.deadlineFinalizationReason) {
    tools = tools.filter((tool) => tool.name !== "sub_agent");
    if (!hasPostDeadlineRunSlot) {
      tools = tools.filter((tool) => tool.name !== "run");
    }
  }
  return tools;
}

function systemPromptForAvailableTools(
  systemPrompt: string,
  tools: typeof SMITH_TOOLS,
  options: SmithRunOptions,
  availability: ToolAvailabilityState = {}
): string {
  const notes: string[] = [];
  if ((options.subAgentDepth ?? 0) > 0) {
    notes.push(
      "You are running as a Smith sub-agent. Your final user input is your only delegated objective; earlier transcript entries are background context and do not expand the task."
    );
  }
  if (availability.subAgentDisabledReason || !options.runtime.subAgentEnabled || (options.subAgentDepth ?? 0) >= MAX_SUB_AGENT_DEPTH) {
    const available = tools.map((tool) => tool.name).join(", ");
    const reason = availability.subAgentDisabledReason ?? (options.runtime.subAgentEnabled
      ? "Sub-agent depth limit has been reached for this run."
      : "Sub-agent delegation is disabled for this run.");
    notes.push(`${reason} The sub_agent tool is unavailable; complete the work directly with available tools: ${available}.`);
  }
  if (availability.inspectionDisabledReason) {
    const available = tools.map((tool) => tool.name).join(", ");
    notes.push(`${availability.inspectionDisabledReason} Continue with available tools: ${available}.`);
  }
  if (availability.deadlineFinalizationReason) {
    const available = tools.map((tool) => tool.name).join(", ");
    notes.push(`${availability.deadlineFinalizationReason} Continue with available tools: ${available}.`);
  }
  if (availability.postDeadlineValidationRunReason) {
    const available = tools.map((tool) => tool.name).join(", ");
    notes.push(`${availability.postDeadlineValidationRunReason} Continue with available tools: ${available}.`);
  }
  if (availability.postDeadlineInspectionRunReason) {
    const available = tools.map((tool) => tool.name).join(", ");
    notes.push(`${availability.postDeadlineInspectionRunReason} Continue with available tools: ${available}.`);
  }
  if (options.runtime.readOnly) {
    notes.push(
      "Read-only mode is active. The patch tool is unavailable, and run commands that write files are blocked. Inspect files and finish with findings only."
    );
  }
  return notes.length > 0 ? [systemPrompt, ...notes].join("\n\n") : systemPrompt;
}

function pauseInspectionAfterSustainedNoPatch(
  options: SmithRunOptions,
  availability: ToolAvailabilityState,
  toolCallsSincePatchOrFinish: number,
  hasUnvalidatedTaskPatch: boolean
): ToolAvailabilityState {
  if (availability.inspectionDisabledReason || availability.deadlineFinalizationReason) return availability;
  const patchAvailable = availableSmithTools(options, availability).some((tool) => tool.name === "patch");
  if (!patchAvailable || toolCallsSincePatchOrFinish < INSPECTION_PAUSE_TOOL_INTERVAL) return availability;
  if (hasUnvalidatedTaskPatch) return availability;
  return {
    ...availability,
    inspectionDisabledReason:
      "Sustained inspection has continued without a task patch or finish, so inspection tools are temporarily unavailable until a task patch is applied or the run finishes."
  };
}

function pauseInspectionAfterRepeatedRunEditRejections(
  options: SmithRunOptions,
  availability: ToolAvailabilityState
): ToolAvailabilityState {
  if (availability.inspectionDisabledReason || availability.deadlineFinalizationReason) return availability;
  const patchAvailable = availableSmithTools(options, availability).some((tool) => tool.name === "patch");
  if (!patchAvailable) return availability;
  return {
    ...availability,
    inspectionDisabledReason:
      "Repeated run commands attempted unsafe file rewrites and were rejected, so run is temporarily unavailable until a task patch is applied or the run finishes. Use patch for source edits."
  };
}

function retainPersistentToolAvailability(availability: ToolAvailabilityState): ToolAvailabilityState {
  return {
    ...(availability.deadlineFinalizationReason ? { deadlineFinalizationReason: availability.deadlineFinalizationReason } : {}),
    ...(availability.postDeadlineValidationRunReason
      ? { postDeadlineValidationRunReason: availability.postDeadlineValidationRunReason }
      : {}),
    ...(availability.postDeadlineInspectionRunReason
      ? { postDeadlineInspectionRunReason: availability.postDeadlineInspectionRunReason }
      : {})
  };
}

function availabilityAfterTaskPatch(availability: ToolAvailabilityState): ToolAvailabilityState {
  if (!availability.deadlineFinalizationReason) return availability;
  const rest = { ...availability };
  delete rest.postDeadlineInspectionRunReason;
  return {
    ...rest,
    postDeadlineValidationRunReason:
      "A task patch was applied after the configured max run time elapsed, so run is available for one bounded validation command before finalizing."
  };
}

function enforceRunDeadlineFinalization(
  options: SmithRunOptions,
  availability: ToolAvailabilityState,
  runStartedAt: number,
  hasUnvalidatedTaskPatch: boolean
): ToolAvailabilityState {
  if (availability.deadlineFinalizationReason || options.runtime.maxRunMs <= 0) return availability;
  if (Date.now() - runStartedAt < options.runtime.maxRunMs) return availability;
  return {
    ...availability,
    ...(hasUnvalidatedTaskPatch
      ? {
          postDeadlineValidationRunReason:
            "A task patch has not been validated and the configured max run time elapsed, so run is available for one bounded validation command before finalizing."
        }
      : {}),
    deadlineFinalizationReason:
      "The configured max run time has elapsed, so inspection and delegation tools are unavailable; use run only for an available validation slot, patch only for an already-identified final edit, or finish with the current result or blocker."
  };
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

function isSubAgentTurnLimitFailure(error: unknown): boolean {
  return error instanceof SmithRunFailure && /^model did not call finish within \d+ turns$/.test(error.message);
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
  return [appendChatIn(prompt), memoryFilePresence(cwd), taskChecklistReminder(prompt)].filter(Boolean).join("\n");
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

function taskChecklistReminder(prompt: string): string | undefined {
  if (!promptHasExplicitRequirements(prompt)) return undefined;
  return [
    "smith$ # task checklist",
    "The user prompt contains explicit requirements or checklist items. Track them as concrete todo items, and before finish verify each requested item is implemented, validated, or explicitly reported as incomplete or blocked."
  ].join("\n");
}

function promptHasExplicitRequirements(prompt: string): boolean {
  return /(?:^|\n)\s{0,3}(?:#{1,6}\s*)?(?:requirements?|acceptance criteria|todo|checklist)\s*:?\s*(?:\n|$)/i.test(
    prompt
  );
}

function progressReminderOutput(
  options: SmithRunOptions,
  availability: ToolAvailabilityState,
  toolCallsSincePatchOrFinish: number,
  turn: number,
  maxTurns: number
): string {
  const availableTools = availableSmithTools(options, availability).map((tool) => tool.name).join(", ");
  const patchAvailable = availableSmithTools(options, availability).some((tool) => tool.name === "patch");
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
  availability: ToolAvailabilityState,
  runStartedAt: number,
  reminderIndex: number
): string | undefined {
  const maxRunMs = options.runtime.maxRunMs;
  if (maxRunMs <= 0 || reminderIndex >= RUN_DEADLINE_REMINDER_THRESHOLDS.length) return undefined;
  const threshold = RUN_DEADLINE_REMINDER_THRESHOLDS[reminderIndex];
  const elapsedMs = Date.now() - runStartedAt;
  if (elapsedMs < maxRunMs * threshold) return undefined;
  const percentage = Math.round(threshold * 100);
  const availableTools = availableSmithTools(options, availability).map((tool) => tool.name).join(", ");
  const patchAvailable = availableSmithTools(options, availability).some((tool) => tool.name === "patch");
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
  const body = output.trim().length > 0 ? `${output.trimEnd()}\n${status}` : status;
  if (exitCode === 0) return body;
  return [`Command failed with exit status ${exitCode}.`, body].join("\n");
}

function limitToolOutput(output: string, maxChars: number): string {
  if (maxChars <= 0 || output.length <= maxChars) return output;
  const marker = `[smith truncated tool output: ${output.length} chars exceeded max_tool_output_chars=${maxChars}; showing head and tail; omitted content may contain relevant lines, so rerun a narrower command if needed]`;
  const separator = (omitted: number) => `\n[... omitted ${omitted} chars ...]\n`;
  const overhead = marker.length + separator(0).length;
  const budget = Math.max(0, maxChars - overhead);
  const headChars = Math.ceil(budget / 2);
  const tailChars = Math.floor(budget / 2);
  const omitted = Math.max(0, output.length - headChars - tailChars);
  const tail = tailChars > 0 ? output.slice(output.length - tailChars) : "";
  return `${marker}\n${output.slice(0, headChars)}${separator(omitted)}${tail}`;
}
