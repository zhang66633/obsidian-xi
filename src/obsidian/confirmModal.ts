/**
 * 希XI — 通用确认弹窗（删除会话等破坏性操作用）
 * 不用 window.confirm：Electron 里样式不可控，且无法双语。
 */

import { App, Modal } from "obsidian";

export interface ConfirmModalOptions {
  title: string;
  body: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
}

export class ConfirmModal extends Modal {
  private confirmed = false;

  constructor(
    app: App,
    private options: ConfirmModalOptions,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lingxi-modal");
    contentEl.createEl("h3", { text: this.options.title });
    contentEl.createEl("p", { cls: "lingxi-modal-body", text: this.options.body });

    const btns = contentEl.createDiv({ cls: "lingxi-modal-btns" });
    const cancel = btns.createEl("button", { text: this.options.cancelText });
    cancel.addEventListener("click", () => this.close());
    const ok = btns.createEl("button", { cls: "mod-warning", text: this.options.confirmText });
    ok.addEventListener("click", () => {
      this.confirmed = true;
      this.close();
    });
    window.setTimeout(() => ok.focus(), 50);
  }

  onClose(): void {
    this.contentEl.empty();
    if (this.confirmed) this.options.onConfirm();
  }
}
