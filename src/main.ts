/**
 * 希XI — 插件入口
 *
 * 职责边界：只做「生命周期 + 依赖装配 + 设置同步」。
 * 核心逻辑在 src/core（零 Obsidian import），UI 在 src/obsidian。
 */

import { Notice, Plugin, TAbstractFile, TFile, WorkspaceSidedock } from "obsidian";
import { I18n, resolveLang } from "./i18n";
import { DEFAULT_SETTINGS, mergeSettings } from "./settings";
import type { LingxiSettings } from "./settings";
import type { Transport } from "./core/llm";
import type { IndexerConfig, IndexStats } from "./core/vaultIndexer";
import { VaultIndexer } from "./core/vaultIndexer";
import { SessionStore } from "./core/sessions";
import { requestUrlTransport, fetchModelIds } from "./obsidian/gateway";
import { ObsidianVaultPort } from "./obsidian/obsidianVault";
import { ChatView, CHAT_VIEW_TYPE } from "./obsidian/chatView";
import { LingxiSettingTab } from "./obsidian/settingTab";

const SYNC_DEBOUNCE_MS = 3000;
const SETTINGS_SAVE_DEBOUNCE_MS = 500;

export default class LingxiPlugin extends Plugin {
  settings: LingxiSettings = { ...DEFAULT_SETTINGS };
  i18n: I18n = new I18n("zh");
  transport: Transport = requestUrlTransport;
  indexer: VaultIndexer | null = null;
  /** 聊天会话（多会话/切换/重命名/删除/重启恢复，落盘 sessions.json） */
  sessions: SessionStore = new SessionStore(
    async () => {},
    async () => null,
  );

  /** 索引器配置由本对象持有并随设置/语言更新（VaultIndexer 按引用读） */
  private indexerConfig: IndexerConfig | null = null;
  private syncTimer: number | null = null;
  private settingsSaveTimer: number | null = null;
  private settingsWriteChain: Promise<void> = Promise.resolve();
  private indexing = false;
  /** 最近一次索引进度（供 UI 展示） */
  indexStatus = "";

  /** 索引任务是否在跑（面板用它决定是否显示进度文案） */
  get indexingActive(): boolean {
    return this.indexing;
  }

  async onload(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
    this.i18n = new I18n(resolveLang(this.settings.language, this.getObsidianLocale()));

    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
    this.addSettingTab(new LingxiSettingTab(this.app, this));

    // 注意：addRibbonIcon 的图标 id 必须是 lucide 真实存在的，无效 id 会直接抛异常
    // 把整个 onload 打断、插件静默失效（2026-10 实测踩坑，obsidian-1.14.4.asar 验证）。
    // message-star 在该版本不存在（0 命中），message-square 存在（72 命中）。
    this.addRibbonIcon("message-square", this.t("ribbon.tooltip"), () => {
      void this.getChatView();
    });

    this.addCommand({
      id: "open-sidebar",
      name: this.t("cmd.openSidebar"),
      callback: () => {
        void this.getChatView();
      },
    });

    this.addCommand({
      id: "reindex",
      name: this.t("cmd.reindex"),
      callback: () => {
        void this.rebuildIndex("manual");
      },
    });

    this.addCommand({
      id: "ask-selection",
      name: this.t("cmd.askSelection"),
      editorCallback: (editor) => {
        const selection = editor.getSelection();
        if (selection.trim() === "") {
          new Notice(this.t("err.emptyQuestion"));
          return;
        }
        const path = this.app.workspace.getActiveFile()?.path ?? "";
        void this.askSelection(selection, path);
      },
    });

    this.addCommand({
      id: "understand-note",
      name: this.t("cmd.summarizeNote"),
      editorCallback: () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          new Notice(this.t("organize.noNote"));
          return;
        }
        void this.understandNote(file);
      },
    });

    this.setupIndexer();
    await this.indexer?.loadCache();

    // 会话落盘（插件目录 sessions.json），损坏不阻塞启动
    this.sessions = new SessionStore(
      async (data) => {
        await this.app.vault.adapter.write(this.pluginDataPath("sessions.json"), JSON.stringify(data));
      },
      async () => {
        const path = this.pluginDataPath("sessions.json");
        if (!(await this.app.vault.adapter.exists(path))) return null;
        try {
          return await this.app.vault.adapter.read(path);
        } catch {
          return null;
        }
      },
    );
    await this.sessions.restore();
    this.sessions.ensureActive();

    // 文件变动 → 防抖 3 秒增量同步（打字过程中不触发；mtime 未变的文件不重读）
    const onVaultChange = (_file: TAbstractFile) => {
      this.scheduleSync();
    };
    this.registerEvent(this.app.vault.on("modify", onVaultChange));
    this.registerEvent(this.app.vault.on("create", onVaultChange));
    this.registerEvent(this.app.vault.on("delete", onVaultChange));
    this.registerEvent(this.app.vault.on("rename", onVaultChange));

    // 首次使用提示：没缓存就告诉用户去建索引（不自动烧额度）
    if (!this.indexer || this.indexer.stats().files === 0) {
      new Notice(this.t("rag.firstRunHint"), 8000);
    }

    // 调试开关：启动即开侧边栏（真机冒烟测试用）。等布局就绪再 reveal，
    // 否则启动早期 rightSplit 还处于恢复中的 collapsed 状态，revealLeaf 不会展开。
    if (this.settings.autoOpenSidebar) {
      this.app.workspace.onLayoutReady(() => {
        void this.getChatView();
      });
    }
  }

  onunload(): void {
    if (this.syncTimer !== null) window.clearTimeout(this.syncTimer);
    if (this.settingsSaveTimer !== null) {
      window.clearTimeout(this.settingsSaveTimer);
      this.settingsSaveTimer = null;
      void this.saveSettings();
    }
    void this.sessions.flush();
  }

  /** 插件数据目录：优先 manifest.dir（用户可能改插件文件夹名） */
  private pluginDataPath(file: string): string {
    const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    return `${dir}/${file}`;
  }

  private setupIndexer(): void {
    this.indexerConfig = {
      baseUrl: this.settings.baseUrl,
      apiKey: this.settings.apiKey,
      configDir: this.app.vault.configDir,
      chatModel: this.settings.chatModel,
      embeddingModel: this.settings.embeddingModel,
      excludeFolders: this.settings.excludeFolders,
      topK: this.settings.topK,
      similarityThreshold: this.settings.similarityThreshold,
      contextBudgetTokens: this.settings.contextBudgetTokens,
      contextPrefix: this.t("rag.context.prefix"),
      language: this.i18n.current,
    };
    this.indexer = new VaultIndexer(
      new ObsidianVaultPort(this.app, this.pluginDataPath("")),
      this.indexerConfig,
      this.transport,
    );
  }

  /** 把 settings 的当前值同步给索引器（增删模型/排除项即时生效） */
  private syncIndexerConfig(): void {
    if (!this.indexerConfig) return;
    this.indexerConfig.baseUrl = this.settings.baseUrl;
    this.indexerConfig.apiKey = this.settings.apiKey;
    this.indexerConfig.chatModel = this.settings.chatModel;
    this.indexerConfig.embeddingModel = this.settings.embeddingModel;
    this.indexerConfig.excludeFolders = this.settings.excludeFolders;
    this.indexerConfig.topK = this.settings.topK;
    this.indexerConfig.similarityThreshold = this.settings.similarityThreshold;
    this.indexerConfig.contextBudgetTokens = this.settings.contextBudgetTokens;
    this.indexerConfig.contextPrefix = this.t("rag.context.prefix");
    this.indexerConfig.language = this.i18n.current;
  }

  /** 设置变更后的副作用（语言、向量模型、排除范围） */
  async onSettingChanged(key: string): Promise<void> {
    if (key === "language") this.applyLanguage();
    if (
      key === "embeddingModel" &&
      this.indexer &&
      this.indexerConfig &&
      this.settings.embeddingModel !== this.indexerConfig.embeddingModel
    ) {
      this.indexer.reset();
      this.indexStatus = this.t("rag.modelChanged");
      new Notice(this.indexStatus, 6000);
    }
    this.syncIndexerConfig();
    if (key === "excludeFolders") this.indexer?.invalidateVocabulary();
  }

  /** 立即落盘（控制在用户显式操作/卸载时；文本输入走 debounce） */
  async saveSettings(): Promise<void> {
    if (this.settingsSaveTimer !== null) {
      window.clearTimeout(this.settingsSaveTimer);
      this.settingsSaveTimer = null;
    }
    this.syncIndexerConfig();
    const snapshot = JSON.parse(JSON.stringify(this.settings)) as LingxiSettings;
    this.settingsWriteChain = this.settingsWriteChain.then(() => this.saveData(snapshot)).catch(() => {
      // data.json 写失败不阻塞界面；下次变更会重试
    });
    await this.settingsWriteChain;
  }

  /** 文本输入类设置用：500ms 合并写盘，避免每敲一个字符写一次 */
  saveSettingsDebounced(): void {
    if (this.settingsSaveTimer !== null) window.clearTimeout(this.settingsSaveTimer);
    this.settingsSaveTimer = window.setTimeout(() => {
      this.settingsSaveTimer = null;
      void this.saveSettings();
    }, SETTINGS_SAVE_DEBOUNCE_MS);
  }

  /** 语言切换后同步 i18n、索引器文案与已打开的面板 */
  applyLanguage(): void {
    const next = resolveLang(this.settings.language, this.getObsidianLocale());
    this.i18n.setLang(next);
    this.syncIndexerConfig();
    for (const leaf of this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)) {
      if (leaf.view instanceof ChatView) leaf.view.refreshLanguage();
    }
  }

  /** 建/重建全库索引。并发保护 + 错误 Notice，不 throw 到 UI 层 */
  async rebuildIndex(reason: "initial" | "manual" | "event"): Promise<IndexStats | null> {
    if (!this.indexer || this.indexing) return null;
    this.indexing = true;
    try {
      const stats = await this.indexer.syncAll(
        (phase, done, total) => {
          this.indexStatus =
            phase === "embed" ? this.t("rag.indexing", { done, total }) : this.t("rag.rebuilding");
        },
        { full: reason === "manual" },
      );
      this.indexStatus = this.t("rag.indexReady", {
        files: stats.files,
        chunks: stats.chunks,
      });
      if (reason === "manual") {
        new Notice(this.indexStatus);
      }
      return stats;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.indexStatus = `${this.t("chat.failed")}: ${msg}`;
      new Notice(this.indexStatus);
      return null;
    } finally {
      this.indexing = false;
    }
  }

  private scheduleSync(): void {
    if (this.syncTimer !== null) window.clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => {
      this.syncTimer = null;
      void this.rebuildIndex("event");
    }, SYNC_DEBOUNCE_MS);
  }

  /** 打开/聚焦侧边栏，并返回 ChatView 实例（拿不到返回 null） */
  async getChatView(): Promise<ChatView | null> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
    }
    // revealLeaf 文档说会展开侧栏，但启动恢复阶段对已 collapsed 的 split 不生效；
    // 这里显式展开，保证「启动即开」和命令打开都能看到面板。
    const root = leaf.getRoot();
    if (root instanceof WorkspaceSidedock && root.collapsed) root.expand();
    await workspace.revealLeaf(leaf);
    return leaf.view instanceof ChatView ? leaf.view : null;
  }

  /** 命令「问希XI：选中文字」：把选区作为上下文，一键解释 */
  private async askSelection(selection: string, sourcePath: string): Promise<void> {
    const view = await this.getChatView();
    await view?.askSelection(selection, sourcePath);
  }

  /** 命令「理解当前笔记」：摘要 + 关键概念 + 待解问题 */
  private async understandNote(file: TFile): Promise<void> {
    const view = await this.getChatView();
    if (!view) return;
    const text = await this.app.vault.cachedRead(file);
    await view.understandNote(file.path, text);
  }

  /** 界面语言切换（zh <-> en），同步 settings 与索引器文案 */
  async toggleLanguage(): Promise<void> {
    const next = this.i18n.current === "zh" ? "en" : "zh";
    this.settings.language = next;
    this.applyLanguage();
    await this.saveSettings();
  }

  /** 设置页「测试连接」：GET /models */
  async testConnection(): Promise<string[]> {
    const ids = await fetchModelIds({ baseUrl: this.settings.baseUrl, apiKey: this.settings.apiKey });
    if (ids.length === 0) throw new Error("no models returned");
    return ids;
  }

  t(key: string, vars?: Record<string, string | number>): string {
    return this.i18n.t(key, vars);
  }

  /** 系统提示（随语言切换） */
  systemPrompt(): string {
    return this.t("prompt.system");
  }

  private getObsidianLocale(): string | undefined {
    const locale =
      (this.app as unknown as { vault?: { getConfig?: (k: string) => unknown } }).vault?.getConfig?.("language") ??
      (typeof navigator !== "undefined" ? navigator.language : undefined);
    return typeof locale === "string" ? locale : undefined;
  }
}
