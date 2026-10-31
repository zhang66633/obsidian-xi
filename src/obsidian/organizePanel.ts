/**
 * 希XI — 整理面板（Obsidian 侧 UI）
 *
 * 半自动写权限语义（哲的选择，docs D4）：
 * 当前笔记位于 autoOrganizeFolders 白名单内 → 标签建议直接应用；
 * 白名单外 → 只出建议芯片，点一下才写入 frontmatter。
 *
 * 0.6.0 起：顶部显示索引状态（空/缺向量/正常），结果改成带摘要与分数的卡片，
 * 标签支持批量应用，重复对提供打开两篇 / 复制路径。
 */

import { Notice, TFile, setIcon } from "obsidian";
import type LingxiPlugin from "../main";
import type { DuplicatePair, RelatedNote } from "../core/related";
import { makeSnippet } from "../core/related";
import { copyText, formatScore, renderIndexBanner } from "./panelWidgets";

export class OrganizePanel {
  private plugin: LingxiPlugin;

  constructor(
    private container: HTMLElement,
    plugin: LingxiPlugin,
  ) {
    this.plugin = plugin;
  }

  private t(key: string, vars?: Record<string, string | number>): string {
    return this.plugin.t(key, vars);
  }

  render(): void {
    const c = this.container;
    c.empty();
    c.addClass("lingxi-organize");

    renderIndexBanner(c, this.plugin, () => this.render());

    const file = this.plugin.app.workspace.getActiveFile();
    const noteEl = c.createDiv({ cls: "lingxi-org-current" });
    noteEl.createSpan({
      cls: "lingxi-org-current-path",
      text: `${this.t("organize.currentNote")}: ${file ? file.path : this.t("organize.noNote")}`,
    });
    if (file) {
      const open = noteEl.createEl("button", { cls: "lingxi-link-btn", text: this.t("organize.currentNote.open") });
      open.addEventListener("click", () => this.openPath(file.path));
    }

    this.section("organize.related", "organize.related.hint", (body) => {
      const btn = body.createEl("button", { cls: "lingxi-mini-btn mod-cta", text: this.t("organize.related.run") });
      btn.addEventListener("click", () => void this.runRelated(body));
    });

    this.section("organize.search", "organize.search.hint", (body) => {
      const row = body.createDiv({ cls: "lingxi-org-row" });
      const input = row.createEl("input", {
        cls: "lingxi-org-input",
        attr: { placeholder: this.t("organize.search.placeholder") },
      });
      const btn = row.createEl("button", { cls: "lingxi-mini-btn mod-cta", text: this.t("organize.search.run") });
      const go = () => void this.runSearch(body, input.value);
      btn.addEventListener("click", go);
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") go();
      });
    });

    this.section("organize.tags", "organize.tags.hint", (body) => {
      if (file) this.renderCurrentTags(body, file);
      const btn = body.createEl("button", { cls: "lingxi-mini-btn mod-cta", text: this.t("organize.tags.run") });
      btn.addEventListener("click", () => void this.runTags(body, file));
    });

    this.section("organize.dup", "organize.dup.hint", (body) => {
      const btn = body.createEl("button", { cls: "lingxi-mini-btn", text: this.t("organize.dup.run") });
      btn.addEventListener("click", () => void this.runDuplicates(body));
    });
  }

  private section(titleKey: string, descKey: string, build: (body: HTMLElement) => void): void {
    const box = this.container.createDiv({ cls: "lingxi-section" });
    box.createDiv({ cls: "lingxi-section-title", text: this.t(titleKey) });
    box.createDiv({ cls: "lingxi-section-desc", text: this.t(descKey) });
    build(box);
  }

  private setBusy(body: HTMLElement, busy: boolean, text?: string): void {
    for (const btn of Array.from(body.querySelectorAll<HTMLButtonElement>("button"))) btn.disabled = busy;
    if (busy && text) {
      const status = body.createDiv({ cls: "lingxi-section-status", text });
      status.dataset.busy = "1";
    } else {
      this.clearBusy(body);
    }
  }

  private clearBusy(body: HTMLElement): void {
    for (const el of Array.from(body.querySelectorAll(".lingxi-section-status[data-busy]"))) el.remove();
  }

  private clearResults(body: HTMLElement): void {
    for (const el of Array.from(body.querySelectorAll(".lingxi-results, .lingxi-count, .lingxi-section-status"))) {
      el.remove();
    }
  }

  private actionButton(
    parent: HTMLElement,
    label: string,
    icon: string,
    onClick: () => void,
    cls = "lingxi-mini-btn",
  ): HTMLButtonElement {
    const btn = parent.createEl("button", { cls });
    setIcon(btn, icon);
    btn.createSpan({ text: label });
    btn.addEventListener("click", onClick);
    return btn;
  }

  private hasIndex(): boolean {
    const indexer = this.plugin.indexer;
    if (!indexer || indexer.stats().vectors === 0) {
      new Notice(this.t("organize.index.empty"));
      return false;
    }
    return true;
  }

  private activeFile(): TFile | null {
    const file = this.plugin.app.workspace.getActiveFile();
    if (!file) new Notice(this.t("organize.noNote"));
    return file;
  }

  /* ---------- 相关笔记 ---------- */

  private async runRelated(body: HTMLElement): Promise<void> {
    const indexer = this.plugin.indexer;
    const file = this.activeFile();
    if (!indexer || !file || !this.hasIndex()) return;

    this.setBusy(body, true, this.t("organize.busy"));
    try {
      const list: RelatedNote[] = await indexer.relatedNotesFor(file.path, { topN: 10 });
      this.clearBusy(body);
      this.clearResults(body);
      if (list.length === 0) {
        body.createDiv({ cls: "lingxi-section-status", text: this.t("organize.related.none") });
        return;
      }
      body.createDiv({ cls: "lingxi-count", text: this.t("organize.related.count", { n: list.length }) });
      const box = body.createDiv({ cls: "lingxi-results" });
      for (const item of list) this.relatedCard(box, item);
    } catch (err) {
      this.clearBusy(body);
      new Notice(errMsg(err));
    } finally {
      this.setBusy(body, false);
    }
  }

  private relatedCard(parent: HTMLElement, item: RelatedNote): void {
    const card = parent.createDiv({ cls: "lingxi-result-card" });
    const head = card.createDiv({ cls: "lingxi-result-head" });
    const title = head.createEl("button", { cls: "lingxi-result-title", text: item.path });
    title.addEventListener("click", () => this.openPath(item.path));
    head.createSpan({ cls: "lingxi-score", text: formatScore(item.score) });
    if (item.heading) card.createDiv({ cls: "lingxi-result-meta", text: item.heading });
    if (item.snippet) card.createDiv({ cls: "lingxi-snippet", text: item.snippet });
    const actions = card.createDiv({ cls: "lingxi-result-actions" });
    this.actionButton(actions, this.t("common.open"), "file-text", () => this.openPath(item.path));
    this.actionButton(actions, this.t("organize.related.insert"), "link", () => this.insertLink(item.path));
  }

  /* ---------- 语义搜索 ---------- */

  private async runSearch(body: HTMLElement, query: string): Promise<void> {
    const indexer = this.plugin.indexer;
    const q = query.trim();
    if (!indexer || q === "") return;
    if (!this.hasIndex()) return;
    this.setBusy(body, true, this.t("organize.busy"));
    try {
      const { hits } = await indexer.retrieve(q);
      this.clearBusy(body);
      this.clearResults(body);
      if (hits.length === 0) {
        body.createDiv({ cls: "lingxi-section-status", text: this.t("organize.search.none") });
        return;
      }
      body.createDiv({ cls: "lingxi-count", text: this.t("organize.search.count", { n: hits.length }) });
      const box = body.createDiv({ cls: "lingxi-results" });
      for (const hit of hits) {
        const chunk = indexer.index.getChunk(hit.id);
        if (!chunk) continue;
        const card = box.createDiv({ cls: "lingxi-result-card" });
        const head = card.createDiv({ cls: "lingxi-result-head" });
        const label = chunk.heading ? `${chunk.path} › ${chunk.heading}` : chunk.path;
        const title = head.createEl("button", { cls: "lingxi-result-title", text: label });
        title.addEventListener("click", () => this.openPath(chunk.path, chunk.heading));
        head.createSpan({ cls: "lingxi-score", text: formatScore(hit.score) });
        card.createDiv({ cls: "lingxi-snippet", text: makeSnippet(chunk.text) });
        const actions = card.createDiv({ cls: "lingxi-result-actions" });
        this.actionButton(actions, this.t("common.open"), "file-text", () =>
          this.openPath(chunk.path, chunk.heading),
        );
        this.actionButton(actions, this.t("common.copy"), "copy", () =>
          void copyText(`[[${chunk.path.replace(/\.md$/, "")}]]`, this.plugin),
        );
      }
    } catch (err) {
      this.clearBusy(body);
      new Notice(errMsg(err));
    } finally {
      this.setBusy(body, false);
    }
  }

  /* ---------- 标签建议 ---------- */

  private renderCurrentTags(body: HTMLElement, file: TFile): void {
    const tags = currentTags(this.plugin, file);
    const row = body.createDiv({ cls: "lingxi-tag-current" });
    row.createSpan({ cls: "lingxi-tag-current-label", text: this.t("organize.tags.current") });
    if (tags.length === 0) {
      row.createSpan({ cls: "lingxi-tag-empty", text: this.t("organize.tags.noneCurrent") });
    } else {
      for (const tag of tags) {
        row.createSpan({ cls: "lingxi-tag-chip is-current", text: `#${tag}` });
      }
    }
    if (this.inAutoFolder(file)) {
      row.createDiv({ cls: "lingxi-tag-auto", text: this.t("organize.tags.autoHint") });
    }
  }

  private async runTags(body: HTMLElement, file: TFile | null): Promise<void> {
    const indexer = this.plugin.indexer;
    if (!indexer || !file || !this.hasIndex()) return;
    this.setBusy(body, true, this.t("organize.busy"));
    try {
      const tags = await indexer.suggestTags(file.path);
      this.clearBusy(body);
      this.clearResults(body);
      if (tags.length === 0) {
        body.createDiv({ cls: "lingxi-section-status", text: this.t("organize.tags.none") });
        return;
      }
      const auto = this.inAutoFolder(file);
      if (auto) {
        // 白名单内：半自动直接应用
        await this.applyTags(file, tags);
        body.createDiv({ cls: "lingxi-section-status", text: `${this.t("organize.tags.applied")}: ${tags.join(" ")}` });
        return;
      }
      const box = body.createDiv({ cls: "lingxi-results lingxi-chips" });
      const chips: HTMLButtonElement[] = [];
      for (const tag of tags) {
        const chip = box.createEl("button", { cls: "lingxi-chip", text: `#${tag}` });
        chip.setAttribute("title", this.t("organize.tags.apply"));
        chip.addEventListener("click", () => {
          void this.applyTags(file, [tag]).then(() => {
            chip.disabled = true;
            chip.addClass("is-applied");
          });
        });
        chips.push(chip);
      }
      const applyAll = this.actionButton(
        body,
        this.t("organize.tags.applyAll"),
        "check-check",
        () => {
          void this.applyTags(file, tags).then(() => {
            for (const chip of chips) {
              chip.disabled = true;
              chip.addClass("is-applied");
            }
            applyAll.disabled = true;
            new Notice(this.t("organize.tags.applied"));
          });
        },
        "lingxi-mini-btn mod-cta",
      );
    } catch (err) {
      this.clearBusy(body);
      new Notice(errMsg(err));
    } finally {
      this.setBusy(body, false);
    }
  }

  private inAutoFolder(file: TFile): boolean {
    const folders = this.plugin.settings.autoOrganizeFolders;
    const path = file.path.replace(/\\/g, "/");
    return folders.some((f) => {
      const ff = f.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      return ff !== "" && (path === ff || path.startsWith(`${ff}/`));
    });
  }

  private async applyTags(file: TFile, tags: string[]): Promise<void> {
    await this.plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      const raw = fm.tags;
      const current: string[] = Array.isArray(raw)
        ? raw.map((v) => String(v))
        : typeof raw === "string"
          ? [raw]
          : [];
      const merged = [...current];
      for (const tag of tags) {
        if (!merged.includes(tag)) merged.push(tag);
      }
      fm.tags = merged;
    });
  }

  /* ---------- 近似重复 ---------- */

  private async runDuplicates(body: HTMLElement): Promise<void> {
    const indexer = this.plugin.indexer;
    if (!indexer || !this.hasIndex()) return;
    this.setBusy(body, true, this.t("organize.busy"));
    try {
      const pairs: DuplicatePair[] = indexer.duplicates();
      this.clearBusy(body);
      this.clearResults(body);
      if (pairs.length === 0) {
        body.createDiv({ cls: "lingxi-section-status", text: this.t("organize.dup.none") });
        return;
      }
      body.createDiv({ cls: "lingxi-count", text: this.t("organize.dup.count", { n: pairs.length }) });
      const box = body.createDiv({ cls: "lingxi-results" });
      for (const pair of pairs.slice(0, 20)) {
        const card = box.createDiv({ cls: "lingxi-result-card" });
        const head = card.createDiv({ cls: "lingxi-result-head" });
        const title = head.createEl("button", { cls: "lingxi-result-title", text: `${pair.a} ↔ ${pair.b}` });
        title.addEventListener("click", () => this.openPath(pair.a));
        head.createSpan({ cls: "lingxi-score", text: formatScore(pair.score) });
        const actions = card.createDiv({ cls: "lingxi-result-actions" });
        this.actionButton(actions, this.t("organize.dup.openBoth"), "external-link", () => this.openBoth(pair.a, pair.b));
        this.actionButton(actions, this.t("organize.dup.copy"), "copy", () =>
          void copyText(`${pair.a}\n${pair.b}`, this.plugin),
        );
      }
    } catch (err) {
      this.clearBusy(body);
      new Notice(errMsg(err));
    } finally {
      this.setBusy(body, false);
    }
  }

  /* ---------- 工具 ---------- */

  private openBoth(a: string, b: string): void {
    void this.plugin.app.workspace.openLinkText(a.replace(/\.md$/, ""), "", false);
    void this.plugin.app.workspace.openLinkText(b.replace(/\.md$/, ""), "", true);
  }

  private openPath(path: string, heading?: string): void {
    const link = path.replace(/\.md$/, "");
    const target = heading ? `${link}#${heading}` : link;
    void this.plugin.app.workspace.openLinkText(target, "", false);
  }

  private insertLink(path: string): void {
    const editor = this.plugin.app.workspace.activeEditor?.editor;
    if (!editor) {
      new Notice(this.t("organize.noNote"));
      return;
    }
    editor.replaceSelection(`[[${path.replace(/\.md$/, "")}]]`);
  }
}

function currentTags(plugin: LingxiPlugin, file: TFile): string[] {
  const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
  const raw: unknown = fm?.tags;
  const list = Array.isArray(raw) ? raw.map((v) => String(v)) : typeof raw === "string" ? [raw] : [];
  return list.map((v) => v.replace(/^#+/, "").trim()).filter((v) => v !== "");
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
