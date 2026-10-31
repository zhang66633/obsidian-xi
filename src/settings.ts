/**
 * 希XI — 设置模型、默认值与合并
 * 默认接入学校网关（见 docs/01-决策记录.md D2）。
 *
 * 约定：loadData() 是不可信输入（用户手改、旧版本、同步冲突都可能）。
 * mergeSettings 是唯一的收敛点：类型错误回退默认，数值一律钳制到安全区间，
 * 保证索引器/请求层拿到的永远是合法值。
 */

import type { LangMode } from "./i18n";

export interface LingxiSettings {
  /** 界面语言；auto = 跟随 Obsidian locale */
  language: LangMode;
  /** OpenAI 兼容网关根地址，形如 https://host/v1 */
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  /** 输入 token 预算（含系统提示+检索+历史）；须 < 网关单次上限 */
  maxInputTokens: number;
  maxOutputTokens: number;
  topK: number;
  temperature: number;
  /** 索引排除的文件夹（vault 相对路径） */
  excludeFolders: string[];
  /** 半自动整理白名单：白名单内新笔记可自动写入，其余只出建议 */
  autoOrganizeFolders: string[];
  /** 语义相关度阈值（0-1），超过即视为相关 */
  similarityThreshold: number;
  /** RAG 上下文 token 预算（大于会话历史与系统提示） */
  contextBudgetTokens: number;
  /** 调试：Obsidian 启动时自动打开侧边栏（真机冒烟测试用） */
  autoOpenSidebar: boolean;
}

export const DEFAULT_SETTINGS: LingxiSettings = {
  language: "auto",
  baseUrl: "https://token.nau.edu.cn/v1",
  apiKey: "",
  chatModel: "qwen3.8-27b",
  embeddingModel: "qwen3-embedding-8b",
  maxInputTokens: 90000,
  maxOutputTokens: 8192,
  topK: 8,
  temperature: 0.3,
  excludeFolders: [".trash", ".smart-env", ".git"],
  autoOrganizeFolders: [],
  similarityThreshold: 0.82,
  contextBudgetTokens: 12000,
  autoOpenSidebar: false,
};

/** 数值设置的合法区间（设置页与 mergeSettings 共用） */
export const SETTING_LIMITS = {
  maxInputTokens: { min: 1_000, max: 200_000 },
  maxOutputTokens: { min: 256, max: 65_536 },
  topK: { min: 1, max: 20 },
  temperature: { min: 0, max: 2 },
  similarityThreshold: { min: 0, max: 1 },
  contextBudgetTokens: { min: 1_000, max: 60_000 },
} as const;

export type NumericSettingKey = keyof typeof SETTING_LIMITS;

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const out = value.filter((v): v is string => typeof v === "string");
  return out.length > 0 || value.length === 0 ? out : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asIntInRange(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(clampNumber(asNumber(value, fallback), min, max));
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** 去掉尾斜杠；没写协议时补 https://（用户常只填 host/v1） */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed === "") return DEFAULT_SETTINGS.baseUrl;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** 文件夹路径统一成正斜杠、去首尾斜杠 */
export function normalizeFolderPath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

/** path 是否位于 folder（含 folder 本身）之下 */
export function isPathInFolder(path: string, folder: string): boolean {
  const p = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const f = normalizeFolderPath(folder);
  if (f === "") return false;
  return p === f || p.startsWith(`${f}/`);
}

/**
 * 把 loadData() 可能的任意内容合并成合法设置。
 * 原则：用户已填的优先，缺字段回退默认，类型错误回退默认，数值钳制。
 */
export function mergeSettings(loaded: unknown): LingxiSettings {
  if (!loaded || typeof loaded !== "object") return { ...DEFAULT_SETTINGS };
  const l = loaded as Partial<LingxiSettings>;

  const maxInputTokens = asIntInRange(
    l.maxInputTokens,
    DEFAULT_SETTINGS.maxInputTokens,
    SETTING_LIMITS.maxInputTokens.min,
    SETTING_LIMITS.maxInputTokens.max,
  );
  const maxOutputTokens = asIntInRange(
    l.maxOutputTokens,
    DEFAULT_SETTINGS.maxOutputTokens,
    SETTING_LIMITS.maxOutputTokens.min,
    SETTING_LIMITS.maxOutputTokens.max,
  );

  return {
    language: l.language === "zh" || l.language === "en" || l.language === "auto" ? l.language : DEFAULT_SETTINGS.language,
    baseUrl:
      typeof l.baseUrl === "string" && l.baseUrl.trim() !== "" ? normalizeBaseUrl(l.baseUrl) : DEFAULT_SETTINGS.baseUrl,
    apiKey: typeof l.apiKey === "string" ? l.apiKey.trim() : "",
    chatModel:
      typeof l.chatModel === "string" && l.chatModel.trim() !== "" ? l.chatModel.trim() : DEFAULT_SETTINGS.chatModel,
    embeddingModel:
      typeof l.embeddingModel === "string" && l.embeddingModel.trim() !== ""
        ? l.embeddingModel.trim()
        : DEFAULT_SETTINGS.embeddingModel,
    maxInputTokens,
    maxOutputTokens,
    topK: asIntInRange(l.topK, DEFAULT_SETTINGS.topK, SETTING_LIMITS.topK.min, SETTING_LIMITS.topK.max),
    temperature: clampNumber(
      asNumber(l.temperature, DEFAULT_SETTINGS.temperature),
      SETTING_LIMITS.temperature.min,
      SETTING_LIMITS.temperature.max,
    ),
    excludeFolders: asStringArray(l.excludeFolders, DEFAULT_SETTINGS.excludeFolders).map(normalizeFolderPath).filter(Boolean),
    autoOrganizeFolders: asStringArray(l.autoOrganizeFolders, DEFAULT_SETTINGS.autoOrganizeFolders)
      .map(normalizeFolderPath)
      .filter(Boolean),
    similarityThreshold: clampNumber(
      asNumber(l.similarityThreshold, DEFAULT_SETTINGS.similarityThreshold),
      SETTING_LIMITS.similarityThreshold.min,
      SETTING_LIMITS.similarityThreshold.max,
    ),
    contextBudgetTokens: asIntInRange(
      l.contextBudgetTokens,
      DEFAULT_SETTINGS.contextBudgetTokens,
      SETTING_LIMITS.contextBudgetTokens.min,
      SETTING_LIMITS.contextBudgetTokens.max,
    ),
    autoOpenSidebar: asBoolean(l.autoOpenSidebar, DEFAULT_SETTINGS.autoOpenSidebar),
  };
}

/** 多行文本 → 文件夹列表（去空行、去重、规范化） */
export function parseFolderList(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const v = normalizeFolderPath(raw);
    if (v) seen.add(v);
  }
  return [...seen];
}

export function folderListToText(list: string[]): string {
  return list.join("\n");
}
