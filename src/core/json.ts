/**
 * 希XI — 宽容 JSON 提取（纯 TS）
 *
 * 模型输出常带围栏、前言、尾注；推理模型还会在最终 JSON 前面输出一大段
 * 带花括号示例的思考过程。旧实现取「第一个 { 到最后一个 }」，会把思考示例
 * 一起塞进 JSON.parse，导致明明有合法 JSON 却解析失败。
 *
 * 这里从右往左尝试每个 `{`，用字符串感知的括号配对找到它的结束位置，
 * 第一个能 JSON.parse 成对象的就是答案。
 */

/** 从模型输出里抠出最后一个可解析的 JSON 对象（围栏/散文/思考前缀均可） */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  let best: { start: number; end: number; value: Record<string, unknown> } | null = null;
  let start = text.indexOf("{");
  while (start >= 0) {
    const end = matchingPair(text, start, "{", "}");
    // 只可能被「结束位置更靠后」的候选替换；同 end 时取更外层（start 更小）
    if (end > start && (!best || end > best.end || (end === best.end && start < best.start))) {
      try {
        const parsed: unknown = JSON.parse(text.slice(start, end + 1));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          best = { start, end, value: parsed as Record<string, unknown> };
        }
      } catch {
        // 不是完整 JSON（例如思考里的 schema 示例），继续扫下一个 {
      }
    }
    start = text.indexOf("{", start + 1);
  }
  return best?.value ?? null;
}

/** 数组版：用于标签建议等「模型只该输出数组」的场景 */
export function extractJsonArray(text: string): unknown[] | null {
  let best: { start: number; end: number; value: unknown[] } | null = null;
  let start = text.indexOf("[");
  while (start >= 0) {
    const end = matchingPair(text, start, "[", "]");
    if (end > start && (!best || end > best.end || (end === best.end && start < best.start))) {
      try {
        const parsed: unknown = JSON.parse(text.slice(start, end + 1));
        if (Array.isArray(parsed)) best = { start, end, value: parsed };
      } catch {
        // 继续扫下一个 [
      }
    }
    start = text.indexOf("[", start + 1);
  }
  return best?.value ?? null;
}

/** 从 start 的开符号开始找配对的闭符号；感知字符串与转义 */
function matchingPair(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 只保留非空字符串项；类型不对一律丢弃 */
export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}
