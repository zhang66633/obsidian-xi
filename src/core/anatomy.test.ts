import { describe, expect, it } from "vitest";
import { anatomyToMarkdown, buildAnatomyMessages, parseAnatomy, runAnatomy } from "./anatomy";
import type { Transport } from "./llm";

describe("buildAnatomyMessages", () => {
  it("中文提示词带 JSON schema 与截断后的正文", () => {
    const messages = buildAnatomyMessages("a.md", "x".repeat(20_000), "zh");
    expect(messages[0]?.content).toContain("只输出 JSON");
    expect(messages[1]?.content).toContain("a.md");
    expect(messages[1]?.content).toContain('"concepts"');
    // 正文截断到 12000，提示词本身不跟着膨胀
    expect(messages[1]?.content.length).toBeLessThan(13_000);
  });

  it("英文提示词不混中文指令", () => {
    const messages = buildAnatomyMessages("a.md", "hello", "en");
    expect(messages[0]?.content).toContain("Output JSON only");
    expect(messages[1]?.content).toContain("note path");
  });
});

describe("parseAnatomy", () => {
  it("围栏 + 散文里的 JSON 也能解析", () => {
    const raw = '好的，结果如下：\n```json\n{"summary":"讲注意力","concepts":["注意力","工作记忆"],"questions":["如何训练？"]}\n```';
    expect(parseAnatomy(raw)).toEqual({
      summary: "讲注意力",
      concepts: ["注意力", "工作记忆"],
      questions: ["如何训练？"],
    });
  });

  it("字段缺失/类型错误：给空结构，不抛错", () => {
    expect(parseAnatomy('{"summary":123,"concepts":"x","questions":[null,"q"]}')).toEqual({
      summary: "",
      concepts: [],
      questions: ["q"],
    });
  });

  it("完全没有 JSON：原文当摘要（不丢内容）", () => {
    expect(parseAnatomy("这是一段自由文本")).toEqual({
      summary: "这是一段自由文本",
      concepts: [],
      questions: [],
    });
  });
});

describe("runAnatomy", () => {
  it("走 chat/completions，解析成结构", async () => {
    const calls: string[] = [];
    const transport: Transport = {
      async postJson(url, _headers, _body) {
        calls.push(String(url));
        return {
          status: 200,
          ok: true,
          json: {
            choices: [
              {
                message: {
                  content: '{"summary":"摘要","concepts":["A"],"questions":["Q?"]}',
                },
              },
            ],
          },
        };
      },
    };
    const result = await runAnatomy(
      transport,
      { baseUrl: "https://gw/v1", apiKey: "k", chatModel: "m", language: "en" },
      "a.md",
      "内容",
    );
    expect(result.summary).toBe("摘要");
    expect(calls[0]).toBe("https://gw/v1/chat/completions");
  });
});

describe("anatomyToMarkdown", () => {
  it("中文标题与条目顺序稳定", () => {
    const md = anatomyToMarkdown({ summary: "摘要", concepts: ["A", "B"], questions: ["Q?"] }, "zh");
    expect(md).toBe("摘要\n\n### 关键概念\n- A\n- B\n\n### 待解问题\n- Q?");
  });
});
