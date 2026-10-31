/**
 * 希XI — 聊天上下文预算（纯 TS）
 *
 * 真问题：settings 里有 maxInputTokens，但聊天层以前完全没用它——
 * 长会话会把系统提示 + 历史 + 检索片段一起塞给网关，超限直接 400。
 * 这里只做一件事：从最新消息往回保留「连续后缀」，装不下就停，
 * 保证对话顺序不变、当前问题永远保留。
 */

import type { ChatMessage } from "./llm";
import { estimateTokens } from "./rag";

/** 每条消息的协议开销（role/分隔符等）的保守估计 */
const MESSAGE_OVERHEAD_TOKENS = 4;

export function messageTokens(message: ChatMessage): number {
  return estimateTokens(message.content) + MESSAGE_OVERHEAD_TOKENS;
}

export function totalTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + messageTokens(m), 0);
}

export interface FitResult {
  /** 按原顺序返回的连续后缀（可能为空） */
  messages: ChatMessage[];
  /** 被丢弃的消息数 */
  dropped: number;
  tokens: number;
}

/**
 * 从最新一条往前装，装不下就停（不跳着选，避免上下文断裂）。
 * reserveTokens 预留给「当前问题 + 检索上下文 + 回答」。
 */
export function fitHistory(
  prior: ChatMessage[],
  opts: { maxTokens: number; reserveTokens?: number },
): FitResult {
  const budget = Math.floor(opts.maxTokens - (opts.reserveTokens ?? 0));
  if (budget <= 0 || prior.length === 0) {
    return { messages: [], dropped: prior.length, tokens: 0 };
  }
  let used = 0;
  let start = prior.length;
  for (let i = prior.length - 1; i >= 0; i--) {
    const message = prior[i];
    if (!message) continue;
    const cost = messageTokens(message);
    if (used + cost > budget) break;
    used += cost;
    start = i;
  }
  return { messages: prior.slice(start), dropped: start, tokens: used };
}
