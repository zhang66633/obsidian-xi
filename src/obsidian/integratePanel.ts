/**
 * 希XI — 整合面板（Obsidian 侧 UI）
 * 三件套：多篇对比（共识/分歧/互补）、主题合并（草稿可编辑）、知识缺口。
 * 逻辑在 core/insight.ts（已单测），这里只做编排与渲染。
 *
 * 0.6.0：显示索引状态/上下文条数，来源 chips 常驻；合并草稿可编辑，
 * 保存时写 frontmatter（created + source 双链）；结果支持复制。
 */

import { Notice, TFile, setIcon } from "obsidian";
import type LingxiPlugin from "../main";
import { runCompareDetailed, runGapsDetailed, runMerge } from "../core/insight";
import type { CompareResult, GapResult } from "../core/insight";
import { MultiFileModal } from "./multiFileModal";
import { copyText, renderIndexBanner } from "./panelWidgets";

const MAX_PICK = 10;

export class IntegratePanel {
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

  private insightCfg() {
    return {
      baseUrl: this.plugin.settings.baseUrl,
      apiKey: this.plugin.settings.apiKey,
      chatModel: this.plugin.settings.chatModel,
      language: this.plugin.i18n.current,
      maxOutputTokens: this.plugin.settings.maxOutputTokens,
    };
  }

  render(): void {
    const c = this.container;
    c.empty();
    c.addClass("lingxi-integrate");

    renderIndexBanner(c, this.plugin, () => this.render());

    this.section("integrate.compare", "integrate.compare.hint", (body) => {
      const btn = body.createEl("button", { cls: "lingxi-mini-btn mod-cta", text: this.t("integrate.compare.run") });
      btn.addEventListener("click", () => void this.runCompare(body));
    });

    this.section("integrate.merge", "integrate.merge.hint", (body) => {
      const row = body.createDiv({ cls: "lingxi-org-row" });
      const topic = row.createEl("input", {
        cls: "lingxi-org-input",
        attr: { placeholder: this.t("integrate.merge.topic") },
      });
      const btn = row.createEl("button", { cls: "lingxi-mini-btn mod-cta", text: this.t("integrate.merge.run") });
      btn.addEventListener("click", () => void this.runMerge(body, topic.value.trim() || undefined));
    });

    this.section("integrate.gaps", "integrate.gaps.hint", (body) => {
      const row = body.createDiv({ cls: "lingxi-org-row" });
      const input = row.createEl("input", {
        cls: "lingxi-org-input",
        attr: { placeholder: this.t("integrate.gaps.placeholder") },
      });
      const btn = row.createEl("button", { cls: "lingxi-mini-btn mod-cta", text: this.t("integrate.gaps.run") });
      const go = () => void this.runGaps(body, input.value);
      btn.addEventListener("click", go);
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") go();
      });
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
    for (const el of Array.from(
      body.querySelectorAll(
        ".lingxi-results, .lingxi-count, .lingxi-section-status, .lingxi-source-chips, .lingxi-draft-edit, .lingxi-draft-meta, .lingxi-gap-context",
      ),
    )) {
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

  /** 弹多选窗 → 取选中笔记文本 */
  private pickNotes(): Promise<TFile[]> {
    return new Promise((resolve) => {
      const files = this.plugin.app.vault.getMarkdownFiles();
      new MultiFileModal(
        this.plugin.app,
        files,
        {
          title: this.t("integrate.picker.title"),
          search: this.t("picker.search"),
          cancel: this.t("picker.cancel"),
          confirm: this.t("picker.confirm"),
          selected: (n) => this.t("integrate.picker.selected", { n, max: MAX_PICK }),
          selectAll: this.t("integrate.picker.selectAll"),
          clear: this.t("integrate.picker.clear"),
          min: 2,
          minText: this.t("integrate.picker.min"),
          max: MAX_PICK,
        },
        (picked) => {
          resolve(picked.slice(0, MAX_PICK));
        },
      ).open();
    });
  }

  private async noteInputs(files: TFile[]): Promise<Array<{ path: string; text: string }>> {
    const out: Array<{ path: string; text: string }> = [];
    for (const f of files) {
      out.push({ path: f.path, text: await this.plugin.app.vault.cachedRead(f) });
    }
    return out;
  }

  private renderSources(body: HTMLElement, paths: string[]): void {
    const box = body.createDiv({ cls: "lingxi-source-chips" });
    box.createSpan({ cls: "lingxi-source-label", text: this.t("integrate.compare.sources") });
    for (const path of paths) {
      const chip = box.createEl("button", { cls: "lingxi-source-chip", text: path });
      chip.addEventListener("click", () => this.openPath(path));
    }
  }

  /* ---------- 多篇对比 ---------- */

  private async runCompare(body: HTMLElement): Promise<void> {
    const picked = await this.pickNotes();
    if (picked.length < 2) {
      new Notice(this.t("integrate.compare.needTwo"));
      return;
    }
    const paths = picked.map((f) => f.path);
    this.clearResults(body);
    this.renderSources(body, paths);
    this.setBusy(body, true, this.t("organize.busy"));
    try {
      const outcome = await runCompareDetailed(
        this.plugin.transport,
        this.insightCfg(),
        await this.noteInputs(picked),
      );
      this.clearBusy(body);
      this.renderCompareResult(body, outcome.result, paths, outcome.raw);
    } catch (err) {
      this.clearBusy(body);
      new Notice(`${this.t("chat.failed")}: ${errMsg(err)}`);
    } finally {
      this.setBusy(body, false);
    }
  }

  private renderCompareResult(body: HTMLElement, result: CompareResult, paths: string[], raw: string): void {
    const total = result.consensus.length + result.divergence.length + result.complementary.length;
    if (total === 0) {
      if (raw !== "") {
        this.renderRawFallback(body, raw, paths, "compare");
      } else {
        body.createDiv({ cls: "lingxi-section-status", text: this.t("integrate.empty") });
      }
      return;
    }
    const box = body.createDiv({ cls: "lingxi-results" });
    this.renderList(box, this.t("integrate.compare.consensus"), result.consensus);
    this.renderList(box, this.t("integrate.compare.divergence"), result.divergence);
    this.renderList(box, this.t("integrate.compare.complementary"), result.complementary);
    const actions = box.createDiv({ cls: "lingxi-result-actions" });
    this.actionButton(actions, this.t("integrate.compare.copy"), "copy", () =>
      void copyText(this.compareToMarkdown(result, paths), this.plugin),
    );
    this.saveNoteButton(
      actions,
      () => this.compareToMarkdown(result, paths),
      this.t("integrate.compare.save"),
      paths,
      "compare",
    );
  }

  /** 模型没有按 JSON 输出时，至少把原文展示/保存下来，而不是只给一句空结果 */
  private renderRawFallback(body: HTMLElement, raw: string, paths: string[], prefix: string): void {
    const box = body.createDiv({ cls: "lingxi-results" });
    box.createDiv({ cls: "lingxi-result-heading", text: this.t("integrate.raw") });
    const pre = box.createEl("pre", { cls: "lingxi-raw" });
    pre.setText(raw);
    const actions = box.createDiv({ cls: "lingxi-result-actions" });
    this.actionButton(actions, this.t("common.copy"), "copy", () => void copyText(raw, this.plugin));
    this.saveNoteButton(actions, () => raw, this.t("integrate.compare.save"), paths, prefix);
  }

  private renderList(box: HTMLElement, title: string, items: string[]): void {
    if (items.length === 0) return;
    box.createDiv({ cls: "lingxi-result-heading", text: title });
    const ul = box.createEl("ul", { cls: "lingxi-result-list" });
    for (const item of items) ul.createEl("li", { text: item });
  }

  private compareToMarkdown(result: CompareResult, paths: string[]): string {
    const zh = this.plugin.i18n.current === "zh";
    const lines: string[] = [`# ${zh ? "多篇对比" : "Note comparison"}`, ""];
    const sections: Array<[string, string[]]> = [
      [zh ? "共识" : "Consensus", result.consensus],
      [zh ? "分歧" : "Divergence", result.divergence],
      [zh ? "互补" : "Complementary", result.complementary],
    ];
    for (const [title, items] of sections) {
      lines.push(`## ${title}`);
      if (items.length === 0) lines.push("-");
      else lines.push(...items.map((s) => `- ${s}`));
      lines.push("");
    }
    this.appendSources(lines, paths);
    return lines.join("\n").trim();
  }

  /* ---------- 主题合并 ---------- */

  private async runMerge(body: HTMLElement, topic: string | undefined): Promise<void> {
    const picked = await this.pickNotes();
    if (picked.length < 2) {
      new Notice(this.t("integrate.compare.needTwo"));
      return;
    }
    const paths = picked.map((f) => f.path);
    this.clearResults(body);
    this.renderSources(body, paths);
    this.setBusy(body, true, this.t("organize.busy"));
    try {
      const draft = await runMerge(this.plugin.transport, this.insightCfg(), await this.noteInputs(picked), topic);
      this.clearBusy(body);
      this.clearResults(body);
      this.renderSources(body, paths);
      if (draft === "") {
        body.createDiv({ cls: "lingxi-section-status", text: this.t("integrate.empty") });
        return;
      }
      const box = body.createDiv({ cls: "lingxi-results" });
      box.createDiv({ cls: "lingxi-result-heading", text: this.t("integrate.merge") });
      const area = box.createEl("textarea", { cls: "lingxi-draft-edit" });
      area.value = draft;
      area.rows = 14;
      box.createDiv({ cls: "lingxi-draft-meta", text: this.t("integrate.merge.edit") });
      const actions = box.createDiv({ cls: "lingxi-result-actions" });
      this.actionButton(actions, this.t("integrate.merge.copy"), "copy", () =>
        void copyText(area.value, this.plugin),
      );
      this.saveNoteButton(actions, () => area.value, this.t("integrate.merge.create"), paths, "merge");
    } catch (err) {
      this.clearBusy(body);
      new Notice(`${this.t("chat.failed")}: ${errMsg(err)}`);
    } finally {
      this.setBusy(body, false);
    }
  }

  /* ---------- 知识缺口 ---------- */

  private async runGaps(body: HTMLElement, rawQuestion: string): Promise<void> {
    const question = rawQuestion.trim();
    if (question === "") {
      new Notice(this.t("err.emptyQuestion"));
      return;
    }
    const indexer = this.plugin.indexer;
    const hasIndex = Boolean(indexer && indexer.stats().vectors > 0);
    this.clearResults(body);
    this.setBusy(body, true, this.t("organize.busy"));
    try {
      let context = "";
      let citations = 0;
      if (indexer && hasIndex) {
        const retrieved = await indexer.retrieve(question);
        context = retrieved.context.prompt;
        citations = retrieved.context.citations.length;
      }
      body.createDiv({
        cls: "lingxi-gap-context",
        text: !hasIndex
          ? this.t("integrate.gaps.noContext")
          : citations > 0
            ? this.t("integrate.gaps.context", { n: citations })
            : this.t("integrate.gaps.contextEmpty"),
      });
      const outcome = await runGapsDetailed(this.plugin.transport, this.insightCfg(), question, context);
      this.clearBusy(body);
      this.renderGapsResult(body, outcome.result, question, outcome.raw);
    } catch (err) {
      this.clearBusy(body);
      new Notice(`${this.t("chat.failed")}: ${errMsg(err)}`);
    } finally {
      this.setBusy(body, false);
    }
  }

  private renderGapsResult(body: HTMLElement, result: GapResult, question: string, raw: string): void {
    const total = result.gaps.length + result.nextSteps.length;
    if (total === 0) {
      if (raw !== "") {
        this.renderRawFallback(body, raw, [], "gaps");
      } else {
        const box = body.createDiv({ cls: "lingxi-results" });
        box.createDiv({ cls: "lingxi-section-status", text: this.t("integrate.empty") });
      }
      return;
    }
    const box = body.createDiv({ cls: "lingxi-results" });
    this.renderList(box, this.t("integrate.gaps.gaps"), result.gaps);
    this.renderList(box, this.t("integrate.gaps.nextSteps"), result.nextSteps);
    const actions = box.createDiv({ cls: "lingxi-result-actions" });
    this.actionButton(actions, this.t("common.copy"), "copy", () =>
      void copyText(this.gapsToMarkdown(result, question), this.plugin),
    );
    this.saveNoteButton(actions, () => this.gapsToMarkdown(result, question), this.t("integrate.compare.save"), [], "gaps");
  }

  private gapsToMarkdown(result: GapResult, question: string): string {
    const zh = this.plugin.i18n.current === "zh";
    const lines: string[] = [`# ${zh ? "知识缺口" : "Knowledge gaps"}`, "", `> ${question}`, ""];
    this.appendListSection(lines, zh ? "缺口" : "Gaps", result.gaps);
    this.appendListSection(lines, zh ? "下一步" : "Next steps", result.nextSteps);
    return lines.join("\n").trim();
  }

  /* ---------- 保存 ---------- */

  private saveNoteButton(
    box: HTMLElement,
    build: () => string,
    label: string,
    sources: string[],
    prefix: string,
  ): void {
    const btn = box.createEl("button", { cls: "lingxi-mini-btn mod-cta", text: label });
    btn.addEventListener("click", () => {
      void (async () => {
        try {
          const content = build().trim();
          if (content === "") {
            new Notice(this.t("integrate.empty"));
            return;
          }
          const now = new Date();
          const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
          let path = `xi-${prefix}-${stamp}.md`;
          let n = 1;
          while (await this.plugin.app.vault.adapter.exists(path)) {
            path = `xi-${prefix}-${stamp}-${n++}.md`;
          }
          await this.plugin.app.vault.create(path, `${this.frontmatter(sources)}${content}\n`);
          await this.plugin.app.workspace.openLinkText(path.replace(/\.md$/, ""), "", false);
          new Notice(this.t("integrate.created"));
          btn.disabled = true;
        } catch (err) {
          new Notice(`${this.t("chat.failed")}: ${errMsg(err)}`);
        }
      })();
    });
  }

  private frontmatter(sources: string[]): string {
    const lines = ["---", `created: ${new Date().toISOString()}`];
    if (sources.length > 0) {
      lines.push("source:");
      for (const source of sources) {
        lines.push(`  - ${JSON.stringify(`[[${source.replace(/\.md$/, "")}]]`)}`);
      }
    }
    lines.push("---", "", "");
    return lines.join("\n");
  }

  private appendSources(lines: string[], paths: string[]): void {
    if (paths.length === 0) return;
    const zh = this.plugin.i18n.current === "zh";
    lines.push("", `## ${zh ? "来源" : "Sources"}`);
    for (const path of paths) lines.push(`- [[${path.replace(/\.md$/, "")}]]`);
  }

  private appendListSection(lines: string[], title: string, items: string[]): void {
    lines.push(`## ${title}`);
    if (items.length === 0) lines.push("-");
    else for (const item of items) lines.push(`- ${item}`);
    lines.push("");
  }

  private openPath(path: string): void {
    void this.plugin.app.workspace.openLinkText(path.replace(/\.md$/, ""), "", false);
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
