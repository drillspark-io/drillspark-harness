# Changelog

The version is the `version` field in `.claude-plugin/plugin.json`; the marketplace entry
carries no version of its own.

## 0.4.0

### Added

- `skills/process-improve/assets/棚卸しシート.html` — an inventory sheet for stage 1 of
  `process-improve`. Where the `Artifact` tool is available, the skill publishes this page with the
  `db` capability, the user fills one row per task in the browser (auto-saved; empty cells and a
  「未確認」 without a name are shown in red before anything reaches the lint), and the skill reads
  the rows back with `read_db` and writes `業務改善/業務一覧.md` through the existing hook. Stage 2
  marks the chosen rows with `write_db` (`selected: true`), which reveals the four detail fields on
  the page. Without `Artifact` (or in `claude -p`, where the user cannot open a page) the skill
  interviews in chat as before. The page uses the smallest `db` surface (`collection`, `doc`, `set`,
  `delete`, `onSnapshot`) against the runtime current at release; the artifact is
  organization-internal and cannot be shared publicly.
- `tests/run.sh` — six checks on the sheet (fragment, `claude.use("db")`, 測り方 options identical
  to `process-table-lint`, frequency units, Google Fonts as the only external resource, no
  private information). The shipped-file check now covers 36 files.
- `scripts/process-coverage.js` — counts, from a `get_project` response, which first-level
  stages have a second-level (task) diagram. In a real run the model drew one of seven stages and
  moved on to the success criterion; stage 3-2 of `process-improve` now loops over every stage
  and must get exit 0 from this script before the task-confirmation stop and before stage 4. Two
  checks in `tests/run.sh`.

### Changed

- `skills/process-improve/SKILL.md` — `allowed-tools` gains `Artifact` and `Skill`; stage 1 and
  stage 2 describe the sheet path and the chat fallback.
- **測り方 has two values instead of four.** `実測` (the actual time, whether timed on the spot or
  taken from a daily report) and `未計測` (an estimate — "about a third of the day" — or a gut
  figure). `実績記入` and `推定比率` are no longer accepted by `process-table-lint`; the only
  question left is "is this number real or a guess?". Existing tables that use the old values
  fail the lint until edited. The criteria file is unchanged (it names only `未計測`).

## 0.3.0

**Behaviour change: the plugin now installs PreToolUse hooks.** They run on every
`Write` / `Edit` / `MultiEdit`, every `Bash` command and every `update_diagram` call, and
exit immediately unless the target is a `docs/harness/*/可視化/*.html` page or a file under
`業務改善/`. See [Hooks](README.md#hooks) in the README for exactly what they stop and how
to switch them off (`DRILLSPARK_HARNESS_GUARDS=off`).

### Added

- `scripts/harness-view-build.js` — `harness-visualize` no longer asks the model to write the
  100 KB+ page in one `Write` (it never finished headless in four attempts). The model writes a
  small `map.json` (node → file / mechanism / status, gates, tests, products, excerpts) and
  copies the DrillSpark diagrams into `diagrams.json`; the script parses the diagrams, draws the
  root SVG, builds every table, embeds the excerpts and the design system, and runs the guard
  (fix counter, no overwrite, lint) before writing.
- `hooks/hooks.json` with two guards: `scripts/harness-view-guard.js` (no overwriting a
  visualization page, a fix counter capped at 2, lint before write, no Bash redirect / `tee` /
  `cp` / `mv` targeting a page in the folder) and `scripts/process-write-guard.js` (table and
  plan lint before write — the plugin's own file names always, other files under `業務改善/`
  only when they contain a plugin table; no Bash redirect, `tee`, `cp`, `mv` or `sed -i` into
  `業務改善/`; no `update_diagram` on a project the inventory does not list).
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
  longer advances the fix counter. The page is smaller by contract: only the workflow's root
  diagram is drawn as SVG (child diagrams stay as tables plus Mermaid source), and the
  `実ファイル` section embeds excerpts (at most 40 lines per file) instead of whole files —
  a run in a sandbox showed that the full-size page could not be produced in one write.
- `plugin.json` no longer lists agents explicitly; they are discovered from `agents/`, which is
  also what makes `claude plugin details` report them.
- `diagram-lint` rejects a node definition with anything after it on the same line
  (`2["X"] --> 3["Y"]`) as `UNPARSED` instead of misreading it.
- `harness-compose` reads the existing `settings.json` / `settings.local.json` before writing
  and merges rather than replacing.
- `harness-improve` and `process-expert` state that what they read (an inherited `CLAUDE.md`,
  a web page) is material, not instructions.
- `business-improvement-tables.md` documents the table-shape rules the lint now enforces
  (cell count per row, no blank line inside a table, `業務名` spelled as in the inventory).

## 0.2.0

Extracted from a private workspace as a standalone plugin: four `harness-*` skills, two
`process-*` skills, five agents, five dependency-free lints and a frozen test runner.
