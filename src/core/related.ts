/**
 * 希XI — 相关笔记与近似重复检测（纯 TS）
 *
 * 代表向量策略：一篇笔记 = 它所有 chunk 向量的均值。
 * 为什么用均值而不是 max：相关笔记列表要比「主题重合度」，
 * 均值对一篇里跑题一段不敏感；重复检测要「整体像」，均值也合适。
 * max 策略留给 QA 检索（那里要的是「最相关的一段」）。
 */

import type { Chunk } from "./index";
import type { VectorStore } from "./vectorStore";
import { cosineSimilarity } from "./vectorStore";

export interface NoteVector {
  path: string;
  /** 该笔记全部 chunk 向量的均值 */
  vector: number[];
  chunkCount: number;
}

/** 从索引+向量缓存构造每篇笔记的代表向量；无向量的 chunk 跳过 */
export function buildNoteVectors(chunks: Chunk[], store: VectorStore): NoteVector[] {
  const byPath = new Map<string, number[][]>();
  for (const c of chunks) {
    const v = store.get(c.id);
    if (!v) continue;
    const list = byPath.get(c.path);
    if (list) list.push(v);
    else byPath.set(c.path, [v]);
  }
  const out: NoteVector[] = [];
  for (const [path, vectors] of byPath) {
    const dim = vectors[0]?.length ?? 0;
    if (dim === 0) continue;
    const mean = new Array<number>(dim).fill(0);
    for (const v of vectors) {
      for (let i = 0; i < dim; i++) mean[i] = (mean[i] ?? 0) + (v[i] ?? 0);
    }
    for (let i = 0; i < dim; i++) mean[i] = (mean[i] ?? 0) / vectors.length;
    out.push({ path, vector: mean, chunkCount: vectors.length });
  }
  return out;
}

export interface RelatedNote {
  path: string;
  score: number;
  /** 最匹配的 chunk 的标题路径（可选，供 UI 展示） */
  heading?: string;
  /** 最匹配 chunk 的压缩摘要（可选，列表里给用户一个「为什么相关」） */
  snippet?: string;
  /** 最匹配的 chunk id（可选，便于跳转/引用） */
  chunkId?: string;
}

/** 把 chunk 正文压成一行摘要；超长截断并加省略号。
 *  顺手去掉 Markdown 标题/双链/强调标记，避免列表里出现一堆语法噪声。 */
export function makeSnippet(text: string, maxChars = 160): string {
  const clean = text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, path: string, alias?: string) => alias ?? path)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/** 查询向量 → 相关笔记（按代表向量相似度，排除自身，阈值过滤） */
export function relatedNotes(
  queryVector: number[],
  notes: NoteVector[],
  opts: { topN?: number; threshold?: number; excludePath?: string },
): RelatedNote[] {
  const { topN = 10, threshold = 0, excludePath } = opts;
  const out: RelatedNote[] = [];
  for (const n of notes) {
    if (excludePath && n.path === excludePath) continue;
    const score = cosineSimilarity(queryVector, n.vector);
    if (score < threshold) continue;
    out.push({ path: n.path, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, topN);
}

export interface DuplicatePair {
  a: string;
  b: string;
  score: number;
}

/** 向量 L2 范数（重复检测时预计算，避免每对都开方） */
export function vectorNorm(vector: number[]): number {
  let sum = 0;
  for (const v of vector) sum += v * v;
  return Math.sqrt(sum);
}

/** 点积（长度不一致时按较短者截断，与 cosineSimilarity 语义一致） */
function dotProduct(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

/** 近似重复：代表向量余弦 ≥ threshold 的笔记对（每对只出一次，a<b 字典序）
 *  优化：预计算每个代表向量的模长，配对时只算点积；不再每对开两次方。
 *  注意：余弦对向量长度缩放不敏感（同方向不同模长余弦仍为 1），
 *  所以不能用模长比做剪枝——这里保持暴力两两比较，结果精确。 */
export function findDuplicatePairs(notes: NoteVector[], threshold: number): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  const norms = notes.map((n) => vectorNorm(n.vector));
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const a = notes[i];
      const b = notes[j];
      if (!a || !b) continue;
      const na = norms[i] ?? 0;
      const nb = norms[j] ?? 0;
      if (na === 0 || nb === 0) continue;
      const score = dotProduct(a.vector, b.vector) / (na * nb);
      if (score >= threshold) {
        const [lo, hi] = a.path <= b.path ? [a.path, b.path] : [b.path, a.path];
        pairs.push({ a: lo ?? a.path, b: hi ?? b.path, score });
      }
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  return pairs;
}
