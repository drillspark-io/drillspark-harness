# DrillSpark Harness

Turn a [DrillSpark](https://drillspark.io/) BPMN diagram into real Claude Code
configuration — skills, agents, hooks, permissions and pass conditions — and then
verify it with reviewers that are separated from the side that generated it.

> **Skill content is written in Japanese.** The manifest, this README and the
> cutover notes are in English; the skill and agent bodies are not translated.
> See [Language](#language).

## Why

An agent is `model + harness`. Most harness work is undone by the next model release,
so the useful parts are the ones a model cannot do alone. This plugin encodes two of them:

- **A diagram is a contract.** Structure — who does what, in what order, where a human
  stops the run — is decided on the diagram, not improvised in a chat.
- **The generating side cannot grade itself.** Review and evaluation run as separate
  agents against a criteria file that ships inside the plugin, outside the repository
  being worked on, so the generated harness cannot edit its own pass line
  (*verifier-deployment gap*).

## Requirements

| | |
|---|---|
| Claude Code | `2.1.233` or later (`claude plugin validate --strict`, which the pass criteria require; skill bodies also use `${CLAUDE_PLUGIN_ROOT}`, 2.1.196+) |
| Node.js | 14 or later, **on `PATH` in every session** — the plugin's PreToolUse hooks start `node` on each `Write` / `Edit` / `Bash` call (see [Hooks](#hooks)). The scripts have no dependencies. Without `node` the guards silently do nothing |
| DrillSpark account | required — see [Connecting DrillSpark](#connecting-drillspark) |
| DrillSpark MCP server | connected — as a server named `drillspark` (`mcp__drillspark__*`) or as the claude.ai connector (`mcp__claude_ai_DrillSpark__*`) |

**DrillSpark is not optional.** The diagram is the contract every stage approves and
derives from, so there is no degraded mode: with no diagram there is nothing to approve
and no way to trace what the implementation came from. All four harness skills check the
connection once before they produce anything, and stop with setup instructions instead
of falling back to pasting Mermaid into the terminal.

## Connecting DrillSpark

1. **Create an account** at [drillspark.io](https://drillspark.io/).
2. **Connect the MCP server** — two ways:
   - **Claude Code** — issue an API key (`dsk_…`) from the
     [dashboard](https://drillspark.io/dashboard) and add
     `https://drillspark.io/api/mcp/mcp` as an `http` server with an
     `Authorization: Bearer <key>` header.
   - **Claude.ai Web / Claude Desktop** — link the account over OAuth from the
     connector settings.
3. **Name the server `drillspark`.** The skills and agents declare both `mcp__drillspark__*`
   (a server you named yourself) and `mcp__claude_ai_DrillSpark__*` (the claude.ai connector)
   in their `allowed-tools` / `tools` lists. Any *other* prefix still works for the skills —
   they just prompt every time — but an agent's `tools` list is an allowlist, so under a
   third name the reviewers and the evaluator cannot read a diagram at all.
4. **Verify** with `/mcp`. Connecting mid-session requires a restart.

Details and the per-symptom triage the skills follow:
[`reference/drillspark-setup.md`](reference/drillspark-setup.md) (Japanese) and
[drillspark.io/ja/docs/mcp](https://drillspark.io/ja/docs/mcp).

## Install

The repository is its own single-plugin marketplace (`.claude-plugin/marketplace.json`):

```bash
/plugin marketplace add jackasser/drillspark-harness
/plugin install drillspark-harness@drillspark-harness
```

From a local clone, the same two steps take a path:

```bash
git clone https://github.com/jackasser/drillspark-harness
/plugin marketplace add ./drillspark-harness
/plugin install drillspark-harness@drillspark-harness
```

Session-only trial, from the plugin directory (skills register as `drillspark-harness:<skill>`):

```bash
claude --plugin-dir . -- "harness-implement で新しいハーネスを作りたい"
claude --plugin-dir . -- "Use the process-improve skill to inventory my work"
```

### Hooks

Installing the plugin registers three guard scripts as **PreToolUse hooks** (three matchers, seven
commands) in every session, in every project.
They are declared in `hooks/hooks.json`; nothing is written to your `settings.json`.

| matcher | guard | what it stops |
|---|---|---|
| `Write` `Edit` `MultiEdit` `Bash` | `scripts/harness-view-guard.js` | overwriting a `docs/harness/*/可視化/*.html` page, a fix counter past 2, a page that fails the lint, a Bash redirect / `tee` / `cp` / `mv` whose target is a `可視化/*.html` page |
| `Write` `Edit` `MultiEdit` `Bash` | `scripts/process-write-guard.js` | a table or plan under `業務改善/` that fails its lint (the plugin's own file names are always checked; other files there are left alone unless they contain a plugin table); a Bash redirect / `tee` / `cp` / `mv` / `sed -i` into `業務改善/`, any file redirect while the shell is inside `業務改善/`, and a python / perl / ruby / `node -e` / PowerShell command that names a path under `業務改善/` |
| `mcp__*__update_diagram` | `scripts/process-write-guard.js` | `update_diagram` on a project whose id is neither in `業務改善/業務一覧.md` nor in any `.md` under `docs/harness/` — someone else's diagram. The message names where each skill records its own project (`図の在りか`, `処理/<名>/図.md`, `改善/<日付>.md`) |
| `Write` `Edit` `MultiEdit` `Bash` | `scripts/harness-freeze-guard.js` | changing or removing a numbered row of a frozen `docs/harness/**/合格条件.md` (one that contains 「凍結」), adding rows without raising 「第N版」, dropping the 「凍結」 word, or writing the file through a Bash redirect / `sed -i` |

Everything else exits 0 immediately: the cost is one `node` start per guard — three per `Write` /
`Edit` / `Bash` call, about 100 ms each — and no model context. To switch the guards off without uninstalling, set
`DRILLSPARK_HARNESS_GUARDS=off`; to remove them, `claude plugin disable drillspark-harness`.

## What is included

```text
skills/harness-implement/     目的を考える → … → 評価する（6工程）。処理は1回の起動につき1つ
  SKILL.md                    工程の手順そのもの
  MAPPING.md                  図の要素 → Claude Code の構成要素。唯一の対応表
  FRONTIER.md                 図が決めていないことを潰す問いの立て方＋網羅チェックリスト11項目
skills/harness-compose/       統合する（1工程）。処理を束ね、1つしかない設定をここだけで書く
skills/harness-improve/       改善する（1工程）。処理一覧 → 理想図 → 差分。実装はしない
skills/harness-visualize/     可視化する（処理）。図＋設計＋実測を自己完結の HTML 1枚に
agents/harness-asis-reviewer.md     現状図の突き合わせ。実ファイルと照合し指摘だけ返す
agents/harness-design-reviewer.md   設計レビュー。指摘だけ返す
agents/harness-evaluator.md         評価。合格条件を走らせ、目的の達成を測る
reference/drillspark-setup.md         接続の確認と、未登録・未接続のときの案内。各 skill が開始時に読む
reference/harness-design-criteria.md  レビュー時の判定線。両エージェントが毎回読む
reference/設計.md.template            設計ファイル一式の雛形（工程ごとに1ファイル）
scripts/harness-view-build.js         可視化の1枚を map.json ＋ diagrams.json から組み立てる（書く前に柵を通す。依存なし）
scripts/harness-view-lint.js          可視化 HTML の契約を決定論で検査（依存なし）
scripts/harness-view-guard.js         可視化 HTML を書く前に効く柵（上書き・回数欄・lint）。PreToolUse hook
hooks/hooks.json                      guard 2本をプラグインとして配る hook 定義

skills/process-improve/               業務を棚卸しして改善する（5工程）
skills/process-improve-view/          改善計画を1枚にする（処理）。判定はしない
agents/process-expert.md              専門家役。起動時に渡された役割で案を出す。承認の場に出ない
agents/process-improve-reviewer.md    業務改善の判定役。基準を読むだけで書き換えない
scripts/process-abc.js                業務一覧から ABC 分析と印の候補を決定論で出す
scripts/process-coverage.js           get_project の結果から、全工程に第二階層があるかを数える（§4 に入る前の条件）
scripts/process-write-guard.js        業務改善/ を書く前に効く柵（表と1枚の検査・図の書き換え先）。PreToolUse hook
scripts/harness-freeze-guard.js       凍結した合格条件.md の番号行を変えさせない柵。PreToolUse hook
reference/business-improvement-criteria.md  業務改善の判定線。判定役が毎回読む
reference/business-improvement-tables.md    4つの表の列と入る値
scripts/process-table-lint.js         業務改善の表を決定論で検査（依存なし）
scripts/process-plan-lint.js          改善計画の1枚を決定論で検査（依存なし）

# 両系統から呼ぶ共有ツール（接頭辞を持たせない）
scripts/diagram-lint.js               図の構造を決定論で検査（依存なし）
scripts/file-saved-lint.js            指定パスに実際に保存されたかを確かめる（依存なし）
tests/                                lint と柵の期待挙動を固定するサンプル＋ランナー（件数は Validation 節）
docs/harness/process-improve/         この pipeline を自分自身に適用した実例（設計・図・凍結した合格条件・実装記録）
.claude-plugin/plugin.json            プラグインのマニフェスト（名前・版・skills の置き場）
.claude-plugin/marketplace.json       このリポジトリを単独プラグインのマーケットプレースにする定義
CHANGELOG.md                          版ごとの変更
LICENSE                               Apache-2.0
.github/workflows/tests.yml           CI — Ubuntu と Windows で bash tests/run.sh
```

### Two families, one plugin

The plugin now covers **two subjects with the same method**.

| | Subject | Where the current state comes from |
|---|---|---|
| `harness-*` | A Claude Code harness | The `.claude/` files, read by the agent |
| `process-*` | **A human's actual work** | **Interviews.** There are no files to read |

That inversion is the whole difference. `harness-improve` is built on *"finding facts is my job;
ask the owner only for purpose."* For human work there is no `.claude/` to grep, so the facts come
from asking too. Everything else transfers: one diagram grown in conversation rather than a
before-and-after pair, unreadable spots drawn as flagged nodes rather than guessed, loops with a
limit **and** a destination, and a criteria file the generating side cannot edit.

`skills/process-improve/` is for **someone who has never done process improvement** — an ordinary
employee looking at their own job. It builds a table of their work — where the `Artifact` tool is
available it publishes a small inventory sheet (`skills/process-improve/assets/棚卸しシート.html`,
one row per task, auto-saved to the artifact's database) and reads the rows back instead of
interviewing one question at a time (an employee typically lists 1–10 tasks, but four fields each
still means dozens of turns); without it, the interview remains — ranks it by
time using ABC analysis *by machine* (the user is never asked to compute a cumulative percentage), draws the one
or two heaviest as a DrillSpark diagram, walks ECRS in order — **eliminate, combine, rearrange,
simplify, asked one question at a time** rather than "please suggest improvements" — and ends with
a hand-off note listing which steps to give to an AI and how far (H1–H5), which operations need a
human approval, and how much time that would save.

**It never implements anything, and it never connects saved time to anyone's performance review.**
Both are stated as out of scope, because eliminating a step is a proposal about someone's job.

Two marks travel with every diagram, and they are not the same thing:

| Mark | Means |
|---|---|
| **未確認** | Could not be heard from the user — a gap, visible as a gap |
| **一般例** | **The expert agent filled it in from general knowledge** |

The second one is the dangerous one. A fluent, plausible-sounding proposal gets approved far more
readily than a blank does, so the mark is attached *before* the draft is ever shown, and the
conversation starts from the marked nodes.

`skills/harness-visualize/` is a **処理 (workflow), not a 工程 (stage)** — it does
not join the chain below. It takes one workflow of a harness and renders the diagram, the
design and what actually happened into a single self-contained HTML page. It renders; it
does not judge. Grading stays with `harness-evaluator`. The model does not write the page:
it writes a `map.json` (which node became which file, mechanism and status; gates; pass
conditions; excerpts) and copies the DrillSpark diagrams into `diagrams.json`, and
`scripts/harness-view-build.js` builds the page deterministically and runs the guard before
writing it.

`skills/harness-improve/` **runs the pipeline backwards, and does not implement.** Every other
stage starts from a purpose and derives diagrams from it. Improve starts from the `.claude/` files
that already exist and derives the diagram from *them* — that is the one direction no other stage
covers, and it is why improve is the entry point for a harness you inherited.

It works the whole harness, not one symptom. It enumerates the harness's 処理 (workflows — each
one mobilises several skills, agents and hooks, so counting skills does not count 処理), gets that
table approved, then grows one ideal diagram per 処理 *in conversation with the owner*: draw what
the files currently say, talk, correct it toward the ideal in place. One diagram, not a before and
an after — a second diagram would leave the next person unable to tell which one is the contract.
What the files do not reveal is drawn as a node flagged **"cannot be read — needs confirming"**,
because an unflagged guess gets approved and becomes the contract.

The output is a diff, not an edit: improve never writes under `.claude/`. Diffs go to
`harness-implement` as work orders, and a final cross-cutting pass reports what no single diagram
can show — duplicated parts, parts that appear in no 処理's row (reported as unattributed, never
as "unused"), and **how many times the harness stops its owner across the whole system**. It assumes nothing is set up: `設計.md`, `.claude/rules/`,
`.claude/tests/` and the diagrams may all be absent, and creating that `設計.md` is often the most
valuable thing a first improvement pass leaves behind.

### The eight stages

```text
目的を考える → 処理の種類を考える
  →〔one 処理 at a time〕処理を作る → 合格条件を決める → 実装する
  →（once every 処理 is done）統合する → 評価する →（改善する）
```

Stages do not chain automatically. Each one stops and waits for the owner —
passing an approval gate means *this stage's output is accepted*, not *start the next one*.

**Every stage leaves a file.** Because each 処理 is built in its own session, the only thing that
survives between them is what is on disk — so each stage writes its own file under
`docs/harness/<name>/` (`設計.md` as the index, then `処理/<名>/図.md`, `合格条件.md`, `実装.md`,
`統合.md`, `評価/<date>.md`, `改善/<date>.md`) and then runs a lint that checks the path really
exists and is non-empty. "I wrote it out" reads the same whether or not the write happened; only
a machine can tell. The frozen pass conditions are a file, so merging them at integration is a
file-level operation that never opens them.

**One session builds one 処理.** Drawing a second workflow in the context that just drew the
first one leaks the first one's granularity, lane split and approval habits into it — measured
in practice, where two rules that are written down explicitly broke at once, and re-reading
the rules did not fix it. Splitting the context did, on the first try.

The split has to be a **session**, not a subagent: a subagent cannot talk to the owner, so the
per-diagram approval gate stops existing, and routing the owner's answers through a parent puts
the whole harness's context back in the seat that draws. That defect became visible only when the
flow was drawn — the diagram had an edge from the owner's approval gate back into the subagent,
and no such edge can exist.

Because 処理 are built one at a time, nothing sees the whole harness — which is what
`skills/harness-compose/` is for. `settings.json`'s hooks and permissions, `CLAUDE.md` and the
pass-condition directory exist once per harness, so exactly one stage writes them, after every
workflow is implemented and before evaluation. It merges frozen pass conditions **without editing
them**, lets `deny` win over `allow`, and counts how many times the assembled harness stops its
owner — a number no single workflow's diagram can show. What it cannot reconcile in three rounds
it records as ⚠ and hands back.

**Approval is concentrated above the diagram.** The diagram is the contract; everything below it
is derived from the diagram plus the frozen pass conditions. The only gate left before
implementation is freezing those conditions. Measured in practice, gates placed below the
diagram filled up with information the owner could not act on, and the design review that used
to sit there now runs inside the implementation stage — agent to agent, without stopping a human.

### The diagram lint

`validate_diagram` checks syntax only. This lint checks structure, deterministically:

`UNPARSED` `SKIPPED` `DUPLICATE` `UNDEFINED` `NODE_ID` `NO_DURATION` `DECISION_FORM`
`START_END` `NODE_COUNT` `MULTI_OUTPUT` `NO_EXIT` `UNREACHABLE` `ORPHAN` `EDGE_STYLE`

The four content lints (diagram, view, plan, table) also return `SYNTAX` for input they cannot
parse at all; `diagram-lint` reports the unparsed lines (`UNPARSED`) first.

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/diagram-lint.js" diagram.mmd   # 0 / 2 / 1
mcp-output | node "$CLAUDE_PLUGIN_ROOT/scripts/diagram-lint.js" -
```

`$CLAUDE_PLUGIN_ROOT` is expanded inside a Claude Code session. From a clone, run the same
scripts as `node scripts/diagram-lint.js …`.

It deliberately does **not** judge what cannot be made deterministic — where a loop goes
when it exceeds its cap, whether parent and child notes agree, whether a label is
verb + noun. Those stay in the reviewer's MUST list.

### The visualization lint

A rendered page is easy to call finished because it *looks* finished. One CDN link makes
it break offline; one absolute path or UUID makes it unpublishable. Both survive a visual
check, so a machine looks instead:

`EXTERNAL_REF` `NO_NODE` `NODE_ID` `DUPLICATE` `MISSING_SECTION` `PRIVATE_INFO`

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-view-lint.js" docs/harness/<name>/可視化/<workflow>-<date>.html
```

`EXTERNAL_REF` looks at **loading positions only** — any attribute of a tag other than `<a>`
(`src`, `srcset`, `poster`, `data`, `action`, `link href` …), plus `url()` and `@import` — so a
source URL in the body text, `<a href="https://…">`, is legitimate and passes.
`PRIVATE_INFO` rejects home-directory paths, e-mail addresses, UUIDs and the shapes of API keys
and tokens (`Bearer …`, `dsk_…`, `sk-ant-…`, `ghp_…`, `AKIA…`).

### The process-improvement lints

Three more, same shape (no dependencies, `exit 0` / `2` / `1`, one finding per violation):

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/process-table-lint.js" 業務改善/業務一覧.md
node "$CLAUDE_PLUGIN_ROOT/scripts/process-table-lint.js" 業務改善/AI化依頼書.md --list 業務改善/業務一覧.md
node "$CLAUDE_PLUGIN_ROOT/scripts/process-plan-lint.js"  業務改善/改善計画-<workflow>.html
node "$CLAUDE_PLUGIN_ROOT/scripts/file-saved-lint.js"  業務改善/改善計画-<workflow>.html
node "$CLAUDE_PLUGIN_ROOT/scripts/process-abc.js"       業務改善/業務一覧.md   # ABC ranks + waste marks, deterministic
```

| lint | codes |
|---|---|
| `process-table-lint` | `UNKNOWN_TABLE` `MISSING_COLUMN` `ORPHAN_ROW` `ROW_WIDTH` `EMPTY_CELL` `HOLD_WITHOUT_CONTACT` `TIME_WITHOUT_METHOD` `TIME_FORMAT` `MISSING_HAS` `MISSING_APPROVAL` `ENUM_VALUE` `NODE_REF` `ESTIMATE_NOT_ALLOWED` `GUESSED_IN_REQUEST` `DETAIL_MISSING` `UNKNOWN_WORK` |
| `process-plan-lint` | `MISSING_BLOCK` `EXTERNAL_REF` `MISSING_MARK` `PRIVATE_INFO` |
| `file-saved-lint` | `NOT_SAVED` |

The table lint enforces one rule that runs through the whole design:

> **"I don't know" is written as a value, never left blank. The value carries a destination
> (who to ask). A "don't know" with no destination counts as blank. Only blank fails.**

That is why `保留` (on hold) without a contact name is rejected: without it, every unanswerable
row could be marked on-hold and the table would pass.

> **`PRIVATE_INFO` means something narrower here than in `harness-view-lint`.** The visualization
> lint rejects UUIDs; this one does not, because an improvement page carries the DrillSpark URL of
> the diagram it describes — that link is the way back to the diagram. Same code name, deliberately
> different scope. Running `harness-view-lint` against a `process-improve-view` page fails on
> exactly that difference. **No test pins the two scopes against each other** — the runner
> dispatches by filename (`*-view-*` / `*-plan-*`), so nothing stops them from converging later.

## Language

The skill and agent bodies are Japanese and are not translated. They carry a lot of
measured detail — recorded failures, counts, and the reasons behind each rule — and a
machine translation would quietly drop the parts that matter. If you need an English
edition, open an [issue](https://github.com/jackasser/drillspark-harness/issues); a translation
is a real piece of work, not a build step.

## Validation

```bash
claude plugin validate . --strict
bash tests/run.sh
```

`tests/run.sh` runs the five lints as 58 checks — 54 fixtures whose filename prefix encodes
the expected exit code (`ok-*` → 0, `ng-*` → 2), two ABC-analysis checks and two save checks —
then six page-build checks, two stage-coverage checks, six inventory-sheet checks, three
diagram-display checks, 80 guard checks and one hook-wiring check, validates the plugin and checks that all 37 shipped files are present. Any mismatch exits 1. (Counts are taken from the runner's output;
do not update them by hand.)

| checks | what |
|---|---|
| 17 `.mmd` | `diagram-lint` |
| 8 `*-view-*.html` | `harness-view-lint` |
| 7 `*-plan-*.html` | `process-plan-lint` |
| 22 `*-table-*.md` | `process-table-lint` |
| 2 (`ok-table-abc.md`: ranks A/B/C and marks with their source words; `ok-table-abc-year.md`: `/週` and `/年` totals converted to a month) | `process-abc` |
| 2 (a missing path, an existing file) | `file-saved-lint` |
| 6 (`ok-build-minimal.*.json` builds a page whose fix counter goes 0 → 1 → 2 and is refused on the fourth run; a map without `purpose` and a map without its diagrams are refused without writing) | `harness-view-build` |
| 2 (`ok-coverage.json`: every stage has a second level; `ng-coverage-missing.json`: stages 3 and 4 are named as missing, read from stdin) | `process-coverage` |
| 6 (`skills/process-improve/assets/棚卸しシート.html`: written as a fragment, connects through `claude.use("db")`, its 測り方 options match `process-table-lint`, frequency units, Google Fonts is the only external resource, no private information) | inventory sheet |
| 3 (every skill whose text calls `show_project` allows it under both server prefixes) | diagram display |
| 80 (PreToolUse JSON fed to each guard: what it stops, what it must let through — including the resume ledger `業務改善/進行.md`, harness projects recorded under `docs/harness/`, script writes into `業務改善/`, the frozen 合格条件.md — malformed input, the off switch) | `harness-view-guard`, `process-write-guard`, `harness-freeze-guard` |
| 1 (`hooks/hooks.json` parses, has the three matchers, every command points at a shipped script) | hook wiring |

Every fixture carries an `expect: <CODE> x<count>` line (`%% expect:` in `.mmd`), and the runner
checks the reported code and count, not just the exit status. An exit code alone is not a pass
condition: a lint that returned 2 for everything would satisfy "violation sample exits 2".
The one thing no fixture pins is the difference between the two `PRIVATE_INFO` scopes
(see [The process-improvement lints](#the-process-improvement-lints)).

## Status and known limitations

Current status: **`0.4.0` — extracted from a working private harness, not yet
independently validated.** Stated plainly, because a harness that overstates its own
maturity is exactly the failure mode it exists to prevent.

- **The `process-*` family has never been run against real work.** It was built by running
  this pipeline on itself, and the pass conditions are frozen and green — but no one has yet
  taken an actual job through 業務一覧 → 図 → ECRS → hand-off note. Every claim about what it
  does for a beginner is untested.
- **`harness-*` was hand-written first and diagrammed afterwards**, in the reverse of the order
  it prescribes. `process-*` is the first thing built in the correct order — purpose, workflow
  list, diagrams, frozen conditions, then implementation — and **doing so exposed four defects
  in the pipeline itself**, all now fixed:
  - drawing a second workflow in the same context as the first silently broke two rules that
    were written down and being followed until then
  - the parent (the orchestrating conversation) gave instructions from memory of a diagram it
    had discarded
  - the parent's list of "places this change propagates to" was half the real count, and one of
    the missed places was a **node label** carrying a number, not a note
  - the parent miscounted the diagrams twice; counts now come from `list_diagrams`, not memory
- The recurring shape: **the side that can only see one workflow is the side that catches the
  side that can see all of them.** Six such catches in one build, every one a real defect.
- **Measured against no harness at all, it has not yet shown a win.** In the one
  comparison run so far, a plain Claude Code session matched or beat it on all three
  points checked. That comparison was contaminated and is being re-taken; the honest
  reading today is *not proven*, not *proven ineffective*.
- **What did produce findings** is the separation: independent reviewers surfaced 24 MUST
  items across two passes, and the evaluator caught three human-intervention points that
  existed on the diagram but were missing from the implementation.
- **Rules cannot be distributed by a plugin.** The criteria file therefore ships under
  `reference/` and is read explicitly by the agents rather than injected. This is a
  stronger guarantee than a repository rule, not a weaker one — but it does mean the
  agents must actually read it, and they are instructed to refuse to judge if they cannot.
- Approval gates, escalation destinations and loop caps have only been exercised once
  with a human present. Treat them as unproven until you have run them yourself.
- **Each skill has been run once headless, in a sandbox** (`claude --plugin-dir … -p`, DrillSpark
  read-only). Five of the six reached their first approval gate or wrote their file with the
  guards passing. **`harness-visualize` did not produce its page in four attempts**: gathering
  the inputs takes about a minute, but writing a 60–120 KB page (hand-drawn SVG, eight tables,
  file excerpts, inline JS) in a single `Write` did not complete within 15–45 minutes. That is
  why the page is now generated: the model writes only the mapping (`map.json`) and copies the
  diagrams, and `scripts/harness-view-build.js` does the rest and runs the guard before writing.
  Run headless that way, the skill produced the page in about 13 minutes (84 nodes mapped,
  lint and guard passing) — slow, but it finishes; most of the time is the model writing the
  mapping. Two more things the sandbox showed: headless mode has no
  `AskUserQuestion`, so gates fall back to a prose question and stop; and a project's own
  `CLAUDE.md` is loaded before any skill, so an instruction planted there runs before
  `harness-improve` can say it is material, not orders.

## License

Apache-2.0. See [LICENSE](LICENSE).
