import { describe, expect, it } from "vitest";
import { buildNoteVectors, findDuplicatePairs, makeSnippet, relatedNotes } from "./related";
import type { Chunk } from "./index";
import { VectorStore } from "./vectorStore";

function chunk(id: string, path: string): Chunk {
  return { id, path, heading: "", text: id };
}

function store(entries: Record<string, number[]>): VectorStore {
  const s = new VectorStore();
  for (const [k, v] of Object.entries(entries)) s.upsert(k, v);
  return s;
}

describe("buildNoteVectors", () => {
  it("同笔记多 chunk 取均值，无向量 chunk 跳过", () => {
    const chunks = [chunk("a#1", "a.md"), chunk("a#2", "a.md"), chunk("b#1", "b.md"), chunk("c#1", "c.md")];
    const s = store({ "a#1": [1, 0], "a#2": [0, 1], "b#1": [1, 1] });
    const notes = buildNoteVectors(chunks, s);
    expect(notes.map((n) => n.path).sort()).toEqual(["a.md", "b.md"]);
    const a = notes.find((n) => n.path === "a.md")!;
    expect(a.vector[0]).toBeCloseTo(0.5, 6);
    expect(a.vector[1]).toBeCloseTo(0.5, 6);
    expect(a.chunkCount).toBe(2);
  });

  it("空库 → 空列表", () => {
    expect(buildNoteVectors([], new VectorStore())).toEqual([]);
  });
});

describe("relatedNotes", () => {
  // b 与查询方向差 45°，余弦 ≈0.707，用来卡阈值
  const notes = buildNoteVectors(
    [chunk("a#1", "a.md"), chunk("b#1", "b.md"), chunk("c#1", "c.md")],
    store({ "a#1": [1, 0], "b#1": [0.5, 0.5], "c#1": [0, 1] }),
  );

  it("按相似度降序 + topN 截断 + 排除自身", () => {
    const r = relatedNotes([1, 0], notes, { topN: 2, excludePath: "a.md" });
    expect(r.map((x) => x.path)).toEqual(["b.md", "c.md"]);
  });

  it("阈值过滤低分", () => {
    const r = relatedNotes([1, 0], notes, { threshold: 0.99 });
    expect(r.map((x) => x.path)).toEqual(["a.md"]);
  });
});

describe("findDuplicatePairs", () => {
  it("阈值内成对返回、每对一次、a<b 字典序", () => {
    const notes = buildNoteVectors(
      [chunk("a#1", "a.md"), chunk("b#1", "b.md"), chunk("c#1", "c.md")],
      store({ "a#1": [1, 0], "b#1": [1, 0], "c#1": [0, 1] }),
    );
    const pairs = findDuplicatePairs(notes, 0.99);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: "a.md", b: "b.md" });
    expect(pairs[0]!.score).toBeCloseTo(1, 6);
  });

  it("阈值高时无结果", () => {
    const notes = buildNoteVectors([chunk("a#1", "a.md"), chunk("b#1", "b.md")], store({ "a#1": [1, 0], "b#1": [0, 1] }));
    expect(findDuplicatePairs(notes, 0.9)).toEqual([]);
  });

  it("回归：同方向不同模长仍是重复（余弦对缩放不敏感，不能用模长剪枝）", () => {
    const notes = buildNoteVectors(
      [chunk("a#1", "a.md"), chunk("b#1", "b.md")],
      store({ "a#1": [0.01, 0], "b#1": [100, 0] }),
    );
    const pairs = findDuplicatePairs(notes, 0.99);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.score).toBeCloseTo(1, 6);
  });
});

describe("makeSnippet", () => {
  it("折叠空白并在超长时截断加省略号", () => {
    expect(makeSnippet("  第一行\n\n第二行  ")).toBe("第一行 第二行");
    const long = makeSnippet("x".repeat(200), 20);
    expect(long).toHaveLength(20);
    expect(long.endsWith("…")).toBe(true);
  });

  it("去掉标题、双链、粗体与行内代码标记", () => {
    expect(makeSnippet("### 阶段\n看 [[Z值]] 和 [[路径|别名]]，**重点** `code`")).toBe("阶段 看 Z值 和 别名，重点 code");
  });
});
