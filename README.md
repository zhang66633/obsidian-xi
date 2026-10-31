# 希XI · Xi Qwen

**A bilingual (中文 / English) Qwen assistant that lives inside Obsidian — read, organize, and merge your notes without leaving the vault.**

> 双语 Qwen 笔记助手：用你自己的 OpenAI 兼容网关，理解、整理、整合知识库。
> 回答带引用角标，点击直达原文；除你点击确认的写入外，永不静默修改笔记。

[![Community plugin](https://img.shields.io/badge/Obsidian-community%20plugin-7c3aed)](https://community.obsidian.md/plugins/xi-qwen)
[![Release](https://img.shields.io/github/v/release/zhang66633/obsidian-xi?label=release)](https://github.com/zhang66633/obsidian-xi/releases)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

![Xi settings](images/docs-settings.png)

![Xi chat](images/docs-chat.png)

## What it does

One sidebar, three tabs:

| Tab | Tools | Writes to your notes? |
|---|---|---|
| **Chat** | Multi-session chat (new / switch / rename / delete, survives restarts); vault-wide Q&A with clickable `[1][2]` citation chips; ask about the current note or a selection; one-click note anatomy (summary / key concepts / open questions); Markdown answers with a copy button | No |
| **Organize** | Index health banner (sync/rebuild), related notes with heading + snippet + score, semantic search result cards, tag suggestions with current tags and batch apply, near-duplicate detection with open-both/copy actions | Tags only — automatically inside whitelisted folders, one click elsewhere |
| **Integrate** | Note picker with selected counter / select-all / clear, compare 2–10 notes (consensus / divergence / complementary), editable merge draft with per-point sources, knowledge-gap analysis with retrieved-context count, raw-model fallback when JSON parsing fails | Only when you click “create note” |

UI strings are fully bilingual — switch in the sidebar header or in settings (it can also follow your Obsidian locale).

## Requirements

- **Obsidian 1.13.0+** (desktop or mobile).
- Any **OpenAI-compatible** endpoint with a chat model **and** an embedding model.
  Defaults are pre-filled for a campus gateway (`qwen3.8-27b` chat + `qwen3-embedding-8b`
  embeddings); change the base URL, models, and key in settings. Ollama, LM Studio,
  vLLM, DashScope-compatible mode, one-api/new-api gateways all work.

## Install

**Community directory:** search for **Xi Qwen** in Settings → Community plugins, or open
[community.obsidian.md/plugins/xi-qwen](https://community.obsidian.md/plugins/xi-qwen).

**BRAT (beta):** paste `https://github.com/zhang66633/obsidian-xi` into the BRAT plugin.

**Manual:** copy `main.js`, `manifest.json`, and `styles.css` into
`<your vault>/.obsidian/plugins/xi-qwen/`, then enable the plugin in Settings → Community plugins.

## First run

1. Settings → **Xi Qwen** → paste your API key (stored locally in `data.json`), check the base URL, and click **Test connection**.
2. Command palette → **Rebuild Xi index** (one-time; afterwards it syncs incrementally as you edit).
3. Open the sidebar (ribbon icon) → set context to **Whole vault (RAG)** → ask away.

### Commands

| Command | What it does |
|---|---|
| **Open Xi sidebar** | Focus the chat panel |
| **Ask Xi about selection** | Explain the selected text in the context of the current note |
| **Xi: Understand current note** | Summary + key concepts + open questions for the active note |
| **Rebuild Xi index** | Full re-index (also fills missing embeddings) |

## Privacy and network use

- Notes are sent **only** to the endpoint you configure. There is no third-party service,
  no telemetry, no ads, and no account.
- The API key is stored locally in `.obsidian/plugins/xi-qwen/data.json`; it never leaves your
  machine except in requests to your endpoint.
- The embedding index and chat sessions are cached locally in the plugin folder
  (`cache.json`, `sessions.json`). Deleting them is safe; the index rebuilds.
- The plugin never edits notes silently. Outside whitelisted folders every tag change is a
  suggestion you apply yourself; comparison/merge notes are created only when you click the button.
- No files outside the vault are accessed.

## What's new in 0.6.0

- **Organize is no longer a row of bare buttons**: an index health banner shows notes/chunks/vectors
  with sync + rebuild actions; related notes and semantic search return cards with the best-matching
  snippet and heading; current tags are visible and can be applied in bulk.
- **Integrate got a real selection/result loop**: the picker shows how many notes you selected,
  supports select-all/clear and a 2-note minimum; results keep source chips; merge drafts are
  editable before saving; saved notes include `created` and `source` frontmatter.
- **Reasoning-model fix**: the model often prints a schema example before the real JSON. Extraction
  now returns the last valid object, so Compare / Gaps / Anatomy no longer come back empty; if a
  model still refuses to produce JSON, the raw output is shown and can be saved.
- 151 unit tests, lint clean, CI + tag-driven release with build provenance attestation.

## What changed in 0.5.0

- Incremental indexing (mtime check; manual rebuild still does a full read).
- Declarative settings (Obsidian 1.13), working language switching, clamped token budgets.
- Markdown answers with copy, selection Q&A, note anatomy, bilingual modals, delete confirmation.
- Request timeouts, embedding retries, partial-index persistence.

## Development

```bash
npm install
npm run dev        # esbuild watch → main.js
npm run build      # tsc --noEmit + production bundle
npm test           # vitest (core logic, HTTP mocked — no network needed)
npm run lint       # eslint-plugin-obsidianmd
npm run check      # lint + test + build
```

**Architecture**

```mermaid
flowchart LR
  subgraph Core["src/core — zero Obsidian imports"]
    IDX[NoteIndex<br/>chunk + mtime/hash]
    VS[VectorStore<br/>base64 Float32]
    RAG[RAG<br/>retrieve + citations]
    LLM[LLM client<br/>Transport injected]
    ANA[Anatomy / Insight<br/>prompts + parsers]
    SES[SessionStore<br/>serialized writes]
  end
  subgraph Obs["src/obsidian — glue"]
    VIEW[ChatView]
    SET[Settings tab]
    PORT[VaultPort]
    GW[requestUrl transport]
  end
  PORT --> IDX
  IDX --> VS
  IDX --> RAG
  LLM --> GW
  VIEW --> IDX
  VIEW --> SES
  VIEW --> ANA
  SET --> LLM
```

`src/core/` is pure TypeScript: indexing, vector math, RAG, prompt builders/parsers, and the
LLM client with an injected transport. `src/obsidian/` holds views, ports, and settings, so core
logic runs in plain Node and is unit-tested without Obsidian.

**Releasing:** bump all three version files with
`npm version 0.5.1 --no-git-tag-version`, commit, then push a tag equal to
`manifest.json.version`. `.github/workflows/release.yml` runs the checks, generates a build
provenance attestation, and creates a draft GitHub release with `main.js`, `manifest.json`,
and `styles.css`.

Development notes (plan / decisions / pitfalls / test log) live in [`docs/`](docs/README.md).

## License

MIT © Zhe

---

## 中文说明

**希XI** 是一个住在 Obsidian 侧边栏里的双语 Qwen 助手，三个标签页：

- **对话**：多会话管理（新建/切换/重命名/删除，重启后恢复，每个会话记住自己的上下文范围）；
  全库问答带可点击的 `[1][2]` 引用角标；也可以问当前笔记、解释选中文字，
  或一键做「笔记解剖」（摘要 / 关键概念 / 待解问题）。回答按 Markdown 渲染，可一键复制。
- **整理**：顶部显示索引健康度（篇/块/向量，可同步或重建）；相关笔记与语义搜索返回带
  标题、摘要和分数的卡片；标签建议显示当前标签并支持批量应用；近似重复对可一键打开两篇/
  复制路径。
- **整合**：选择器显示已选数量，支持全选/清空与至少 2 篇限制；对比/合并/缺口结果常驻
  来源 chips；合并草稿可直接编辑后再创建笔记（自动写 `created` + `source` frontmatter）；
  模型不按 JSON 输出时展示原文并可保存。

**隐私与联网**：笔记只会发送到你亲自配置的接口；无遥测、无账号、无广告。
API Key 保存在本机插件目录的 `data.json`，索引与会话缓存在同目录，删掉可重建。
白名单外的任何改动都只是建议，点一下才写入；对比/合并笔记只有点「创建」才会落盘。

**安装**：社区目录搜索 **Xi Qwen**；或把 `main.js` / `manifest.json` / `styles.css`
拷进 `<你的库>/.obsidian/plugins/xi-qwen/` 后启用。

**要求**：Obsidian 1.13.0+；任意 OpenAI 兼容端点（需同时提供对话模型与向量模型）。

**开发**：核心逻辑（`src/core/`）零 Obsidian 依赖，可在 Node 下单测；开发文档见 `docs/`。
