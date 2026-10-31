/**
 * 希XI — 侧边栏视图（ItemView）
 *
 * 三个 Tab：对话 / 整理 / 整合。
 * 对话层职责：会话选择、上下文装配（笔记本体 / 选区 / 全库 RAG）、
 * 预算裁剪、Markdown 渲染、引用跳转。业务逻辑都在 core/。
 */

import { ItemView, MarkdownRenderer, MarkdownView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type LingxiPlugin from "../main";
import { chatCompletionDetailed } from "../core/llm";
import type { ChatMessage } from "../core/llm";
import type { Citation } from "../core/rag";
import { estimateTokens } from "../core/rag";
import { fitHistory } from "../core/chatBudget";
import { sessionLabel } from "../core/sessions";
import { anatomyToMarkdown, runAnatomy } from "../core/anatomy";
import { OrganizePanel } from "./organizePanel";
import { IntegratePanel } from "./integratePanel";
import { RenameModal } from "./renameModal";
import { ConfirmModal } from "./confirmModal";

export const CHAT_VIEW_TYPE = "xi-chat-view";

type Tab = "chat" | "organize" | "integrate";
type ContextMode = "note" | "selection" | "vault";

interface PendingSelection {
  text: string;
  path: string;
}

export class ChatView extends ItemView {
  private plugin: LingxiPlugin;
  private busy = false;
  private activeTab: Tab = "chat";
  private contextMode: ContextMode = "note";
  private pendingSelection: PendingSelection | null = null;
  private statusTimer: number | null = null;

  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private footerEl: HTMLElement | null = null;
  private sessionBarEl: HTMLElement | null = null;
  private sessionSelect: HTMLSelectElement | null = null;
  private tabsBtn: Record<Tab, HTMLElement> | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: LingxiPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.plugin.t("view.title");
  }

  getIcon(): string {
    return "message-square";
  }

  /* ---------- 会话便捷访问 ---------- */

  private activeSession() {
    return this.plugin.sessions.ensureActive(this.contextMode);
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("lingxi-root");

    /* ---- header ---- */
    const header = root.createDiv({ cls: "lingxi-header" });
    header.createSpan({ cls: "lingxi-title", text: this.plugin.t("view.title") });

    const langBtn = header.createEl("button", { cls: "lingxi-icon-btn lingxi-lang-btn" });
    langBtn.setText(this.plugin.i18n.current === "zh" ? "EN" : "中");
    langBtn.setAttribute("title", this.plugin.t("view.switchLang"));
    langBtn.setAttribute("aria-label", this.plugin.t("view.switchLang"));
    langBtn.addEventListener("click", () => {
      void this.plugin.toggleLanguage();
    });

    const gear = header.createEl("button", { cls: "lingxi-icon-btn" });
    setIcon(gear, "settings");
    gear.setAttribute("aria-label", this.plugin.t("view.openSettings"));
    gear.setAttribute("title", this.plugin.t("view.openSettings"));
    gear.addEventListener("click", () => {
      const setting = (
        this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }
      ).setting;
      setting.open();
      setting.openTabById(this.plugin.manifest.id);
    });

    /* ---- 会话栏 ---- */
    this.sessionBarEl = root.createDiv({ cls: "lingxi-session-bar" });
    this.renderSessionBar();

    /* ---- tabs ---- */
    const tabs = root.createDiv({ cls: "lingxi-tabs" });
    const tabChat = tabs.createEl("button", { cls: "lingxi-tab", text: this.plugin.t("tab.chat") });
    const tabOrg = tabs.createEl("button", { cls: "lingxi-tab", text: this.plugin.t("tab.organize") });
    const tabInt = tabs.createEl("button", { cls: "lingxi-tab", text: this.plugin.t("tab.integrate") });
    this.tabsBtn = { chat: tabChat, organize: tabOrg, integrate: tabInt };
    for (const [key, el] of Object.entries(this.tabsBtn) as Array<[Tab, HTMLElement]>) {
      el.addEventListener("click", () => {
        this.activeTab = key;
        this.syncTabs();
        this.renderBody();
      });
    }
    this.syncTabs();

    /* ---- body / footer ---- */
    this.bodyEl = root.createDiv({ cls: "lingxi-body" });
    this.renderFooter(root);
    this.renderBody();
  }

  /** 语言切换后整块重建静态文案 */
  refreshLanguage(): void {
    this.render();
  }

  /** 命令「问希XI：选中文字」的落点：把选区当上下文，一键解释 */
  async askSelection(selection: string, sourcePath: string): Promise<void> {
    if (selection.trim() === "") {
      new Notice(this.plugin.t("context.selection.empty"));
      return;
    }
    this.pendingSelection = { text: selection, path: sourcePath };
    this.contextMode = "selection";
    const session = this.plugin.sessions.ensureActive("selection");
    this.plugin.sessions.setContextMode(session.id, "selection");
    this.activeTab = "chat";
    this.syncTabs();
    this.renderBody();
    const context = `\n\n【${this.plugin.t("context.selection")}${sourcePath ? `: ${sourcePath}` : ""}】\n${selection}`;
    this.pendingSelection = null;
    await this.runTurn(this.plugin.t("chat.selectionQuestion"), context, []);
  }

  /** 命令「理解当前笔记」的落点：摘要 + 关键概念 + 待解问题 */
  async understandNote(path: string, text: string): Promise<void> {
    if (this.plugin.settings.apiKey.trim() === "") {
      new Notice(this.plugin.t("err.noApiKey"));
      return;
    }
    if (text.trim() === "") {
      new Notice(this.plugin.t("organize.noNote"));
      return;
    }
    const session = this.plugin.sessions.ensureActive(this.contextMode);
    const question = this.plugin.t("chat.understandQuestion", { path });
    this.plugin.sessions.append(session.id, { role: "user", content: question });
    this.showUserTurn(question);

    this.setBusy(true, this.plugin.t("chat.thinking"));
    try {
      const result = await runAnatomy(
        this.plugin.transport,
        {
          baseUrl: this.plugin.settings.baseUrl,
          apiKey: this.plugin.settings.apiKey,
          chatModel: this.plugin.settings.chatModel,
          language: this.plugin.i18n.current,
          maxOutputTokens: Math.min(this.plugin.settings.maxOutputTokens, 2048),
        },
        path,
        text,
      );
      const markdown = anatomyToMarkdown(result, this.plugin.i18n.current) || this.plugin.t("chat.understandEmpty");
      this.plugin.sessions.append(session.id, { role: "assistant", content: markdown });
      this.showAssistantTurn(session.id, markdown);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.showAssistantTurn(session.id, `${this.plugin.t("chat.failed")}: ${msg}`);
    } finally {
      this.setBusy(false);
    }
  }

  private renderSessionBar(): void {
    const bar = this.sessionBarEl;
    if (!bar) return;
    bar.empty();

    const sel = bar.createEl("select", { cls: "lingxi-session-select" });
    const sessions = this.plugin.sessions.list();
    const activeId = this.plugin.sessions.active?.id ?? null;
    for (const s of sessions) {
      sel.createEl("option", {
        text: sessionLabel(s, this.plugin.t("sessions.empty")),
        value: s.id,
      });
    }
    if (activeId) sel.value = activeId;
    sel.setAttribute("aria-label", this.plugin.t("sessions.label"));
    sel.setAttribute("title", this.plugin.t("sessions.label"));
    sel.addEventListener("change", () => {
      const id = sel.value;
      if (this.plugin.sessions.switchTo(id)) {
        const s = this.plugin.sessions.active;
        if (s) this.contextMode = s.contextMode;
        this.render();
      }
    });
    this.sessionSelect = sel;

    const newBtn = bar.createEl("button", { cls: "lingxi-icon-btn" });
    setIcon(newBtn, "plus");
    newBtn.setAttribute("title", this.plugin.t("sessions.new"));
    newBtn.setAttribute("aria-label", this.plugin.t("sessions.new"));
    newBtn.addEventListener("click", () => {
      this.plugin.sessions.create(this.contextMode);
      this.render();
    });

    const renameBtn = bar.createEl("button", { cls: "lingxi-icon-btn" });
    setIcon(renameBtn, "pencil");
    renameBtn.setAttribute("title", this.plugin.t("sessions.rename"));
    renameBtn.setAttribute("aria-label", this.plugin.t("sessions.rename"));
    renameBtn.addEventListener("click", () => {
      const s = this.plugin.sessions.active;
      if (!s) return;
      new RenameModal(
        this.app,
        s.title,
        {
          title: this.plugin.t("rename.title"),
          cancel: this.plugin.t("rename.cancel"),
          save: this.plugin.t("rename.save"),
        },
        (title) => {
          if (title !== null) {
            this.plugin.sessions.rename(s.id, title);
            new Notice(this.plugin.t("sessions.renamed"));
            this.renderSessionBar();
          }
        },
      ).open();
    });

    const delBtn = bar.createEl("button", { cls: "lingxi-icon-btn" });
    setIcon(delBtn, "trash-2");
    delBtn.setAttribute("title", this.plugin.t("sessions.delete"));
    delBtn.setAttribute("aria-label", this.plugin.t("sessions.delete"));
    delBtn.addEventListener("click", () => {
      const s = this.plugin.sessions.active;
      if (!s) return;
      new ConfirmModal(this.app, {
        title: this.plugin.t("chat.delete.title"),
        body: this.plugin.t("chat.delete.body", { title: s.title || this.plugin.t("sessions.empty") }),
        confirmText: this.plugin.t("common.delete"),
        cancelText: this.plugin.t("common.cancel"),
        onConfirm: () => {
          if (this.plugin.sessions.remove(s.id)) {
            new Notice(this.plugin.t("sessions.deleted"));
            this.render();
          }
        },
      }).open();
    });
  }

  private syncTabs(): void {
    if (!this.tabsBtn) return;
    for (const [key, el] of Object.entries(this.tabsBtn) as Array<[Tab, HTMLElement]>) {
      el.toggleClass("is-active", key === this.activeTab);
    }
  }

  private renderFooter(root: HTMLElement): void {
    const footer = root.createDiv({ cls: "lingxi-footer" });
    this.footerEl = footer;

    const row = footer.createDiv({ cls: "lingxi-context-row" });
    row.createSpan({ cls: "lingxi-context-label", text: this.plugin.t("context.label") });
    const sel = row.createEl("select", { cls: "lingxi-context-select" });
    sel.createEl("option", { text: this.plugin.t("context.note"), value: "note" });
    sel.createEl("option", { text: this.plugin.t("context.selection"), value: "selection" });
    sel.createEl("option", { text: this.plugin.t("context.vault"), value: "vault" });
    sel.value = this.contextMode;
    sel.setAttribute("aria-label", this.plugin.t("context.label"));
    sel.addEventListener("change", () => {
      const v = sel.value;
      const mode: ContextMode = v === "vault" ? "vault" : v === "selection" ? "selection" : "note";
      this.contextMode = mode;
      const s = this.plugin.sessions.active;
      if (s) this.plugin.sessions.setContextMode(s.id, mode);
    });

    const inputRow = footer.createDiv({ cls: "lingxi-input-row" });
    const input = inputRow.createEl("textarea", { cls: "lingxi-input" });
    input.setAttribute("rows", "2");
    input.setAttribute("placeholder", this.plugin.t("chat.placeholder"));
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        void this.onSend();
      }
    });
    this.inputEl = input;

    const send = inputRow.createEl("button", { cls: "lingxi-send mod-cta" });
    send.setText(this.plugin.t("chat.send"));
    send.addEventListener("click", () => void this.onSend());
    this.sendBtn = send;

    const status = footer.createDiv({ cls: "lingxi-status" });
    this.statusEl = status;
  }

  /** 整块重建（语言切换 / 会话切换用） */
  private render(): void {
    this.contentEl.empty();
    this.messagesEl = null;
    this.inputEl = null;
    this.sendBtn = null;
    this.statusEl = null;
    this.bodyEl = null;
    this.footerEl = null;
    this.sessionBarEl = null;
    this.tabsBtn = null;
    void this.onOpen();
  }

  private renderBody(): void {
    if (!this.bodyEl || !this.footerEl) return;
    this.bodyEl.empty();
    this.footerEl.toggleClass("is-hidden", this.activeTab !== "chat");
    if (this.activeTab === "organize") {
      new OrganizePanel(this.bodyEl, this.plugin).render();
      this.messagesEl = null;
      return;
    }
    if (this.activeTab === "integrate") {
      new IntegratePanel(this.bodyEl, this.plugin).render();
      this.messagesEl = null;
      return;
    }
    this.messagesEl = this.bodyEl.createDiv({ cls: "lingxi-messages" });
    const session = this.activeSession();
    if (session.messages.length === 0) {
      this.renderEmptyState();
    }
    for (const m of session.messages) {
      this.appendMessageEl(m.role, m.content, m.citations);
    }
    this.scrollToBottom();
  }

  private renderEmptyState(): void {
    if (!this.messagesEl) return;
    const box = this.messagesEl.createDiv({ cls: "lingxi-empty" });
    box.createDiv({ cls: "lingxi-empty-title", text: this.plugin.t("chat.empty.title") });
    box.createDiv({ cls: "lingxi-empty-desc", text: this.plugin.t("chat.empty.desc") });
  }

  private appendMessageEl(role: ChatMessage["role"], content: string, citations?: Citation[]): void {
    if (!this.messagesEl) return;
    // 首条消息到达时把「开始对话」空状态移除，否则它会一直挂在消息上方
    this.messagesEl.querySelector(".lingxi-empty")?.remove();
    const isUser = role === "user";
    const bubble = this.messagesEl.createDiv({
      cls: `lingxi-msg ${isUser ? "is-user" : "is-assistant"}`,
    });
    bubble.createDiv({
      cls: "lingxi-msg-who",
      text: isUser ? this.plugin.t("chat.you") : this.plugin.t("chat.lingxi"),
    });

    if (isUser) {
      bubble.createDiv({ cls: "lingxi-msg-text", text: content });
    } else {
      const textEl = bubble.createDiv({ cls: "lingxi-msg-text markdown-rendered" });
      const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";
      void MarkdownRenderer.render(this.app, content, textEl, sourcePath, this).then(() => {
        this.scrollToBottom();
      });
      this.renderMessageActions(bubble, content);
    }

    if (!isUser && citations && citations.length > 0) {
      this.renderCitations(bubble, citations);
    }
    this.scrollToBottom();
  }

  private renderMessageActions(bubble: HTMLElement, content: string): void {
    const actions = bubble.createDiv({ cls: "lingxi-msg-actions" });
    const copy = actions.createEl("button", { cls: "lingxi-msg-copy" });
    setIcon(copy, "copy");
    copy.setAttribute("aria-label", this.plugin.t("chat.copy"));
    copy.setAttribute("title", this.plugin.t("chat.copy"));
    copy.addEventListener("click", () => {
      void this.copyText(content);
    });
  }

  private async copyText(text: string): Promise<void> {
    try {
      await window.navigator.clipboard.writeText(text);
      new Notice(this.plugin.t("chat.copied"));
    } catch (err) {
      new Notice(`${this.plugin.t("chat.failed")}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 引用卡片：[n] 笔记名 › 标题，点击打开对应笔记 */
  private renderCitations(bubble: HTMLElement, citations: Citation[]): void {
    const indexer = this.plugin.indexer;
    const box = bubble.createDiv({ cls: "lingxi-citations" });
    box.createDiv({ cls: "lingxi-citations-title", text: this.plugin.t("chat.citations") });
    for (const c of citations) {
      const chunk = indexer?.index.getChunk(c.chunkId);
      const chip = box.createEl("button", { cls: "lingxi-cite-chip" });
      const label = chunk ? `[${c.index}] ${chunk.path}${chunk.heading ? ` › ${chunk.heading}` : ""}` : `[${c.index}]`;
      chip.setText(label);
      chip.setAttribute("title", this.plugin.t("rag.openSource"));
      chip.addEventListener("click", () => {
        if (!chunk) return;
        void this.app.workspace.openLinkText(chunk.path.replace(/\.md$/, ""), "", false);
      });
    }
  }

  private async buildNoteContext(): Promise<string> {
    if (this.contextMode === "selection") {
      let selection = "";
      let path = "";
      if (this.pendingSelection) {
        selection = this.pendingSelection.text;
        path = this.pendingSelection.path;
        this.pendingSelection = null;
      } else {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        selection = view?.editor.getSelection() ?? "";
        path = this.app.workspace.getActiveFile()?.path ?? "";
      }
      if (selection.trim() === "") return "";
      return `\n\n【${this.plugin.t("context.selection")}${path ? `: ${path}` : ""}】\n${selection}`;
    }
    const file = this.app.workspace.getActiveFile();
    if (!file) return "";
    const text = await this.app.vault.cachedRead(file);
    return `\n\n【${this.plugin.t("context.note")}: ${file.path}】\n${text.slice(0, 20000)}`;
  }

  private setBusy(busy: boolean, statusText?: string): void {
    this.busy = busy;
    if (this.sendBtn) this.sendBtn.disabled = busy;
    if (this.inputEl) this.inputEl.disabled = busy;
    if (this.statusEl) this.statusEl.setText(statusText ?? (busy ? this.plugin.t("chat.thinking") : ""));
    if (!busy) this.clearStatusTimer();
  }

  private showStatus(text: string, clearAfterMs = 4000): void {
    if (!this.statusEl) return;
    this.statusEl.setText(text);
    this.clearStatusTimer();
    this.statusTimer = window.setTimeout(() => {
      if (this.statusEl) this.statusEl.setText("");
      this.statusTimer = null;
    }, clearAfterMs);
  }

  private clearStatusTimer(): void {
    if (this.statusTimer !== null) {
      window.clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
  }

  private scrollToBottom(): void {
    if (this.bodyEl) this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
  }

  /** 如果当前不在 chat tab，先切回来并重绘（避免消息渲染到旧容器） */
  private ensureChatTab(): void {
    if (this.activeTab === "chat") return;
    this.activeTab = "chat";
    this.syncTabs();
    this.renderBody();
  }

  private showUserTurn(text: string): void {
    const wasChat = this.activeTab === "chat";
    this.ensureChatTab();
    if (wasChat) this.appendMessageEl("user", text);
    this.renderSessionBar();
  }

  private showAssistantTurn(sessionId: string, text: string, citations?: Citation[]): void {
    if (this.plugin.sessions.active?.id !== sessionId) return;
    const wasChat = this.activeTab === "chat";
    this.ensureChatTab();
    if (wasChat) this.appendMessageEl("assistant", text, citations);
    this.renderSessionBar();
  }

  private async collectContext(question: string): Promise<{ block: string; citations: Citation[] }> {
    if (this.contextMode !== "vault") {
      return { block: await this.buildNoteContext(), citations: [] };
    }
    const stats = this.plugin.indexer?.stats();
    if (!stats || stats.vectors === 0) {
      this.setBusy(true, this.plugin.t("rag.rebuilding"));
      await this.plugin.rebuildIndex("manual");
    }
    const indexer = this.plugin.indexer;
    if (!indexer || indexer.stats().vectors === 0) {
      new Notice(this.plugin.t("rag.indexEmpty"));
      return { block: "", citations: [] };
    }
    const result = await indexer.retrieve(question);
    if (result.context.prompt === "") new Notice(this.plugin.t("rag.noHits"));
    return {
      block: result.context.prompt === "" ? "" : `\n\n${result.context.prompt}`,
      citations: result.context.citations,
    };
  }

  private async onSend(): Promise<void> {
    if (this.busy) return;
    const question = this.inputEl?.value.trim() ?? "";
    if (question === "") {
      new Notice(this.plugin.t("err.emptyQuestion"));
      return;
    }
    if (this.plugin.settings.apiKey.trim() === "") {
      new Notice(this.plugin.t("err.noApiKey"));
      return;
    }

    let context: { block: string; citations: Citation[] };
    try {
      context = await this.collectContext(question);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.showAssistantTurn(this.activeSession().id, `${this.plugin.t("chat.failed")}: ${msg}`);
      this.setBusy(false);
      return;
    }
    if (this.contextMode === "selection" && context.block === "") {
      new Notice(this.plugin.t("context.selection.empty"));
      return;
    }
    if (this.inputEl) this.inputEl.value = "";
    await this.runTurn(question, context.block, context.citations);
  }

  private async runTurn(question: string, contextBlock: string, citations: Citation[]): Promise<void> {
    const settings = this.plugin.settings;
    const session = this.plugin.sessions.ensureActive(this.contextMode);
    this.plugin.sessions.append(session.id, { role: "user", content: question });
    this.showUserTurn(question);
    this.setBusy(true, this.plugin.t("chat.thinking"));

    let trimmed = 0;
    let status = "";
    try {
      const system = this.plugin.systemPrompt();
      const userContent = `${question}${contextBlock}`;
      const fixed = estimateTokens(system) + estimateTokens(userContent) + 64;
      if (fixed > settings.maxInputTokens) throw new Error(this.plugin.t("chat.contextTooLarge"));
      const fit = fitHistory(session.messages.slice(0, -1), {
        maxTokens: settings.maxInputTokens,
        reserveTokens: fixed,
      });
      trimmed = fit.dropped;
      const messages: ChatMessage[] = [
        { role: "system", content: system },
        ...fit.messages,
        { role: "user", content: userContent },
      ];
      const reply = await chatCompletionDetailed(
        this.plugin.transport,
        {
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          chatModel: settings.chatModel,
        },
        messages,
        { temperature: settings.temperature, maxTokens: settings.maxOutputTokens },
      );
      const answer = reply.text;
      this.plugin.sessions.append(session.id, { role: "assistant", content: answer, citations });
      this.showAssistantTurn(session.id, answer, citations);
      if (reply.finishReason === "length") {
        status = this.plugin.t("chat.truncated");
      } else if (trimmed > 0) {
        status = this.plugin.t("chat.trimmed", { n: trimmed });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.showAssistantTurn(session.id, `${this.plugin.t("chat.failed")}: ${msg}`);
    } finally {
      this.setBusy(false);
      if (status) this.showStatus(status);
    }
  }

  async onClose(): Promise<void> {
    this.clearStatusTimer();
    this.contentEl.empty();
  }
}
