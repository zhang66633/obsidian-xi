import { describe, expect, it } from "vitest";
import { fitHistory, messageTokens, totalTokens } from "./chatBudget";

const msg = (role: "user" | "assistant", content: string) => ({ role, content }) as const;

describe("fitHistory", () => {
  it("预算充足：原样保留", () => {
    const prior = [msg("user", "a".repeat(100)), msg("assistant", "b".repeat(100))];
    const result = fitHistory(prior, { maxTokens: 10_000 });
    expect(result.messages).toEqual(prior);
    expect(result.dropped).toBe(0);
  });

  it("预算不足：保留最新连续后缀，丢掉最早的消息", () => {
    const prior = [
      msg("user", "a".repeat(1000)),
      msg("assistant", "b".repeat(1000)),
      msg("user", "c".repeat(100)),
      msg("assistant", "d".repeat(100)),
    ];
    // 100 字符 ≈ 50 token + 4 开销；预算只够最后两条
    const result = fitHistory(prior, { maxTokens: 120 });
    expect(result.messages).toEqual(prior.slice(2));
    expect(result.dropped).toBe(2);
    expect(result.tokens).toBeLessThanOrEqual(120);
  });

  it("reserveTokens 会进一步压缩历史", () => {
    const prior = [msg("user", "a".repeat(100)), msg("assistant", "b".repeat(100))];
    const result = fitHistory(prior, { maxTokens: 120, reserveTokens: 60 });
    expect(result.messages.length).toBeLessThanOrEqual(1);
  });

  it("预算 <= 0 / 空历史：返回空且不崩", () => {
    expect(fitHistory([msg("user", "hi")], { maxTokens: 1 })).toEqual({
      messages: [],
      dropped: 1,
      tokens: 0,
    });
    expect(fitHistory([], { maxTokens: 1000 })).toEqual({ messages: [], dropped: 0, tokens: 0 });
  });

  it("单条最新消息就超预算：宁可不带历史，也不截断当前消息", () => {
    const prior = [msg("user", "x".repeat(10_000))];
    const result = fitHistory(prior, { maxTokens: 100 });
    expect(result.messages).toEqual([]);
    expect(result.dropped).toBe(1);
  });

  it("token 估算把消息开销算进去", () => {
    expect(messageTokens(msg("user", "abcd"))).toBe(6); // 4 字符 / 2 + 4
    expect(totalTokens([msg("user", "abcd"), msg("assistant", "abcdef")])).toBe(6 + 7);
  });
});
