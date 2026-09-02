# Changelog

The version is the `version` field in `.claude-plugin/plugin.json`; the marketplace entry
carries no version of its own.

## 0.3.0

**Behaviour change: the plugin now installs PreToolUse hooks.** They run on every
`Write` / `Edit` / `MultiEdit`, every `Bash` command and every `update_diagram` call, and
exit immediately unless the target is a `docs/harness/**/可視化/*.html` page or a file under
`業務改善/`. See [Hooks](README.md#hooks) in the README for exactly what they stop and how
to switch them off (`DRILLSPARK_HARNESS_GUARDS=off`).

### Added

- `hooks/hooks.json` with two guards: `scripts/harness-view-guard.js` (no overwriting a
  visualization page, a fix counter capped at 2, lint before write, no Bash writes into the
  folder) and `scripts/process-write-guard.js` (table and plan lint before write; no Bash
  redirect, `tee`, `cp`, `mv` or `sed -i` into `業務改善/`; no `update_diagram` on a project
  the inventory does not list).
- `.claude-plugin/marketplace.json` — the repository is its own single-plugin marketplace, so
  `/plugin marketplace add jackasser/drillspark-harness` resolves.
- `scripts/process-abc.js` — ABC ranking and waste marks from `業務一覧.md`, deterministic;
  reads `/月`, `/週` and `/年` totals and converts to a month.
- `process-table-lint`: `ENUM_VALUE`, `NODE_REF`, `ESTIMATE_NOT_ALLOWED`, `GUESSED_IN_REQUEST`,
  `DETAIL_MISSING`, `ORPHAN_ROW`, `ROW_WIDTH`, `UNKNOWN_WORK`, `TIME_FORMAT`, and `--list`
  cross-checking against `業務一覧.md`.
- `harness-view-lint` / `process-plan-lint`: `EXTERNAL_REF` now checks every loading attribute
  (`srcset`, `poster`, `object data` …), `PRIVATE_INFO` catches the shapes of API keys and tokens.
- `tests/run.sh`: guard behaviour checks, hook wiring check, and `%% expect:` code/count
  matching for the diagram fixtures; fixtures for six diagram-lint codes that had none.
- `CHANGELOG.md`, GitHub Actions CI (`bash tests/run.sh` on Ubuntu and Windows).

### Changed

- Skills and agents pre-authorize both DrillSpark tool prefixes — `mcp__drillspark__*` for a
  server named `drillspark` and `mcp__claude_ai_DrillSpark__*` for the claude.ai connector.
  Under the connector name the reviewer and evaluator agents previously could not read a
  diagram at all, because an agent's `tools` list is an allowlist.
- `process-improve`: the inventory is taken in two passes, "don't know" is written as
  `未確認：◯◯さんに聞く`, 改善案 / AI化依頼書 carry a `業務名` column, unresolved points go to
  `業務改善/保留.md`, and the skill ends by telling the user where the files are and pointing at
  `process-improve-view`.
- `process-improve-reviewer` reads DrillSpark diagrams directly and runs on the session model
  (`inherit`) rather than a fixed smaller one; `process-expert` no longer has file-reading tools
  it never used.
- `harness-visualize` pages use a semantic design system (status glyphs, mechanism chips,
  solid = control / dotted = data, breadcrumb and depth badge). A write the guard stops no
  longer advances the fix counter.
- `plugin.json` no longer lists agents explicitly; they are discovered from `agents/`, which is
  also what makes `claude plugin details` report them.

## 0.2.0

Extracted from a private workspace as a standalone plugin: four `harness-*` skills, two
`process-*` skills, five agents, five dependency-free lints and a frozen test runner.
