import type { ProfileConfig } from "./config.js";
import type { SmithModelResponse } from "./providers/types.js";

export type TokenUsageCost = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd?: number;
};

export function summarizeUsage(
  usage: SmithModelResponse["usage"] | undefined,
  profile: ProfileConfig
): TokenUsageCost | undefined {
  if (!usage) return undefined;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const totalTokens = usage.totalTokens ?? inputTokens + outputTokens;
  const inputCost = costForTokens(inputTokens, profile.inputCostPerMillionTokens);
  const outputCost = costForTokens(outputTokens, profile.outputCostPerMillionTokens);
  const costUsd = inputCost === undefined && outputCost === undefined ? undefined : (inputCost ?? 0) + (outputCost ?? 0);
  return { inputTokens, outputTokens, totalTokens, ...(costUsd !== undefined ? { costUsd } : {}) };
}

export function addUsageCost(left: TokenUsageCost | undefined, right: TokenUsageCost | undefined): TokenUsageCost | undefined {
  if (!left) return right;
  if (!right) return left;
  const costUsd = left.costUsd === undefined && right.costUsd === undefined ? undefined : (left.costUsd ?? 0) + (right.costUsd ?? 0);
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    ...(costUsd !== undefined ? { costUsd } : {})
  };
}

export function formatUsageCost(usage: TokenUsageCost): string {
  return [
    `input_tokens: ${usage.inputTokens}`,
    `output_tokens: ${usage.outputTokens}`,
    `total_tokens: ${usage.totalTokens}`,
    ...(usage.costUsd !== undefined ? [`cost_usd: ${usage.costUsd.toFixed(8)}`] : [])
  ].join("\n");
}

function costForTokens(tokens: number, costPerMillionTokens: number | undefined): number | undefined {
  return costPerMillionTokens === undefined ? undefined : (tokens / 1_000_000) * costPerMillionTokens;
}
