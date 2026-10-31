/**
 * 希XI — 整理/整合面板共用的轻量组件
 *
 * 只做三件事：索引状态横幅、复制、分数格式化。
 * 面板本身保持无状态；重建索引后通过 onChange 让调用方重绘。
 */

import { Notice, setIcon } from "obsidian";
import type LingxiPlugin from "../main";

export function formatScore(score: number): string {
  return score.toFixed(2);
}

export function renderIndexBanner(
  parent: HTMLElement,
  plugin: LingxiPlugin,
  onChange: () => void,
): void {
  const box = parent.createDiv({ cls: "lingxi-index-banner" });
  const stats = plugin.indexer?.stats();
  if (!stats) {
    box.addClass("is-warning");
    box.createDiv({ cls: "lingxi-index-text", text: plugin.t("organize.index.empty") });
    return;
  }

  const empty = stats.vectors === 0;
  if (empty) box.addClass("is-warning");
  const row = box.createDiv({ cls: "lingxi-index-row" });
  const text = row.createDiv({ cls: "lingxi-index-text" });
  text.setText(
    empty
      ? plugin.t("organize.index.empty")
      : plugin.t("organize.index.stats", {
          files: stats.files,
          chunks: stats.chunks,
          vectors: stats.vectors,
        }),
  );
  if (!empty && stats.vectors < stats.chunks) {
    text.createDiv({
      cls: "lingxi-index-partial",
      text: plugin.t("organize.index.partial", { n: stats.chunks - stats.vectors }),
    });
  }

  const actions = row.createDiv({ cls: "lingxi-index-actions" });
  const refresh = () => {
    if (parent.isConnected) onChange();
  };
  const sync = actions.createEl("button", { cls: "lingxi-mini-btn" });
  setIcon(sync, "refresh-cw");
  sync.createSpan({ text: plugin.t("organize.index.sync") });
  sync.addEventListener("click", () => {
    sync.disabled = true;
    void plugin.rebuildIndex("event").then(refresh);
  });
  const rebuild = actions.createEl("button", { cls: "lingxi-mini-btn" });
  setIcon(rebuild, "database");
  rebuild.createSpan({ text: plugin.t("organize.index.rebuild") });
  rebuild.addEventListener("click", () => {
    rebuild.disabled = true;
    void plugin.rebuildIndex("manual").then(refresh);
  });

  if (plugin.indexingActive && plugin.indexStatus !== "") {
    box.createDiv({ cls: "lingxi-index-status", text: plugin.indexStatus });
  }
}

export async function copyText(text: string, plugin: LingxiPlugin): Promise<void> {
  try {
    await window.navigator.clipboard.writeText(text);
    new Notice(plugin.t("common.copied"));
  } catch (err) {
    new Notice(`${plugin.t("chat.failed")}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
