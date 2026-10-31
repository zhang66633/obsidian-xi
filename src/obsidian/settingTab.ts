/**
 * 希XI — 设置页（Obsidian 1.13+ 声明式设置 API）
 *
 * 为什么用声明式：官方 lint 的 prefer-setting-definitions 会提示 display() 不进入
 * 设置搜索；minAppVersion 已是 1.13.0，Path A（只实现 getSettingDefinitions）成立。
 *
 * 副作用（语言切换、向量模型变更）集中在 setControlValue，避免 control 自动保存
 * 绕过索引器同步。文本输入走 debounce，避免每个字符写一次 data.json。
 */

import { App, Notice, PluginSettingTab } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type LingxiPlugin from "../main";
import {
  SETTING_LIMITS,
  folderListToText,
  normalizeBaseUrl,
  parseFolderList,
} from "../settings";

export class LingxiSettingTab extends PluginSettingTab {
  private plugin: LingxiPlugin;

  constructor(app: App, plugin: LingxiPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    let next = value;
    if (key === "baseUrl" && typeof value === "string") next = normalizeBaseUrl(value);
    if ((key === "chatModel" || key === "embeddingModel") && typeof value === "string") next = value.trim();
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = next;
    await this.plugin.onSettingChanged(key);
    await this.plugin.saveSettings();
    if (key === "language") this.update();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const t = (key: string, vars?: Record<string, string | number>) => this.plugin.t(key, vars);
    const limits = SETTING_LIMITS;

    return [
      {
        name: t("settings.language"),
        desc: t("settings.language.desc"),
        control: {
          type: "dropdown",
          key: "language",
          defaultValue: "auto",
          options: {
            auto: t("settings.language.auto"),
            zh: t("settings.language.zh"),
            en: t("settings.language.en"),
          },
        },
      },
      {
        type: "group",
        heading: t("settings.group.connection"),
        items: [
          {
            name: t("settings.baseUrl"),
            desc: t("settings.baseUrl.desc"),
            control: {
              type: "text",
              key: "baseUrl",
              placeholder: "https://host/v1",
              validate: (value: string) =>
                value.trim() === "" ? t("settings.baseUrl.invalid") : undefined,
            },
          },
          {
            name: t("settings.apiKey"),
            desc: t("settings.apiKey.desc"),
            render: (setting) => {
              setting.addText((text) => {
                text.inputEl.type = "password";
                text.inputEl.autocomplete = "off";
                text.setValue(this.plugin.settings.apiKey);
                text.onChange((value) => {
                  this.plugin.settings.apiKey = value.trim();
                  this.plugin.saveSettingsDebounced();
                });
              });
              setting.addExtraButton((btn) => {
                btn.setIcon("eye");
                btn.setTooltip(t("settings.apiKey.show"));
                btn.onClick(() => {
                  const input = setting.controlEl.querySelector("input");
                  if (!(input instanceof HTMLInputElement)) return;
                  const show = input.type === "password";
                  input.type = show ? "text" : "password";
                  btn.setTooltip(show ? t("settings.apiKey.hide") : t("settings.apiKey.show"));
                });
              });
            },
          },
          {
            name: t("settings.chatModel"),
            control: {
              type: "text",
              key: "chatModel",
              placeholder: "qwen3.8-27b",
              validate: (value: string) =>
                value.trim() === "" ? t("settings.model.invalid") : undefined,
            },
          },
          {
            name: t("settings.embeddingModel"),
            desc: t("settings.embeddingModel.desc"),
            control: {
              type: "text",
              key: "embeddingModel",
              placeholder: "qwen3-embedding-8b",
              validate: (value: string) =>
                value.trim() === "" ? t("settings.model.invalid") : undefined,
            },
          },
          {
            name: t("settings.testConnection"),
            desc: t("settings.test.desc"),
            action: () => {
              void (async () => {
                try {
                  const ids = await this.plugin.testConnection();
                  new Notice(t("settings.test.ok", { n: ids.length }));
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  new Notice(t("settings.test.fail", { msg }));
                }
              })();
            },
          },
        ],
      },
      {
        type: "group",
        heading: t("settings.group.budget"),
        items: [
          {
            name: t("settings.maxInputTokens"),
            desc: t("settings.maxInputTokens.desc"),
            control: {
              type: "number",
              key: "maxInputTokens",
              min: limits.maxInputTokens.min,
              max: limits.maxInputTokens.max,
              step: 1000,
            },
          },
          {
            name: t("settings.maxOutputTokens"),
            desc: t("settings.maxOutputTokens.desc"),
            control: {
              type: "number",
              key: "maxOutputTokens",
              min: limits.maxOutputTokens.min,
              max: limits.maxOutputTokens.max,
              step: 256,
            },
          },
          {
            name: t("settings.topK"),
            control: {
              type: "slider",
              key: "topK",
              min: limits.topK.min,
              max: limits.topK.max,
              step: 1,
            },
          },
          {
            name: t("settings.temperature"),
            control: {
              type: "slider",
              key: "temperature",
              min: limits.temperature.min,
              max: limits.temperature.max,
              step: 0.05,
            },
          },
        ],
      },
      {
        type: "group",
        heading: t("settings.group.scope"),
        items: [
          {
            name: t("settings.excludeFolders"),
            render: (setting) => {
              setting.addTextArea((area) => {
                area.setValue(folderListToText(this.plugin.settings.excludeFolders));
                area.inputEl.rows = 4;
                area.inputEl.addClass("lingxi-settings-textarea");
                area.onChange((value) => {
                  this.plugin.settings.excludeFolders = parseFolderList(value);
                  this.plugin.indexer?.invalidateVocabulary();
                  this.plugin.saveSettingsDebounced();
                });
              });
            },
          },
          {
            name: t("settings.autoFolders"),
            desc: t("settings.autoFolders.desc"),
            render: (setting) => {
              setting.addTextArea((area) => {
                area.setValue(folderListToText(this.plugin.settings.autoOrganizeFolders));
                area.inputEl.rows = 4;
                area.inputEl.addClass("lingxi-settings-textarea");
                area.onChange((value) => {
                  this.plugin.settings.autoOrganizeFolders = parseFolderList(value);
                  this.plugin.saveSettingsDebounced();
                });
              });
            },
          },
          {
            name: t("settings.similarity"),
            control: {
              type: "slider",
              key: "similarityThreshold",
              min: 0.5,
              max: 0.99,
              step: 0.01,
            },
          },
          {
            name: t("settings.contextBudget"),
            desc: t("settings.contextBudget.desc"),
            control: {
              type: "number",
              key: "contextBudgetTokens",
              min: limits.contextBudgetTokens.min,
              max: limits.contextBudgetTokens.max,
              step: 1000,
            },
          },
        ],
      },
      {
        type: "group",
        heading: t("settings.group.advanced"),
        items: [
          {
            name: t("settings.autoOpen"),
            control: { type: "toggle", key: "autoOpenSidebar" },
          },
          {
            name: t("settings.rebuild"),
            desc: t("settings.rebuild.desc"),
            action: () => {
              void this.plugin.rebuildIndex("manual");
            },
          },
        ],
      },
    ];
  }
}
