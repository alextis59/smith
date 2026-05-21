import type { SmithToolCall, SmithToolDefinition } from "./types.js";
import { isRecord, textValue } from "./types.js";

export const SMITH_TOOLS: SmithToolDefinition[] = [
  {
    name: "run",
    description: [
      "Run a terminal command in the task workspace and return stdout, stderr, and exit status.",
      "Use this to inspect files, run tests, and perform ordinary shell work.",
      "Prefer small, focused commands and use the terminal output already available before repeating inspections."
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "One short sentence explaining what this tool call is doing and why."
        },
        command: {
          type: "string",
          description: "Shell command to run."
        },
        timeout_ms: {
          type: "number",
          description: "Optional command timeout in milliseconds."
        }
      },
      required: ["reason", "command"],
      additionalProperties: false
    }
  },
  {
    name: "patch",
    description: [
      "Apply a focused Smith patch to files in the task workspace and return the patch result.",
      "Use this for source edits after inspecting the relevant file context.",
      "The patch text must use Smith's patch format with Begin Patch and End Patch markers."
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "One short sentence explaining what this patch changes and why."
        },
        patch: {
          type: "string",
          description: "Patch text in Smith patch format."
        },
        timeout_ms: {
          type: "number",
          description: "Optional patch command timeout in milliseconds."
        }
      },
      required: ["reason", "patch"],
      additionalProperties: false
    }
  },
  {
    name: "sub_agent",
    description: [
      "Launch a Smith sub_agent child run for independent repo-local work and return its final answer.",
      "Use this for broad file searches, subsystem reconnaissance, documentation reading, or scoped edits that can run independently.",
      "By default, the child run starts from the current transcript context with task as its final user input.",
      "Give the sub_agent child run clear ownership and a bounded task. Do not delegate work that depends on the next immediate result."
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "One short sentence explaining why this work should be delegated."
        },
        task: {
          type: "string",
          description: "Concrete task for the sub_agent child run."
        },
        cwd: {
          type: "string",
          description: "Optional workspace-relative or absolute directory for the sub_agent child run."
        },
        max_turns: {
          type: "number",
          description: "Optional maximum turns for the sub_agent child run."
        }
      },
      required: ["reason", "task"],
      additionalProperties: false
    }
  },
  {
    name: "finish",
    description: "End the Smith run with the final answer for the user.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "One short sentence explaining why the run is ready to finish."
        },
        message: {
          type: "string",
          description: "Final answer, blocker report, or question for the user."
        }
      },
      required: ["reason", "message"],
      additionalProperties: false
    }
  }
];

export function parseToolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function toolCallSummary(toolCalls: SmithToolCall[]): string {
  return toolCalls
    .map((call) => {
      const args = JSON.stringify(call.arguments);
      return `${call.name}(${args === undefined ? "{}" : args})`;
    })
    .join("\n");
}

export function smithToolName(name: string): SmithToolDefinition["name"] | undefined {
  return name === "run" || name === "patch" || name === "sub_agent" || name === "finish" ? name : undefined;
}

export function toolTextArgument(args: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    const value = textValue(args[name]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function toolReason(args: Record<string, unknown>): string | undefined {
  return toolTextArgument(args, ["reason", "why"]);
}
