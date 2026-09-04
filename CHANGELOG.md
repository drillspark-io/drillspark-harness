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
  private information). The shipped-file check now covers 37 files.
- `scripts/process-coverage.js` — counts, from a `get_project` response, which first-level
  stages have a second-level (task) diagram. In a real run the model drew one of seven stages and
  moved on to the success criterion; stage 3-2 of `process-improve` now loops over every stage
  and must get exit 0 from this script before stage 4. Two checks in `tests/run.sh`.
- Stage 4-3 no longer asks the user to pick from a list of proposals. It draws the **proposed flow
  as a new DrillSpark project** (`<部門> / <業務>（改善後）`: the ECRS proposals applied to the
  approved as-is diagram — a complete copy, first and second level for every stage, with the
  proposals applied where they land; AI-delegated stages and tasks in an "AI" lane; coverage
  checked with `process-coverage.js` like the as-is diagram), prints the change list and both
  links in the CLI so the user compares as-is and to-be, and revises the to-be diagram on
  objections. The as-is diagram is left untouched; both URLs go in 図の在りか (`現状 ／ 改善後: URL`).
  The hand-over prints the success criterion, both links with the adopted changes, the
  request-sheet summary and any holds in the CLI instead of pointing at files. The criteria file's
  "one diagram, not two" line now reads: grow one as-is diagram, then compare it with a separate
  to-be project.
- `harness-implement` starts from `業務改善/AI化依頼書.md` when it exists: purpose, success
  criterion, exclusions and the candidate processes (one per business in the request sheet — its
  rows are that process's stages, with their H-level and approvals) come from the process-improve
  outputs and are not asked again; the to-be diagram is the draft for the process diagram. `process-improve` ends by handing over
  the exact line to paste into a new session. The purpose stage asks only what fills its four
  fields; judgment criteria, procedures, tools and data shapes belong to later stages and are
  never offered as a "decide it now" option. Before the purpose questions, a one-round
  read-through sorts the request sheet's open points into "ask at that stage's diagram", "ask a
  human at run time" or "outside this harness"; the three-round limit applies per stop, not to
  the whole run.
- **Diagrams are shown with `show_project`, once per confirmation.** In Claude Desktop the DrillSpark
  connector renders one diagram widget per tool result; with one `update_diagram` per stage, a run
  filled the conversation with 15–20 widgets of the same project. DrillSpark now returns text only
  from `update_diagram` and shows a widget only from `create_project` and the new `show_project`
  (`project_id`, optional `diagram_key` to open a tab). `process-improve` stage 3-2 calls it once per
  stage with that stage's key, `harness-implement` once before each approval gate,
  `harness-improve` once before the two-level discussion; never after a save, a lint fix or a
  read-back. The to-be project in stage 4-3 is created in one `create_project` call with
  `sub_diagrams` (every diagram linted first) instead of one `update_diagram` per stage. The three
  writing skills list `show_project` under both server prefixes; `tests/run.sh` checks that every
  skill whose text calls it also allows it.
- **`update_diagram` guard covers harness projects, and its message says where each skill records
  its own.** In a full run, `harness-implement` created the process diagram as a new project, the
  guard stopped the first `update_diagram` ("not in 業務一覧.md"), and the model followed the
  message literally: it wrote the harness project's URL into the inventory's 図の在りか column as
  `改善後:` — the slot that means "this business's to-be diagram". The guard now also accepts any
  project id found in a `.md` under `docs/harness/` (`処理/<名>/図.md`, `改善/<日付>.md`), enforces
  whenever either `業務改善/業務一覧.md` or `docs/harness/` exists, and its message lists the three
  places by skill. `harness-implement` writes 図.md with the URL right after `create_project`;
  `harness-improve` writes 改善/<日付>.md the same way.
- **Script writes into `業務改善/` are stopped.** The same edit above was made with a
  `python - <<'PY'` heredoc, which the Bash guard did not see, so the table lint never ran.
  `process-write-guard` now stops python / perl / ruby / php, `node -e`, and PowerShell
  `Set-Content` / `Out-File` / `Add-Content` commands that name a path under `業務改善/`
  (`node <file>` — the way the lints are run — passes). Five guard checks.
- `scripts/harness-freeze-guard.js` — a third PreToolUse guard. A `docs/harness/**/合格条件.md`
  that contains 「凍結」 is frozen: a Write / Edit that changes or removes a numbered table row
  (成果物・合格条件・介入点) is refused, adding rows requires raising 「第N版」, dropping the word
  is refused, and Bash redirects / `sed -i` into the file are refused. Changing a condition means
  keeping the old row and adding a superseding one. In the same run the evaluator's report led to
  an ad-hoc second version of the frozen file, which the skill text alone could not prevent.
  Twelve guard checks plus the bad-input set; the hook wiring check counts seven commands.
- `harness-evaluator` no longer probes hook registration with its own Bash. Its live check had
  been `echo "npx wrangler pages deploy …"` — a string, not a command, which no guard matches —
  and the pass-through was reported as a P0 "hook not registered". Registration is judged from
  `settings.json` and whether the session was restarted; if either cannot be confirmed it is
  written as unverified, not as a failure.
- `harness-implement` says real files are written with `Write`: a Bash heredoc collapses `\` and
  broke a hook script's regular expressions in the run.
- `process-expert` searches the web only when it lacks knowledge of the work (the design
  diagram's "知識があるか？" branch); the earlier "always search once" rule is withdrawn.
- Stage 3-2 is paced per stage: draw one stage's tasks, show only that stage's tasks (5–10
  lines with their 一般例／未確認 marks), ask, then move to the next. Drawing every stage first and
  presenting 35 lines at the end was more than a person can review; the task-confirmation stop is
  that per-stage question, and the end of stage 3 is a one-line close with the diagram link.
- `業務改善/進行.md` — a resume ledger. `process-improve` appends one line each time one of its
  three stops is passed (which stop, when, the user's own words), and reads it first when invoked
  again so it can continue after context compaction or on another day without re-asking. It is
  deliberately unguarded: a self-reported ledger cannot be verified by a hook, so the hard gates
  stay on facts a script can check (diagram coverage, table cross-references). One guard check
  pins that the ledger passes the write guard.
- Stage 2 of `process-improve` no longer claims four waste marks. With the two-stage inventory,
  only 「目的が薄い」 can fire at that point (the other three come from the `作業` column, which is
  still `後で聞く`); the text now says so, asks the user once whether any task feels heavy on
  copying or waiting, and re-runs `process-abc` after the chosen tasks' details are filled so the
  remaining marks reach stage 4 with their source words.
- `process-expert` now has a section for the stage-proposal role: what a stage is versus a task
  (a chapter of the work versus one sitting; 5–10 stages, at least two tasks each, first stage
  receives the trigger, last hands over), and it must return a stage → task assignment table
  rather than a list of stages — in a real run the user's fine-grained 作業 text was copied
  straight into the first level. Stage 3-1 asks for that table and 3-2 draws from it;
  `process-coverage` flags stages with a single task.

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
