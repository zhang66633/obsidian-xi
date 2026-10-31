# Changelog

All notable changes to Xi Qwen are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/).

## [0.5.0] — 2026-10-31

### Added

- **Ask Xi about selection** command: explains the current selection in the context of the note.
- **Note anatomy** command: summary, key concepts, and open questions for the active note.
- Markdown rendering for assistant answers, with a copy button.
- Declarative settings API (Obsidian 1.13+): settings are now searchable from the global settings search.
- Embedding request retries on 429/5xx/network errors, with exponential backoff.
- Request timeouts for chat, embeddings, and connection tests.
- Visible “context budget” trimming feedback when older chat messages are dropped.
- Delete-session confirmation and fully bilingual modals.

### Changed

- Incremental indexing: files whose `mtime` did not change are no longer re-read on every
  vault event; full re-reads are limited to manual rebuilds.
- Tag vocabulary is cached per sync cycle instead of re-reading the whole vault on every suggestion.
- Duplicate detection precomputes vector norms and avoids repeated square roots.
- Session writes are serialized so a slow older snapshot cannot overwrite a newer one.
- Settings writes are debounced (500 ms) for text fields.
- `maxInputTokens` is now actually enforced when assembling chat history.
- Numeric settings are clamped on load (`maxOutputTokens` 90000 → 65536, etc.).
- Base URLs without a scheme get `https://`; folder paths are normalized.
- Settings tab migrated from `display()` to `getSettingDefinitions()`.

### Fixed

- Changing the interface language in settings did not re-render the UI or update retrieval prompts.
- Changing the embedding model at runtime left stale vectors under the new model.
- Deleting a session happened immediately, without confirmation.
- Hard-coded Chinese labels in the note picker and rename modals.
- Floating promise in note creation from the Integrate tab.
- Empty/whitespace model names could be saved from settings.

### Internal

- Version bump script now updates `package.json`, `manifest.json`, and `versions.json` together.
- Added GitHub Actions CI and a tag-driven release workflow with build provenance attestation.
- Added 27 unit tests (114 → 141) covering chat budgets, anatomy parsing, incremental sync,
  retry/persist-on-failure, serialized session writes, and duplicate-detection regressions.

## [0.4.2] — 2026-10-06

- Community-review fixes: settings headings, `createEl` usage, `configDir` paths,
  console logging, and floating promises. No functional changes.

## [0.4.1] — 2026-10-06

- Directory-compliant ASCII display name (`Xi Qwen`).

## [0.4.0] — 2026-10-06

- Renamed from 灵犀 Lingxi to 希XI / Xi Qwen (`id: xi-qwen`).
- Multi-session chat with persistence.

## [0.3.0] — 2026-10-06

- Organize and Integrate tabs, bilingual UI, RAG citations.

## [0.2.0] — 2026-10-06

- Initial chat / organize / integrate feature set.

[0.5.0]: https://github.com/zhang66633/obsidian-xi/releases/tag/0.5.0
[0.4.2]: https://github.com/zhang66633/obsidian-xi/releases/tag/0.4.2
[0.4.1]: https://github.com/zhang66633/obsidian-xi/releases/tag/0.4.1
[0.4.0]: https://github.com/zhang66633/obsidian-xi/releases/tag/0.4.0
[0.3.0]: https://github.com/zhang66633/obsidian-xi/releases/tag/0.3.0
[0.2.0]: https://github.com/zhang66633/obsidian-xi/releases/tag/0.2.0
