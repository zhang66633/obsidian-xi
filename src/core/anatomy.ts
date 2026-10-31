/**
 * 希XI — 单篇笔记解剖（纯 TS）
 *
 * README 承诺的「理解当前笔记」在这里落地：摘要 / 关键概念 / 待解问题。
 * 走和整合功能相同的 path：提示词构造 + 宽容解析 + transport 注入，可单测。
 */

import { chatCompletion } from "./llm";
import type { ChatMessage, Transport } from "./llm";
import { asStringArray, extractJsonObject } from "./json";

export interface AnatomyResult {
  summary: string;
  concepts: string[];
  questions: string[];
}

export interface AnatomyConfig {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  language?: "zh" | "en";
  maxOutputTokens?: number;
}

const NOTE_TEXT_LIMIT = 12_000;

/** 构造解剖请求。notePath 只用于提示模型区分来源，不进正文。 */
export function buildAnatomyMessages(notePath: string, noteText: string, lang: "zh" | "en"): ChatMessage[] {
  const system =
    lang === "zh"
      ? "你是笔记解剖助手。只输出 JSON，不要解释，不要 Markdown 围栏。"
      : "You are a note-anatomy assistant. Output JSON only, no explanation, no Markdown fences.";
  const schema =
    lang === "zh"
      ? '{"summary":"一段话摘要","concepts":["关键概念"],"questions":["作者尚未回答的问题"]}'
      : '{"summary":"one-paragraph summary","concepts":["key concept"],"questions":["open question"]}';
  const instruction =
    lang === "zh"
      ? "阅读下面的笔记，输出 JSON：" +
        schema +
        "。summary 不超过 120 字；concepts 3–8 个；questions 2–5 个，必须能从笔记内容推断出来。"
      : "Read the note below and output JSON: " +
        schema +
        ". summary ≤ 80 words; concepts 3–8; questions 2–5, grounded in the note.";
  const user = `${instruction}\n\n笔记路径 / note path: ${notePath}\n---\n${noteText.slice(0, NOTE_TEXT_LIMIT)}\n---`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** 宽容解析：没有 JSON 时把原文当摘要（至少不丢内容），字段类型不对则丢弃 */
export function parseAnatomy(text: string): AnatomyResult {
  const obj = extractJsonObject(text);
  if (!obj) {
    const trimmed = text.trim();
    return { summary: trimmed, concepts: [], questions: [] };
  }
  return {
    summary: typeof obj.summary === "string" ? obj.summary.trim() : "",
    concepts: asStringArray(obj.concepts),
    questions: asStringArray(obj.questions),
  };
}

export async function runAnatomy(
  transport: Transport,
  cfg: AnatomyConfig,
  notePath: string,
  noteText: string,
): Promise<AnatomyResult> {
  const lang = cfg.language ?? "zh";
  const raw = await chatCompletion(
    transport,
    { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, chatModel: cfg.chatModel },
    buildAnatomyMessages(notePath, noteText, lang),
    { temperature: 0.2, maxTokens: cfg.maxOutputTokens ?? 2048 },
  );
  return parseAnatomy(raw);
}

/** 把结构渲染成 Markdown，直接落进聊天记录也能读 */
export function anatomyToMarkdown(result: AnatomyResult, lang: "zh" | "en"): string {
  const zh = lang === "zh";
  const lines: string[] = [];
  if (result.summary !== "") lines.push(result.summary, "");
  if (result.concepts.length > 0) {
    lines.push(`### ${zh ? "关键概念" : "Key concepts"}`);
    for (const c of result.concepts) lines.push(`- ${c}`);
    lines.push("");
  }
  if (result.questions.length > 0) {
    lines.push(`### ${zh ? "待解问题" : "Open questions"}`);
    for (const q of result.questions) lines.push(`- ${q}`);
  }
  return lines.join("\n").trim();
}
