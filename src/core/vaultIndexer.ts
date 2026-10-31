/**
 * 希XI — 库级索引编排（纯 TS，零 Obsidian 依赖）
 *
 * 职责：VaultPort 拿文件 → NoteIndex 增量切块 → 缺向量的 chunk 调 embedding →
 * 失效向量清理 → 缓存落盘；检索时向量化问题后走 RAG。
 *
 * v0.1 已知取舍（写进 docs）：每次 sync 全量读取笔记文本做 hash 判定，
 * 几千篇的库无所谓；向量缓存整包重写，不做事后增量补丁——实现简单且不会错，
 * 库特别大时再优化成「只重写变更文件」。
 */

import type { Chunk } from "./index";
import { NoteIndex } from "./index";
import type { FileInput as FileInputLite, IndexData } from "./index";
import type { VectorStoreData, VectorStore } from "./vectorStore";
import { VectorStore as VectorStoreClass } from "./vectorStore";
import { buildRagContext, retrieveTopK } from "./rag";
import type { RagContext, RetrievalHit } from "./rag";
import { buildNoteVectors, findDuplicatePairs, relatedNotes as rankRelated } from "./related";
import type { DuplicatePair, RelatedNote } from "./related";
import { buildTagSystemPrompt, buildTagUserPrompt, extractTagVocabulary, parseTagSuggestions } from "./tagSuggest";
import { chatCompletion, embedTexts } from "./llm";
import { LlmError } from "./llm";
import type { ChatMessage, Transport } from "./llm";

export interface NoteFile {
  path: string;
  mtime: number;
}

export interface VaultPort {
  listMarkdownFiles(): NoteFile[];
  /** 异步读取：1.13.1 typings 起 cachedRead 返回 Promise；await 对旧版同步返回也安全 */
  readNote(path: string): Promise<string>;
  readCache(): Promise<string | null>;
  writeCache(json: string): Promise<void>;
}

export interface IndexerConfig {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  excludeFolders: string[];
  topK: number;
  similarityThreshold: number;
  /** RAG 上下文 token 预算 */
  contextBudgetTokens: number;
  /** 拼上下文的引导句（随界面语言） */
  contextPrefix?: string;
  /** 整理功能的语言（决定提示词语种） */
  language?: "zh" | "en";
  /** Obsidian 配置目录（用户可自定义；其中的文件一律不进索引） */
  configDir?: string;
  embedBatchSize?: number;
  /** 向量请求失败重试次数（测试可调到 1） */
  embedAttempts?: number;
  /** 重试退避；默认用 window.setTimeout，测试可注入即时实现 */
  sleep?: (ms: number) => Promise<void>;
}

export interface IndexStats {
  files: number;
  chunks: number;
  vectors: number;
  /** 本次新算的向量数（0 = 缓存全命中） */
  embeddedNow: number;
  /** 本次真正读盘的笔记数（增量同步时小于 files） */
  readFiles: number;
}

export type ProgressFn = (phase: "sync" | "embed", done: number, total: number) => void;

const CACHE_VERSION = 1;
const DEFAULT_EMBED_BATCH = 16;
const EMBED_ATTEMPTS = 3;
const VOCAB_SCAN_LIMIT = 200;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** 429 / 5xx / 网络层（status 0）值得重试；401 之类的配置错误立刻暴露 */
function isRetryable(err: unknown): boolean {
  if (err instanceof LlmError) {
    return err.status === 0 || err.status === 429 || err.status >= 500;
  }
  return true;
}

async function withRetry<T>(
  run: () => Promise<T>,
  attempts: number,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await run();
    } catch (err) {
      lastError = err;
      if (attempt === attempts - 1 || !isRetryable(err)) throw err;
      await sleep(400 * 2 ** attempt);
    }
  }
  throw lastError;
}

/** 路径排除判定：文件夹或其子路径 */
export function isExcluded(path: string, folders: string[]): boolean {
  const p = path.replace(/\\/g, "/");
  return folders.some((raw) => {
    const f = raw.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (f === "") return false;
    return p === f || p.startsWith(`${f}/`);
  });
}

interface CacheFile {
  version: number;
  embeddingModel: string;
  index: IndexData;
  vectors: VectorStoreData;
}

export class VaultIndexer {
  index = new NoteIndex();
  store: VectorStore = new VectorStoreClass();
  /** 标签词表缓存：全库读取很贵，一次同步周期内只算一次 */
  private vocabCache: string[] | null = null;

  constructor(
    private port: VaultPort,
    private cfg: IndexerConfig,
    private transport: Transport,
  ) {}

  private async embedInputs(texts: string[]): Promise<number[][]> {
    return embedTexts(
      this.transport,
      { baseUrl: this.cfg.baseUrl, apiKey: this.cfg.apiKey, embeddingModel: this.cfg.embeddingModel },
      texts,
    );
  }

  /** 换 embedding 模型时清空内存索引与向量（磁盘缓存按 model 字段自然失效） */
  reset(): void {
    this.index = new NoteIndex();
    this.store = new VectorStoreClass();
    this.vocabCache = null;
  }

  /** 读缓存；模型变了返回 false 且不清库（由调用方决定是否强制重建） */
  async loadCache(): Promise<boolean> {
    const raw = await this.port.readCache();
    if (!raw) return false;
    try {
      const data = JSON.parse(raw) as CacheFile;
      if (data.version !== CACHE_VERSION) return false;
      if (data.embeddingModel !== this.cfg.embeddingModel) return false;
      this.index = NoteIndex.fromJSON(data.index);
      this.store = VectorStoreClass.fromJSON(data.vectors);
      return this.index.notePaths().length > 0;
    } catch {
      return false;
    }
  }

  /** 路径排除：配置目录（用户可自定义）+ 用户设置的排除文件夹 */
  private isExcludedPath(path: string): boolean {
    if (this.cfg.configDir) {
      const dir = this.cfg.configDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      const p = path.replace(/\\/g, "/");
      if (dir !== "" && (p === dir || p.startsWith(`${dir}/`))) return true;
    }
    return isExcluded(path, this.cfg.excludeFolders);
  }

  /** 全量/增量同步 + 增量 embedding。
   *  full=false（默认）：mtime 未变且已有索引的笔记不读盘，直接复用旧 chunk；
   *  full=true：手动重建时全部重读（防同步工具保留 mtime 的漏检）。 */
  async syncAll(onProgress?: ProgressFn, options: { full?: boolean } = {}): Promise<IndexStats> {
    const files = this.port.listMarkdownFiles().filter((f) => !this.isExcludedPath(f.path));
    const allPaths = files.map((f) => f.path);

    // 先只做「要不要读」的廉价判断；mtime 没变就不读盘（大库从 O(全库读取) 降到 O(变更文件)）
    const toRead: NoteFile[] = [];
    for (const f of files) {
      if (!options.full) {
        const meta = this.index.noteMeta(f.path);
        if (meta && meta.mtime === f.mtime) continue;
      }
      toRead.push(f);
    }

    onProgress?.("sync", 0, toRead.length);
    const inputs: FileInputLite[] = [];
    for (const f of toRead) {
      inputs.push({ path: f.path, mtime: f.mtime, content: await this.port.readNote(f.path) });
      onProgress?.("sync", inputs.length, toRead.length);
    }

    // 先记下每个文件同步前的 chunk id：文件只要被改/删，它的旧向量全部作废。
    // 不能只按 id 集合剪枝——新内容可能复用同样的 id（同路径同偏移），
    // 那样旧向量会冒充新内容的命中（静默的错误检索结果）。
    const oldIdsByPath = new Map<string, string[]>();
    for (const f of files) oldIdsByPath.set(f.path, this.index.chunkIdsOf(f.path));

    const sync = this.index.sync(inputs, { allPaths });
    const changed = new Set([...sync.added, ...sync.updated, ...sync.removed]);
    const staleIds = new Set<string>();
    for (const path of changed) {
      for (const id of oldIdsByPath.get(path) ?? []) staleIds.add(id);
    }

    // 失效向量清理：被删/被改文件留下的旧 chunk 向量
    const aliveIds = new Set(
      this.index
        .allChunks()
        .map((c) => c.id)
        .filter((id) => !staleIds.has(id)),
    );
    this.store.pruneTo(aliveIds);

    const missing: Chunk[] = this.index.allChunks().filter((c) => !this.store.has(c.id));
    const batchSize = Math.max(1, this.cfg.embedBatchSize ?? DEFAULT_EMBED_BATCH);
    let embeddedNow = 0;
    try {
      for (let i = 0; i < missing.length; i += batchSize) {
        const slice = missing.slice(i, i + batchSize);
        const vectors = await withRetry(
          () => this.embedInputs(slice.map((c) => c.text)),
          this.cfg.embedAttempts ?? EMBED_ATTEMPTS,
          this.cfg.sleep ?? defaultSleep,
        );
        if (vectors.length !== slice.length) {
          throw new LlmError(`Embedding count mismatch: expected ${slice.length}, got ${vectors.length}`, 200);
        }
        const first = vectors[0];
        if (first) this.store.ensureModel(this.cfg.embeddingModel, first.length);
        vectors.forEach((v, j) => {
          const chunk = slice[j];
          if (chunk) this.store.upsert(chunk.id, v);
        });
        embeddedNow += slice.length;
        onProgress?.("embed", Math.min(i + slice.length, missing.length), missing.length);
      }
    } catch (err) {
      // 向量没算完也要把文本索引落盘：下次同步只补缺的向量，不用重切全库
      this.vocabCache = null;
      await this.persist();
      throw err;
    }

    this.vocabCache = null;
    await this.persist();
    return {
      files: this.index.notePaths().length,
      chunks: this.index.allChunks().length,
      vectors: this.store.size,
      embeddedNow,
      readFiles: inputs.length,
    };
  }

  private async persist(): Promise<void> {
    const data: CacheFile = {
      version: CACHE_VERSION,
      embeddingModel: this.cfg.embeddingModel,
      index: this.index.toJSON(),
      vectors: this.store.toJSON(),
    };
    await this.port.writeCache(JSON.stringify(data));
  }

  /** 检索 + 装配上下文；库为空或全是低分命中时返回空 citations 的结果。
   *  空库直接短路：不浪费一次 embedding 请求。 */
  async retrieve(question: string): Promise<{ hits: RetrievalHit[]; context: RagContext }> {
    if (this.store.size === 0) return { hits: [], context: { prompt: "", citations: [] } };
    const [queryVector] = await this.embedInputs([question]);
    if (!queryVector) return { hits: [], context: { prompt: "", citations: [] } };
    const hits = retrieveTopK(queryVector, this.store, {
      topK: this.cfg.topK,
      threshold: this.cfg.similarityThreshold,
    });
    const context = buildRagContext(this.index.allChunks(), hits, {
      budgetTokens: this.cfg.contextBudgetTokens,
      prefix: this.cfg.contextPrefix,
    });
    return { hits, context };
  }

  stats(): { files: number; chunks: number; vectors: number } {
    return {
      files: this.index.notePaths().length,
      chunks: this.index.allChunks().length,
      vectors: this.store.size,
    };
  }

  /** 文件内容/排除范围变化后，下次 tagVocabulary 重新扫描 */
  invalidateVocabulary(): void {
    this.vocabCache = null;
  }

  /* ---------- Phase 3 整理能力 ---------- */

  /** 单条文本向量化 */
  async embedText(text: string): Promise<number[]> {
    const [v] = await this.embedInputs([text]);
    if (!v) throw new LlmError("embedding returned empty", 200);
    return v;
  }

  /** 相关笔记：把当前笔记正文现场向量化，与库内代表向量比对 */
  async relatedNotesFor(
    notePath: string,
    opts: { topN?: number; threshold?: number } = {},
  ): Promise<RelatedNote[]> {
    if (this.store.size === 0) return [];
    const text = await this.port.readNote(notePath);
    if (text.trim() === "") return [];
    const query = await this.embedText(text.slice(0, 8000));
    const notes = buildNoteVectors(this.index.allChunks(), this.store);
    return rankRelated(query, notes, {
      topN: opts.topN ?? 10,
      threshold: opts.threshold ?? this.cfg.similarityThreshold,
      excludePath: notePath,
    });
  }

  /** 近似重复笔记对 */
  duplicates(threshold?: number): DuplicatePair[] {
    const notes = buildNoteVectors(this.index.allChunks(), this.store);
    return findDuplicatePairs(notes, threshold ?? Math.min(0.95, this.cfg.similarityThreshold + 0.05));
  }

  /** 全库标签词表（供标签建议优先复用）；结果缓存到下次同步 */
  async tagVocabulary(limit = 60): Promise<string[]> {
    if (this.vocabCache !== null) return this.vocabCache.slice(0, limit);
    const files = this.port.listMarkdownFiles().filter((f) => !this.isExcludedPath(f.path));
    const contents: string[] = [];
    for (const f of files) contents.push(await this.port.readNote(f.path));
    this.vocabCache = extractTagVocabulary(contents, Math.max(limit, VOCAB_SCAN_LIMIT)).map((v) => v.tag);
    return this.vocabCache.slice(0, limit);
  }

  /** 给一篇笔记建议标签（优先词表内） */
  async suggestTags(notePath: string, maxTags = 8): Promise<string[]> {
    const text = await this.port.readNote(notePath);
    if (text.trim() === "") return [];
    const vocabulary = await this.tagVocabulary();
    const lang = this.cfg.language ?? "zh";
    const messages: ChatMessage[] = [
      { role: "system", content: buildTagSystemPrompt(lang) },
      { role: "user", content: buildTagUserPrompt(text, vocabulary, maxTags, lang) },
    ];
    const raw = await chatCompletion(
      this.transport,
      { baseUrl: this.cfg.baseUrl, apiKey: this.cfg.apiKey, chatModel: this.cfg.chatModel },
      messages,
      { temperature: 0.2, maxTokens: 512 },
    );
    return parseTagSuggestions(raw, { vocabulary, maxTags });
  }
}
