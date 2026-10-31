/**
 * 希XI — 宽容 JSON 提取（纯 TS）
 *
 * 模型输出常带围栏、前言、尾注。这里只负责「从任意文本里捞出第一个 JSON 对象」
 * 和「把 unknown 收成字符串数组」；校验策略由各调用方决定（宁可空结构，不交半成品）。
 */

/** 从模型输出里抠第一个 JSON 对象（围栏/散文/裸 JSON 均可） */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** 只保留非空字符串项；类型不对一律丢弃 */
export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}
