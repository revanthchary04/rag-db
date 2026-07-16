/**
 * Approximate OpenAI USD pricing for UI estimates (not billing truth).
 * Aligned with text-embedding-3-small + gpt-4o-mini; update when models change.
 */

/** text-embedding-3-small ~$0.02 / 1M tokens → per 1K */
export const EMBEDDING_COST_PER_1K = 0.00002

/** gpt-4o-mini prompt ~$0.15 / 1M → per 1K */
export const CHAT_PROMPT_COST_PER_1K_MINI = 0.00015

/** gpt-4o-mini completion ~$0.60 / 1M → per 1K */
export const CHAT_COMPLETION_COST_PER_1K_MINI = 0.0006

export function estimateChatMessageCostUsd(tokenUsage?: {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}): number | undefined {
  if (!tokenUsage) return undefined
  const inputTokens = tokenUsage.prompt_tokens || 0
  const outputTokens = tokenUsage.completion_tokens || 0
  const inputCost = (inputTokens / 1000) * CHAT_PROMPT_COST_PER_1K_MINI
  const outputCost = (outputTokens / 1000) * CHAT_COMPLETION_COST_PER_1K_MINI
  return inputCost + outputCost
}

export function estimateDashboardTokenCostUsd(tokenUsage: {
  embedding_prompt_tokens?: number
  embedding_total_tokens?: number
  chat_prompt_tokens?: number
  chat_completion_tokens?: number
}): number {
  const embeddingCost = ((tokenUsage.embedding_total_tokens || 0) / 1000) * EMBEDDING_COST_PER_1K
  const chatPromptCost =
    ((tokenUsage.chat_prompt_tokens || 0) / 1000) * CHAT_PROMPT_COST_PER_1K_MINI
  const chatCompletionCost =
    ((tokenUsage.chat_completion_tokens || 0) / 1000) * CHAT_COMPLETION_COST_PER_1K_MINI
  return embeddingCost + chatPromptCost + chatCompletionCost
}
