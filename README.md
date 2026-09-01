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
| Claude Code | `2.1.196` or later (skill bodies use `${CLAUDE_PLUGIN_ROOT}`) |
| Node.js | any version with `fs` — the lint script has no dependencies |
| DrillSpark account | required — see [Connecting DrillSpark](#connecting-drillspark) |
| DrillSpark MCP server | connected, exposing `mcp__drillspark__*` tools |

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
3. **Name the server `drillspark`.** The skills and agents declare `mcp__drillspark__*`
   in their `allowed-tools` / `tools` lists, and those entries pre-authorize the tools
   only under that name. Any other prefix (a hosted connector may expose
   `mcp__claude_ai_DrillSpark__*`) still **works** — it just prompts every time.
4. **Verify** with `/mcp`. Connecting mid-session requires a restart.

Details and the per-symptom triage the skills follow:
[`reference/drillspark-setup.md`](reference/drillspark-setup.md) (Japanese) and
[drillspark.io/ja/docs/mcp](https://drillspark.io/ja/docs/mcp).

## Install

```bash
/plugin marketplace add jackasser/drillspark-harness
/plugin install drillspark-harness
```

Session-only trial, from the plugin directory:

```bash
claude --plugin-dir . -- "harness-implement で新しいハーネスを作りたい"
```

## What is included

```text
skills/harness-implement/     目的を考える → … → 評価する（6工程）。処理は1回の起動につき1つ
  SKILL.md                    工程の手順そのもの
  MAPPING.md                  図の要素 → Claude Code の構成要素。唯一の対応表
  FRONTIER.md                 図が決めていないことを潰す問いの立て方＋網羅チェックリスト11項目
skills/harness-compose/       統合する（1工程）。処理を束ね、1つしかない設定をここだけで書く
skills/harness-improve/       改善する（1工程）。処理一覧 → 理想図 → 差分。実装はしない
skills/harness-visualize/     可視化する（処理）。図＋設計＋実測を自己完結の HTML 1枚に
agents/harness-design-reviewer.md   設計レビュー（Checker）。指摘だけ返す
agents/harness-evaluator.md         評価。合格条件を走らせ、目的の達成を測る
reference/drillspark-setup.md         接続の確認と、未登録・未接続のときの案内。3つの skill が開始時に読む
reference/harness-design-criteria.md  レビュー時の判定線。両エージェントが毎回読む
reference/設計.md.template            設計ファイル一式の雛形（工程ごとに1ファイル）
scripts/harness-view-lint.js          可視化 HTML の契約を決定論で検査（依存なし）

skills/process-improve/               業務を棚卸しして改善する（5工程）
skills/process-improve-view/          改善計画を1枚にする（処理）。判定はしない
agents/process-expert.md              専門家役。起動時に渡された役割で案を出す。承認の場に出ない
agents/process-improve-reviewer.md    業務改善の判定役。基準を読むだけで書き換えない
reference/business-improvement-criteria.md  業務改善の判定線。判定役が毎回読む
reference/business-improvement-tables.md    4つの表の列と入る値
scripts/process-table-lint.js         業務改善の表を決定論で検査（依存なし）
scripts/process-plan-lint.js          改善計画の1枚を決定論で検査（依存なし）

# 両系統から呼ぶ共有ツール（接頭辞を持たせない）
scripts/diagram-lint.js               図の構造を決定論で検査（依存なし）
scripts/file-saved-lint.js            指定パスに実際に保存されたかを確かめる（依存なし）
tests/                                lint の期待挙動を固定する 32 件＋ランナー
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
employee looking at their own job. It builds a table of their work, ranks it by time using ABC
analysis *by machine* (the user is never asked to compute a cumulative percentage), draws the one
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

`skills/harness-visualize/` is a **処理 (workflow), not an eighth 工程 (stage)** — it does
not join the chain below. It takes one workflow of a harness and renders the diagram, the
design and what actually happened into a single self-contained HTML page. It renders; it
does not judge. Grading stays with `harness-evaluator`.

`skills/harness-improve/` **runs the pipeline backwards, and does not implement.** The other six
stages start from a purpose and derive diagrams from it. Improve starts from the `.claude/` files
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
can show — duplicated parts, parts no 処理 uses, and **how many times the harness stops its owner
across the whole system**. It assumes nothing is set up: `設計.md`, `.claude/rules/`,
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
on 2026-08-30, where two rules that are written down explicitly broke at once, and re-reading
the rules did not fix it. Splitting the context did, on the first try.

The split has to be a **session**, not a subagent: a subagent cannot talk to the owner, so the
per-diagram approval gate stops existing, and routing the owner's answers through a parent puts
the whole harness's context back in the seat that draws. That defect became visible only when the
flow was drawn — the diagram had an edge from the owner's approval gate back into the subagent,
and no such edge can exist (owner's finding, 2026-08-31).

Because 処理 are built one at a time, nothing sees the whole harness — which is what
`skills/harness-compose/` is for. `settings.json`'s hooks and permissions, `CLAUDE.md` and the
pass-condition directory exist once per harness, so exactly one stage writes them, after every
workflow is implemented and before evaluation. It merges frozen pass conditions **without editing
them**, lets `deny` win over `allow`, and counts how many times the assembled harness stops its
owner — a number no single workflow's diagram can show. What it cannot reconcile in three rounds
it records as ⚠ and hands back.

**Approval is concentrated above the diagram.** The diagram is the contract; everything below it
is derived from the diagram plus the frozen pass conditions. The only gate left before
implementation is freezing those conditions. Measured on 2026-08-24, gates placed below the
diagram filled up with information the owner could not act on, and the design review that used
to sit there now runs inside the implementation stage — agent to agent, without stopping a human.

### The diagram lint

`validate_diagram` checks syntax only. This lint checks structure, deterministically:

`UNPARSED` `DUPLICATE` `UNDEFINED` `NODE_ID` `NO_DURATION` `DECISION_FORM`
`START_END` `NODE_COUNT` `MULTI_OUTPUT` `NO_EXIT` `UNREACHABLE` `ORPHAN` `EDGE_STYLE`

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/diagram-lint.js" diagram.mmd   # 0 / 2 / 1
mcp-output | node "$CLAUDE_PLUGIN_ROOT/scripts/diagram-lint.js" -
```

It deliberately does **not** judge what cannot be made deterministic — where a loop goes
when it exceeds its cap, whether parent and child notes agree, whether a label is
verb + noun. Those stay in the reviewer's MUST list.

### The visualization lint

A rendered page is easy to call finished because it *looks* finished. One CDN link makes
it break offline; one absolute path or UUID makes it unpublishable. Both survive a visual
check, so a machine looks instead:

`EXTERNAL_REF` `NO_NODE` `NODE_ID` `DUPLICATE` `MISSING_SECTION` `PRIVATE_INFO`

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-view-lint.js" docs/harness/<name>/可視化/<date>.html
```

`EXTERNAL_REF` looks at **loading positions only** (`link href`, `src`, `url()`,
`@import`) — a source URL in the body text is legitimate and passes.

### The process-improvement lints

Three more, same shape (no dependencies, `exit 0` / `2` / `1`, one finding per violation):

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/process-table-lint.js" 業務改善/業務一覧.md
node "$CLAUDE_PLUGIN_ROOT/scripts/process-plan-lint.js"  業務改善/改善計画.html
node "$CLAUDE_PLUGIN_ROOT/scripts/file-saved-lint.js"  業務改善/改善計画.html
```

| lint | codes |
|---|---|
| `process-table-lint` | `EMPTY_CELL` `HOLD_WITHOUT_CONTACT` `TIME_WITHOUT_METHOD` `MISSING_HAS` `MISSING_APPROVAL` |
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
> exactly that difference, and a frozen test pins it.

## Language

The skill and agent bodies are Japanese and are not translated. They carry a lot of
measured detail — recorded failures, counts, and the reasons behind each rule — and a
machine translation would quietly drop the parts that matter. If you need an English
edition, open an issue; a translation is a real piece of work, not a build step.

## Validation

```bash
claude plugin validate . --strict
bash tests/run.sh
```

`tests/run.sh` runs the five lints as 32 checks — 30 fixtures whose filename prefix encodes
the expected exit code (`ok-*` → 0, `ng-*` → 2), plus two save checks — then validates the
plugin and checks that all 23 shipped files are present. Any mismatch exits 1.

| checks | lint |
|---|---|
| 10 `.mmd` | `diagram-lint` |
| 6 `*-view-*.html` | `harness-view-lint` |
| 5 `*-plan-*.html` | `process-plan-lint` |
| 9 `*-table-*.md` | `process-table-lint` |
| 2 (a missing path, an existing file) | `file-saved-lint` |

The `.html` and `.md` fixtures carry an `expect: <CODE> x<count>` line, and the runner checks
the reported code and count, not just the exit status. An exit code alone is not a pass
condition: a lint that returned 2 for everything would satisfy "violation sample exits 2".

**The two `PRIVATE_INFO` scopes are not pinned against each other by any test.** The runner
dispatches by filename — `*-view-*` to `harness-view-lint`, `*-plan-*` to `process-plan-lint` —
so no fixture ever runs one lint's page through the other. Run by hand,
`harness-view-lint tests/ok-plan-minimal.html` reports 9 findings, of which the UUID is one; the
rest are structural checks that do not apply to an improvement page. **Nothing stops the two
scopes from converging later.**

## Status and known limitations

Current status: **`0.2.0` — extracted from a working private harness, not yet
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

## License

Apache-2.0. See [LICENSE](LICENSE).
