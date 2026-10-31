import { describe, expect, it } from "vitest";
import { extractJsonObject } from "./json";

describe("extractJsonObject", () => {
  it("裸 JSON / 围栏 / 散文里的 JSON 都能取到", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('先说明一下：\n{"a":1}\n以上。')).toEqual({ a: 1 });
  });

  it("回归：推理模型先输出带示例花括号的思考，再输出合法 JSON", () => {
    const raw =
      '我需要输出 {"consensus":[...], "divergence":[...]} 这样的结构。\n' +
      '分析完成后：\n' +
      '{"consensus":["c1"],"divergence":["d1"],"complementary":[]}';
    expect(extractJsonObject(raw)).toEqual({
      consensus: ["c1"],
      divergence: ["d1"],
      complementary: [],
    });
  });

  it("嵌套对象与字符串里的花括号不会把配对弄错", () => {
    expect(extractJsonObject('前缀 {"a":{"b":"}"},"c":2} 后缀')).toEqual({ a: { b: "}" }, c: 2 });
  });

  it("没有合法 JSON 返回 null", () => {
    expect(extractJsonObject("完全没有 JSON")).toBeNull();
    expect(extractJsonObject('{"a":1')).toBeNull();
  });
});
