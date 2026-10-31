/**
 * 希XI — 多选笔记弹窗（整合功能用）
 * 为什么自己写：Obsidian 官方 FuzzySuggestModal 只能单选。
 * 大库保护：过滤后只渲染前 200 行，选过的集合独立于过滤。
 *
 * 0.6.0：显示已选数量、全选当前结果、清空，并在不足下限时禁用确定。
 */

import { App, Modal, Setting, TFile } from "obsidian";

export interface MultiFileModalLabels {
  title: string;
  search: string;
  cancel: string;
  confirm: string;
  selected: (count: number) => string;
  selectAll: string;
  clear: string;
  /** 最少选择数量；不足时禁用「确定」 */
  min: number;
  /** 不足下限时的提示 */
  minText: string;
  /** 最多选择数量 */
  max: number;
}

export class MultiFileModal extends Modal {
  private chosen = new Set<string>();
  private filtered: TFile[];
  private countEl: HTMLElement | null = null;
  private okButton: HTMLButtonElement | null = null;

  constructor(
    app: App,
    private files: TFile[],
    private labels: MultiFileModalLabels,
    private done: (files: TFile[]) => void,
  ) {
    super(app);
    this.filtered = files;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lingxi-modal");
    contentEl.createEl("h3", { text: this.labels.title });

    let query = "";
    let updateCount = () => {};
    const listEl = contentEl.createDiv({ cls: "lingxi-picker-list" });

    const renderList = () => {
      listEl.empty();
      const q = query.trim().toLowerCase();
      this.filtered = q
        ? this.files.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 200)
        : this.files.slice(0, 200);
      if (this.filtered.length === 0) {
        listEl.createDiv({ cls: "lingxi-picker-empty", text: this.labels.search });
        return;
      }
      for (const file of this.filtered) {
        const row = listEl.createEl("label", { cls: "lingxi-picker-row" });
        const cb = row.createEl("input", { attr: { type: "checkbox" } });
        cb.checked = this.chosen.has(file.path);
        cb.disabled = !cb.checked && this.chosen.size >= this.labels.max;
        cb.addEventListener("change", () => {
          if (cb.checked) this.chosen.add(file.path);
          else this.chosen.delete(file.path);
          updateCount();
        });
        row.createSpan({ text: file.path });
      }
    };

    new Setting(contentEl).addSearch((s) => {
      s.setPlaceholder(this.labels.search).onChange((v) => {
        query = v;
        renderList();
      });
    });

    const toolbar = contentEl.createDiv({ cls: "lingxi-picker-toolbar" });
    const selectAll = toolbar.createEl("button", { text: this.labels.selectAll });
    selectAll.addEventListener("click", () => {
      for (const file of this.filtered) {
        if (this.chosen.size >= this.labels.max) break;
        this.chosen.add(file.path);
      }
      renderList();
      updateCount();
    });
    const clear = toolbar.createEl("button", { text: this.labels.clear });
    clear.addEventListener("click", () => {
      this.chosen.clear();
      renderList();
      updateCount();
    });

    renderList();

    this.countEl = contentEl.createDiv({ cls: "lingxi-picker-count" });
    const btns = contentEl.createDiv({ cls: "lingxi-modal-btns" });
    const cancel = btns.createEl("button", { text: this.labels.cancel });
    cancel.addEventListener("click", () => {
      this.chosen.clear();
      this.close();
    });
    const ok = btns.createEl("button", { cls: "mod-cta", text: this.labels.confirm });
    this.okButton = ok;
    ok.addEventListener("click", () => this.close());

    updateCount = () => {
      const n = this.chosen.size;
      if (this.countEl) {
        const suffix = n < this.labels.min ? ` · ${this.labels.minText}` : "";
        this.countEl.setText(`${this.labels.selected(n)}${suffix}`);
      }
      if (this.okButton) {
        this.okButton.disabled = n < this.labels.min;
      }
    };
    updateCount();
  }

  onClose(): void {
    const picked = this.files.filter((f) => this.chosen.has(f.path));
    this.done(picked);
    this.contentEl.empty();
  }
}
