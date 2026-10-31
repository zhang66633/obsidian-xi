/**
 * 希XI — i18n 双语词典与切换器
 * 硬约定：zh / en 两个字典的 key 集合必须完全一致（有单测强制校验）。
 * 插值语法：{name}，如 t("chat.citationsCount", { n: 3 })
 */

export type Lang = "zh" | "en";
export type LangMode = Lang | "auto";

const zh: Record<string, string> = {
  "common.cancel": "取消",
  "common.delete": "删除",
  "prompt.system":
    "你是希XI，一个住在 Obsidian 里的双语笔记助手。回答基于用户提供的笔记内容，" +
    "不确定就明说，不要编造引用；用简洁的中文回答。",
  "ribbon.tooltip": "打开希XI侧边栏",
  "cmd.openSidebar": "打开希XI侧边栏",
  "cmd.askSelection": "问希XI：选中文字",
  "cmd.summarizeNote": "希XI：理解当前笔记",

  "view.title": "希XI",
  "view.switchLang": "Switch to English",
  "view.openSettings": "打开设置",

  "tab.chat": "对话",
  "tab.organize": "整理",
  "tab.integrate": "整合",

  "chat.placeholder": "问点什么…例如「我关于注意力的笔记都说了什么」",
  "chat.send": "发送",
  "chat.thinking": "思考中…",
  "chat.failed": "请求失败",
  "chat.you": "你",
  "chat.lingxi": "希XI",
  "chat.citations": "引用来源",
  "chat.copy": "复制",
  "chat.copied": "已复制",
  "chat.trimmed": "已省略 {n} 条较早消息（上下文预算）",
  "chat.truncated": "回答达到输出上限，可能被截断；可在设置里调高输出上限。",
  "chat.contextTooLarge": "当前问题加上检索上下文已超过输入预算，请降低 RAG 上下文预算或 Top-K。",
  "chat.empty.title": "开始对话",
  "chat.empty.desc": "全库问答前先建一次索引；也可以直接问当前笔记。",
  "chat.selectionQuestion": "请解释这段选中的内容，并指出它与当前笔记的关系。",
  "chat.understandQuestion": "理解这篇笔记：{path}",
  "chat.understandEmpty": "模型没有给出有效内容",
  "chat.delete.title": "删除会话？",
  "chat.delete.body": "「{title}」的全部消息将被删除，无法恢复。",

  "context.label": "上下文范围",
  "context.vault": "全库检索",
  "context.note": "当前笔记",
  "context.selection": "选中内容",
  "context.selection.empty": "没有选中文字",

  "settings.group.connection": "模型接入（OpenAI 兼容 /v1）",
  "settings.group.budget": "上下文预算（tokens）",
  "settings.group.scope": "索引与写入范围",
  "settings.group.advanced": "高级",
  "settings.language": "界面语言",
  "settings.language.desc": "跟随 Obsidian 或手动指定中文/English",
  "settings.language.auto": "跟随 Obsidian",
  "settings.language.zh": "中文",
  "settings.language.en": "English",
  "settings.baseUrl": "接口地址",
  "settings.baseUrl.desc": "默认学校网关；任何 OpenAI 兼容端点均可",
  "settings.baseUrl.invalid": "接口地址不能为空",
  "settings.apiKey": "API Key",
  "settings.apiKey.desc": "仅保存在本机 data.json，不进 git、不上传",
  "settings.apiKey.show": "显示密钥",
  "settings.apiKey.hide": "隐藏密钥",
  "settings.chatModel": "对话模型",
  "settings.embeddingModel": "向量模型",
  "settings.embeddingModel.desc": "更换后旧索引会作废，需要重建",
  "settings.model.invalid": "模型名不能为空",
  "settings.testConnection": "测试连接",
  "settings.test.desc": "请求 /models，验证地址与密钥是否可用",
  "settings.test.ok": "连接成功：可用模型 {n} 个",
  "settings.test.fail": "连接失败：{msg}",
  "settings.maxInputTokens": "输入上限",
  "settings.maxInputTokens.desc": "系统提示 + 历史 + 检索片段的总预算（1000–200000）",
  "settings.maxOutputTokens": "输出上限",
  "settings.maxOutputTokens.desc": "单次回答的最大 token（256–65536）",
  "settings.topK": "检索条数 Top-K",
  "settings.temperature": "温度",
  "settings.excludeFolders": "排除文件夹（每行一个）",
  "settings.autoFolders": "半自动整理文件夹",
  "settings.autoFolders.desc": "白名单内新笔记可自动打标签；其余永远只出建议",
  "settings.similarity": "相关度阈值",
  "settings.contextBudget": "RAG 上下文预算",
  "settings.contextBudget.desc": "检索片段最多占多少 token（1000–60000），超出按分数舍弃",
  "settings.autoOpen": "启动时自动打开侧边栏（调试）",
  "settings.rebuild": "重建索引",
  "settings.rebuild.desc": "全量重读所有笔记并补齐缺失向量；平时编辑会自动增量同步",
  "err.noApiKey": "请先在设置里填写 API Key",
  "err.emptyQuestion": "先输入问题",

  "rag.indexing": "正在建立索引 {done}/{total}…",
  "rag.indexReady": "索引就绪：{files} 篇 · {chunks} 块",
  "rag.indexEmpty": "索引为空：请先在设置填写 API Key，并检查排除文件夹。",
  "rag.rebuilding": "正在重建索引…",
  "rag.noHits": "库里没找到足够相关的片段，本次回答未引用笔记。",
  "rag.openSource": "打开来源",
  "rag.context.prefix": "以下是与问题相关的笔记片段（回答请用 [编号] 标注引用来源；没有合适片段就直说）：",
  "rag.firstRunHint": "希XI已就绪。全库问答前先建一次索引：命令面板 → 重建希XI索引。",
  "rag.modelChanged": "向量模型已更换：旧索引已清空，请重建索引。",
  "cmd.reindex": "重建希XI索引",

  "rename.title": "重命名会话",
  "rename.cancel": "取消",
  "rename.save": "保存",
  "picker.search": "搜索笔记…",
  "picker.cancel": "取消",
  "picker.confirm": "确定",

  "organize.related": "相关笔记",
  "organize.related.hint": "基于当前笔记的语义匹配（需要先建索引）",
  "organize.related.run": "找相关笔记",
  "organize.related.none": "没有找到足够相关的笔记",
  "organize.related.insert": "插入链接",
  "organize.search": "语义搜索",
  "organize.search.hint": "用自然语言搜全库，按段落命中",
  "organize.search.placeholder": "用自然语言搜全库…",
  "organize.search.run": "搜索",
  "organize.search.none": "无命中",
  "organize.tags": "标签建议",
  "organize.tags.hint": "优先复用库内已有标签；白名单文件夹内自动应用",
  "organize.tags.run": "建议标签",
  "organize.tags.apply": "点击应用",
  "organize.tags.applied": "已写入 frontmatter",
  "organize.tags.none": "没有可建议的标签",
  "organize.dup": "近似重复",
  "organize.dup.hint": "代表向量余弦超过阈值的笔记对",
  "organize.dup.run": "检测重复",
  "organize.dup.none": "未发现近似重复",
  "organize.dup.openBoth": "打开两篇",
  "organize.currentNote": "当前笔记",
  "organize.noNote": "（未打开笔记）",
  "organize.busy": "处理中…",

  "integrate.compare": "多篇对比",
  "integrate.compare.hint": "选 2–10 篇同主题笔记，输出共识/分歧/互补",
  "integrate.compare.run": "开始对比",
  "integrate.compare.needTwo": "至少选两篇",
  "integrate.compare.consensus": "共识",
  "integrate.compare.divergence": "分歧",
  "integrate.compare.complementary": "互补",
  "integrate.compare.save": "存为新笔记",
  "integrate.merge": "主题合并",
  "integrate.merge.hint": "选多篇合成一篇结构化草稿，观点带来源标注",
  "integrate.merge.run": "生成合并草稿",
  "integrate.merge.topic": "主题（可选）",
  "integrate.merge.create": "创建笔记",
  "integrate.gaps": "知识缺口",
  "integrate.gaps.hint": "给一个问句，反问你库里缺什么、下一步查什么",
  "integrate.gaps.run": "分析缺口",
  "integrate.gaps.placeholder": "例如：怎么训练注意力？",
  "integrate.gaps.gaps": "缺口",
  "integrate.gaps.nextSteps": "下一步",
  "integrate.picker.title": "选择笔记（可多选）",
  "integrate.created": "已创建笔记",
  "integrate.empty": "模型没有给出有效内容",

  "sessions.label": "会话",
  "sessions.new": "新建会话",
  "sessions.rename": "重命名",
  "sessions.delete": "删除",
  "sessions.empty": "新会话",
  "sessions.deleted": "会话已删除",
  "sessions.renamed": "已重命名",
};

const en: Record<string, string> = {
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "prompt.system":
    "You are Xi, a bilingual note assistant living inside Obsidian. " +
    "Answer from the provided note content, say when unsure, never invent citations; reply concisely.",
  "ribbon.tooltip": "Open Xi sidebar",
  "cmd.openSidebar": "Open Xi sidebar",
  "cmd.askSelection": "Ask Xi about selection",
  "cmd.summarizeNote": "Xi: Understand current note",

  "view.title": "Xi",
  "view.switchLang": "切换为中文",
  "view.openSettings": "Open settings",

  "tab.chat": "Chat",
  "tab.organize": "Organize",
  "tab.integrate": "Integrate",

  "chat.placeholder": "Ask something… e.g. “what do my notes on attention say?”",
  "chat.send": "Send",
  "chat.thinking": "Thinking…",
  "chat.failed": "Request failed",
  "chat.you": "You",
  "chat.lingxi": "Xi",
  "chat.citations": "Sources",
  "chat.copy": "Copy",
  "chat.copied": "Copied",
  "chat.trimmed": "Trimmed {n} older messages to fit the context budget",
  "chat.truncated": "The answer hit the output limit and may be truncated; raise max output tokens in settings.",
  "chat.contextTooLarge": "The question plus retrieved context exceeds the input budget. Lower the RAG context budget or Top-K.",
  "chat.empty.title": "Start a conversation",
  "chat.empty.desc": "Build the index once for vault-wide chat, or ask about the current note right away.",
  "chat.selectionQuestion": "Explain this selection and how it relates to the current note.",
  "chat.understandQuestion": "Understand this note: {path}",
  "chat.understandEmpty": "The model returned nothing usable",
  "chat.delete.title": "Delete session?",
  "chat.delete.body": "All messages in “{title}” will be deleted. This cannot be undone.",

  "context.label": "Context scope",
  "context.vault": "Whole vault (RAG)",
  "context.note": "Current note",
  "context.selection": "Selection",
  "context.selection.empty": "No text selected",

  "settings.group.connection": "Model connection (OpenAI-compatible /v1)",
  "settings.group.budget": "Context budget (tokens)",
  "settings.group.scope": "Index & write scope",
  "settings.group.advanced": "Advanced",
  "settings.language": "Interface language",
  "settings.language.desc": "Follow Obsidian, or force Chinese/English",
  "settings.language.auto": "Follow Obsidian",
  "settings.language.zh": "中文",
  "settings.language.en": "English",
  "settings.baseUrl": "Base URL",
  "settings.baseUrl.desc": "Defaults to the campus gateway; any OpenAI-compatible endpoint works",
  "settings.baseUrl.invalid": "Base URL cannot be empty",
  "settings.apiKey": "API key",
  "settings.apiKey.desc": "Stored in local data.json only — never in git, never uploaded",
  "settings.apiKey.show": "Show key",
  "settings.apiKey.hide": "Hide key",
  "settings.chatModel": "Chat model",
  "settings.embeddingModel": "Embedding model",
  "settings.embeddingModel.desc": "Changing this invalidates the old index; rebuild afterwards",
  "settings.model.invalid": "Model name cannot be empty",
  "settings.testConnection": "Test connection",
  "settings.test.desc": "Call /models to verify the endpoint and key",
  "settings.test.ok": "Connected: {n} models available",
  "settings.test.fail": "Connection failed: {msg}",
  "settings.maxInputTokens": "Max input tokens",
  "settings.maxInputTokens.desc": "System prompt + history + retrieved excerpts (1000–200000)",
  "settings.maxOutputTokens": "Max output tokens",
  "settings.maxOutputTokens.desc": "Maximum tokens per answer (256–65536)",
  "settings.topK": "Retrieval Top-K",
  "settings.temperature": "Temperature",
  "settings.excludeFolders": "Excluded folders (one per line)",
  "settings.autoFolders": "Auto-organize folders",
  "settings.autoFolders.desc": "New notes inside the whitelist may be auto-tagged; everything else stays suggestion-only",
  "settings.similarity": "Similarity threshold",
  "settings.contextBudget": "RAG context budget",
  "settings.contextBudget.desc": "Max tokens for retrieved excerpts (1000–60000); lower-scored ones are dropped",
  "settings.autoOpen": "Open sidebar on load (debug)",
  "settings.rebuild": "Rebuild index",
  "settings.rebuild.desc": "Re-read all notes and fill missing embeddings; edits sync incrementally",

  "err.noApiKey": "Set your API key in settings first",
  "err.emptyQuestion": "Type a question first",

  "rag.indexing": "Building index {done}/{total}…",
  "rag.indexReady": "Index ready: {files} notes · {chunks} chunks",
  "rag.indexEmpty": "Index is empty: set your API key in settings and check excluded folders.",
  "rag.rebuilding": "Rebuilding index…",
  "rag.noHits": "Nothing relevant enough in the vault; this answer cites no notes.",
  "rag.openSource": "Open source",
  "rag.context.prefix": "The following note excerpts are relevant (cite them as [n]; say so if none fit):",
  "rag.firstRunHint": "Xi is ready. Build the index once before vault-wide chat: Command palette → Rebuild Xi index.",
  "rag.modelChanged": "Embedding model changed; the old index was cleared. Rebuild the index.",
  "cmd.reindex": "Rebuild Xi index",

  "rename.title": "Rename session",
  "rename.cancel": "Cancel",
  "rename.save": "Save",
  "picker.search": "Search notes…",
  "picker.cancel": "Cancel",
  "picker.confirm": "Confirm",

  "organize.related": "Related notes",
  "organize.related.hint": "Semantic matches for the current note (index required)",
  "organize.related.run": "Find related",
  "organize.related.none": "No related notes above threshold",
  "organize.related.insert": "Insert link",
  "organize.search": "Semantic search",
  "organize.search.hint": "Search the vault in natural language, chunk-level hits",
  "organize.search.placeholder": "Search the vault in natural language…",
  "organize.search.run": "Search",
  "organize.search.none": "No hits",
  "organize.tags": "Tag suggestions",
  "organize.tags.hint": "Prefers existing vault tags; auto-applies inside whitelisted folders",
  "organize.tags.run": "Suggest tags",
  "organize.tags.apply": "Click to apply",
  "organize.tags.applied": "Written to frontmatter",
  "organize.tags.none": "No tag suggestions",
  "organize.dup": "Near-duplicates",
  "organize.dup.hint": "Note pairs whose representative vectors exceed the threshold",
  "organize.dup.run": "Detect duplicates",
  "organize.dup.none": "No near-duplicates found",
  "organize.dup.openBoth": "Open both",
  "organize.currentNote": "Current note",
  "organize.noNote": "(no note open)",
  "organize.busy": "Working…",

  "integrate.compare": "Compare notes",
  "integrate.compare.hint": "Pick 2–10 notes on one topic; outputs consensus / divergence / complementary",
  "integrate.compare.run": "Compare",
  "integrate.compare.needTwo": "Pick at least two notes",
  "integrate.compare.consensus": "Consensus",
  "integrate.compare.divergence": "Divergence",
  "integrate.compare.complementary": "Complementary",
  "integrate.compare.save": "Save as note",
  "integrate.merge": "Merge into draft",
  "integrate.merge.hint": "Merge notes into one structured draft with per-point sources",
  "integrate.merge.run": "Generate draft",
  "integrate.merge.topic": "Topic (optional)",
  "integrate.merge.create": "Create note",
  "integrate.gaps": "Knowledge gaps",
  "integrate.gaps.hint": "Ask a question; get what your vault is missing and what to research next",
  "integrate.gaps.run": "Find gaps",
  "integrate.gaps.placeholder": "e.g. how do I train attention?",
  "integrate.gaps.gaps": "Gaps",
  "integrate.gaps.nextSteps": "Next steps",
  "integrate.picker.title": "Select notes (multi-select)",
  "integrate.created": "Note created",
  "integrate.empty": "The model returned nothing usable",

  "sessions.label": "Sessions",
  "sessions.new": "New session",
  "sessions.rename": "Rename",
  "sessions.delete": "Delete",
  "sessions.empty": "New session",
  "sessions.deleted": "Session deleted",
  "sessions.renamed": "Renamed",
};

export const DICT_ZH = zh;
export const DICT_EN = en;

/** 找出两个字典的 key 差集（单测用） */
export function dictKeyDiff(a: Record<string, string>, b: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diff: string[] = [];
  for (const k of keys) {
    if (!(k in a) || !(k in b)) diff.push(k);
  }
  return diff.sort();
}

/** 按 Obsidian  locale 推断语言 */
export function detectLang(obsidianLocale: string | undefined): Lang {
  return obsidianLocale && obsidianLocale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function resolveLang(mode: LangMode, obsidianLocale: string | undefined): Lang {
  return mode === "auto" ? detectLang(obsidianLocale) : mode;
}

export class I18n {
  private lang: Lang;
  private dict: Record<string, string>;

  constructor(lang: Lang = "zh") {
    this.lang = lang;
    this.dict = lang === "zh" ? zh : en;
  }

  get current(): Lang {
    return this.lang;
  }

  setLang(lang: Lang): void {
    if (lang === this.lang) return;
    this.lang = lang;
    this.dict = lang === "zh" ? zh : en;
  }

  t(key: string, vars?: Record<string, string | number>): string {
    let text = this.dict[key];
    if (text === undefined) {
      // 兜底：另一种语言有就用，并加可见标记，避免界面出现裸 key
      const fallback = (this.lang === "zh" ? en : zh)[key];
      text = fallback === undefined ? `⚠${key}` : fallback;
    }
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.split(`{${name}}`).join(String(value));
      }
    }
    return text;
  }

  has(key: string): boolean {
    return key in this.dict;
  }
}
