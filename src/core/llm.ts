/**
 * 希XI — LLM / Embedding 客户端（纯逻辑，零 Obsidian 依赖）
 *
 * 网关为 OpenAI 兼容 /v1（学校网关 token.nau.edu.cn）。
 * 传输经 Transport 接口注入：Obsidian 侧用 requestUrl（免 CORS，见 D3），
 * 单测用 fake transport，不碰网络。
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

/** 最小 HTTP 传输接口：POST JSON，返回状态码 + 解析后的 JSON */
export interface Transport {
  postJson(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    timeoutMs?: number,
  ): Promise<{ status: number; ok: boolean; json: unknown }>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/* ---------------- URL / Headers ---------------- */

export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${path}`;
}

export function buildChatUrl(baseUrl: string): string {
  return joinUrl(baseUrl, "/chat/completions");
}

export function buildEmbedUrl(baseUrl: string): string {
  return joinUrl(baseUrl, "/embeddings");
}

export function buildModelsUrl(baseUrl: string): string {
  return joinUrl(baseUrl, "/models");
}

export function buildHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey.trim() !== "") headers["Authorization"] = `Bearer ${apiKey.trim()}`;
  return headers;
}

/* ---------------- 请求构造 ---------------- */

export function buildChatBody(model: string, messages: ChatMessage[], opts: ChatOptions = {}): unknown {
  const body: Record<string, unknown> = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: false,
  };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
  return body;
}

export function buildEmbedBody(model: string, inputs: string[]): unknown {
  return { model, input: inputs };
}

/* ---------------- 响应解析 ---------------- */

function errorMessageFromPayload(json: unknown): string | undefined {
  if (json && typeof json === "object") {
    const err = (json as { error?: { message?: unknown } }).error;
    if (err && typeof err === "object" && typeof err.message === "string") {
      return err.message;
    }
    if (typeof (json as { message?: unknown }).message === "string") {
      return (json as { message: string }).message;
    }
  }
  return undefined;
}

/**
 * 解析 /chat/completions 响应，取出 assistant 文本。
 * 推理模型在 max_tokens 耗尽时会返回 content: null —— 这是显式错误，
 * 不能当成空答案存下来（SJS 项目踩过的坑）。
 *
 * 兼容两种 content 形态：字符串（OpenAI 经典）与 parts 数组
 * （`[{type:"text", text:"..."}]`，部分 OpenAI 兼容网关会这么回）。
 */
export function parseChatContent(json: unknown): string {
  if (!json || typeof json !== "object") {
    throw new LlmError("Empty response body", 0);
  }
  const detail = errorMessageFromPayload(json);
  if (detail !== undefined) {
    throw new LlmError(detail, 0, detail);
  }
  const choices = (json as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string | null }> })
    .choices;
  const first = choices && choices[0];
  const content = first && first.message ? first.message.content : undefined;
  const text = contentToText(content);
  if (text !== null) {
    return text;
  }
  if (content === null || content === undefined) {
    const finish = first ? String(first.finish_reason ?? "unknown") : "unknown";
    throw new LlmError(
      `Model returned empty content (finish_reason: ${finish}). If this is a reasoning model, raise max output tokens.`,
      200,
      finish,
    );
  }
  throw new LlmError("Unexpected chat response shape", 200);
}

/** content 可能是 string / parts 数组 / 单个 part 对象；空数组返回 null */
function contentToText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      const text = partToText(part);
      if (text !== null) parts.push(text);
    }
    return parts.length > 0 ? parts.join("") : null;
  }
  return partToText(content);
}

function partToText(part: unknown): string | null {
  if (typeof part === "string") return part;
  if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
    return (part as { text: string }).text;
  }
  return null;
}

export interface EmbeddingResult {
  index: number;
  embedding: number[];
}

/** 解析 /embeddings 响应：按 index 排序返回，校验维度一致 */
export function parseEmbeddings(json: unknown): number[][] {
  if (!json || typeof json !== "object") {
    throw new LlmError("Empty embeddings response", 0);
  }
  const detail = errorMessageFromPayload(json);
  if (detail !== undefined) {
    throw new LlmError(detail, 0, detail);
  }
  const data = (json as { data?: EmbeddingResult[] }).data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new LlmError("No embeddings in response", 200);
  }
  const sorted = [...data].sort((a, b) => a.index - b.index);
  const dim = sorted[0]?.embedding.length ?? 0;
  if (dim === 0) throw new LlmError("Empty embedding vector", 200);
  return sorted.map((item) => {
    if (!Array.isArray(item.embedding) || item.embedding.length !== dim) {
      throw new LlmError(`Inconsistent embedding dimension (expected ${dim})`, 200);
    }
    return item.embedding;
  });
}

/* ---------------- 高层调用 ---------------- */

export interface ChatReply {
  text: string;
  /** OpenAI 的 finish_reason；length 表示被 max_tokens 截断 */
  finishReason: string | null;
}

export function getFinishReason(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const choices = (json as { choices?: Array<{ finish_reason?: unknown }> }).choices;
  const first = choices?.[0];
  return first && typeof first.finish_reason === "string" ? first.finish_reason : null;
}

export async function chatCompletionDetailed(
  transport: Transport,
  cfg: { baseUrl: string; apiKey: string; chatModel: string },
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<ChatReply> {
  const res = await transport.postJson(
    buildChatUrl(cfg.baseUrl),
    buildHeaders(cfg.apiKey),
    buildChatBody(cfg.chatModel, messages, opts),
  );
  if (!res.ok) {
    const detail = errorMessageFromPayload(res.json) ?? `HTTP ${res.status}`;
    throw new LlmError(detail, res.status, detail);
  }
  return { text: parseChatContent(res.json), finishReason: getFinishReason(res.json) };
}

export async function chatCompletion(
  transport: Transport,
  cfg: { baseUrl: string; apiKey: string; chatModel: string },
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  return (await chatCompletionDetailed(transport, cfg, messages, opts)).text;
}

export async function embedTexts(
  transport: Transport,
  cfg: { baseUrl: string; apiKey: string; embeddingModel: string },
  inputs: string[],
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const res = await transport.postJson(
    buildEmbedUrl(cfg.baseUrl),
    buildHeaders(cfg.apiKey),
    buildEmbedBody(cfg.embeddingModel, inputs),
  );
  if (!res.ok) {
    const detail = errorMessageFromPayload(res.json) ?? `HTTP ${res.status}`;
    throw new LlmError(detail, res.status, detail);
  }
  return parseEmbeddings(res.json);
}
