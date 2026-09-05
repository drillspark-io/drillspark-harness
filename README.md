# DrillSpark Harness

> 日本語版: [README.ja.md](README.ja.md)

**Draw the workflow first, then let Claude Code build and check the harness from the diagram.**

A Claude Code plugin that turns a [DrillSpark](https://drillspark.io/) BPMN diagram into real
configuration — skills, agents, hooks, permissions and pass conditions — and audits a human's
business process the same way. Reviewers and the evaluator run as separate agents against a
criteria file the generating side cannot edit.

> **Skill content is written in Japanese.** The manifest and this README are in English; the
> skill and agent bodies are not translated. See [Language](#language).

## What it does

| Family | You start with | You end with |
|---|---|---|
| `harness-*` | A purpose for a Claude Code harness (or an existing `.claude/` directory) | Approved DrillSpark diagrams, frozen pass conditions, and the real `.claude/` files that implement them — reviewed and evaluated by separate agents |
| `process-*` | Your own job, described in an interview or a one-page inventory sheet | An inventory table ranked by time (ABC analysis), a diagram of the heaviest work, ECRS improvements asked one at a time, and a one-page hand-off note saying what to give to AI and where a human must approve |

Two rules hold everything together:

- **The diagram is the contract.** Who does what, in what order, and where a human stops the run
  is decided on the diagram and approved there — not improvised in chat.
- **The generating side cannot grade itself.** Review and evaluation are separate agents reading
  `reference/harness-design-criteria.md`, which lives inside the plugin, outside your repository.

## Installation

Requirements:

| | |
|---|---|
| Claude Code | `2.1.233` or later |
| Node.js | 14 or later, on `PATH` in every session (the hooks start `node`; no dependencies) |
| DrillSpark | an account and the MCP server connected — see below |

**1. Connect DrillSpark.** Create an account at [drillspark.io](https://drillspark.io/). A user
without an account gets the coupon code `drill-kaizen` (one month free; entered on the payment
page). **Cancel before the free month ends**, or billing starts. Then connect the MCP server:

- **Claude Code** — issue an API key (`dsk_…`) from the [dashboard](https://drillspark.io/dashboard)
  and add `https://drillspark.io/api/mcp/mcp` as an `http` server named `drillspark` with an
  `Authorization: Bearer <key>` header.
- **Claude Desktop / claude.ai** — link the account from the connector settings (OAuth).

Check with `/mcp`. Connecting mid-session needs a restart. The skills accept both server names
(`drillspark` and the claude.ai connector); under any other name the reviewer agents cannot read
diagrams. Per-symptom help: [`reference/drillspark-setup.md`](reference/drillspark-setup.md)
(Japanese).

**2. Install the plugin.** The repository is its own marketplace:

```bash
/plugin marketplace add drillspark-io/drillspark-harness
/plugin install drillspark-harness@drillspark-harness
```

To try it for one session without installing, from a clone:

```bash
claude --plugin-dir ./drillspark-harness
```

## Quick start

Build a harness from scratch (one workflow per session):

```text
/drillspark-harness:harness-implement  新しいハーネスを作りたい。目的は「ブログ記事を書いて公開する」
```

Improve a harness you inherited — reads `.claude/` and draws the diagram from it, never edits:

```text
/drillspark-harness:harness-improve  このリポジトリのハーネスを見直したい
```

Inventory and improve your own work — no files needed, the skill interviews you:

```text
/drillspark-harness:process-improve  私の業務を棚卸ししたい
```

Every stage stops at an approval gate and writes its result to a file under `docs/harness/<name>/`
(or `業務改善/` for `process-*`) before the next stage starts.

## Skills

| Skill | Use it when | What it produces |
|---|---|---|
| `harness-implement` | You want a new harness, a second workflow for an existing one, or a diagram re-applied to files | Purpose and workflow list (`設計.md`), one DrillSpark project per workflow, frozen pass conditions, the workflow's `.claude/` files. Six of the eight stages; one workflow per session |
| `harness-compose` | Every workflow is implemented | `settings.json` hooks and permissions, `CLAUDE.md`, the merged pass-condition directory — the only stage that writes files shared across workflows |
| `harness-improve` | You inherited a harness, or want a diff between the ideal and what is in `.claude/` | A workflow table, one ideal diagram per workflow grown with you, and a diff handed to `harness-implement`. Never writes under `.claude/` |
| `harness-visualize` | You want one page showing a workflow's diagram, design and what actually ran | A self-contained HTML page under `docs/harness/<name>/可視化/`, built by `scripts/harness-view-build.js` |
| `process-improve` | You want to inventory and improve a human job | `業務改善/業務一覧.md`, ABC ranking, a DrillSpark diagram, ECRS proposals as an as-is / to-be pair, `AI化依頼書.md` |
| `process-improve-view` | You want the improvement plan on one page | `業務改善/改善計画-<workflow>.html` |

Skills register as `/drillspark-harness:<skill>` and are also invoked by Claude when a request
matches their description.

## Agents

All agents **report findings and never edit**. They read the criteria file on every run and refuse
to judge if they cannot find it.

| Agent | Role |
|---|---|
| `harness-design-reviewer` | Reviews diagrams and implementation against the criteria; returns MUST / NICE items |
| `harness-asis-reviewer` | Checks an as-is diagram against the real `.claude/` files |
| `harness-evaluator` | Runs the frozen pass conditions, walks each workflow with a real task, measures the success metric |
| `process-expert` | Proposes stage → task tables for a job from a given expert role; never appears at approval gates |
| `process-improve-reviewer` | Judges the process-improvement outputs against `reference/business-improvement-criteria.md` |

## Hooks (guards)

Installing the plugin registers three guard scripts as **PreToolUse hooks**, declared in
`hooks/hooks.json`. Nothing is written to your `settings.json`.

| Guard | Stops |
|---|---|
| `harness-view-guard.js` | Overwriting a visualization page, a fix counter past 2, a page that fails its lint |
| `process-write-guard.js` | A table or plan under `業務改善/` that fails its lint, writes into it through Bash redirects or scripts, and `update_diagram` on a DrillSpark project the plugin did not record (someone else's diagram) |
| `harness-freeze-guard.js` | Changing or removing a numbered row of a frozen `合格条件.md`, adding rows without raising the version, dropping the 「凍結」 mark |

Everything else exits 0 immediately: one `node` start per guard, about 100 ms, no model context.
Switch the guards off with `DRILLSPARK_HARNESS_GUARDS=off`; remove them with
`claude plugin disable drillspark-harness`.

## Lints and scripts

Every script is dependency-free and exits `0` (pass) / `2` (violations, one line each) / `1` (error).
Inside a session `$CLAUDE_PLUGIN_ROOT` points at the plugin; from a clone use `node scripts/…`.

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/diagram-lint.js"       diagram.mmd            # structure, not just syntax
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-view-lint.js"  docs/harness/<name>/可視化/<workflow>-<date>.html
node "$CLAUDE_PLUGIN_ROOT/scripts/process-table-lint.js" 業務改善/業務一覧.md
node "$CLAUDE_PLUGIN_ROOT/scripts/process-plan-lint.js"  業務改善/改善計画-<workflow>.html
node "$CLAUDE_PLUGIN_ROOT/scripts/process-abc.js"        業務改善/業務一覧.md   # ABC ranks and waste marks
node "$CLAUDE_PLUGIN_ROOT/scripts/process-coverage.js"   < get_project.json     # every stage has a second level?
node "$CLAUDE_PLUGIN_ROOT/scripts/file-saved-lint.js"    <path>                 # was it really written?
```

Codes and the reasoning behind each lint: [docs/design-notes.md](docs/design-notes.md#the-lints).

## How it works

```text
目的を考える → 処理の種類を考える
  →〔one workflow at a time〕処理を作る → 合格条件を決める → 実装する
  →（once every workflow is done）統合する → 評価する →（改善する）
```

- Stages do not chain. Passing a gate means *this output is accepted*, not *start the next stage*.
- **Every stage leaves a file** under `docs/harness/<name>/` and checks by machine that it exists.
- **One session builds one workflow.** Drawing a second one in the same context leaks the first
  one's habits into it; splitting the session fixed it where re-reading the rules did not.
- **Approval is concentrated above the diagram.** The only gate below it is freezing the pass
  conditions; design review runs agent-to-agent inside implementation.
- Each stage of the *generated* harness also writes a file (a document node on the diagram), and a
  deliverable that feeds the next stage gets an inspection agent without write tools.

The full reasoning, the two-family design and the recorded defects that shaped these rules:
[docs/design-notes.md](docs/design-notes.md).

## Validation

```bash
claude plugin validate . --strict
bash tests/run.sh
```

`tests/run.sh` runs the lints against 58 fixtures whose filename prefix encodes the expected exit
code, then the page-build, stage-coverage, inventory-sheet, diagram-display, setup-guidance, guard
and hook-wiring checks, validates the plugin and checks that every shipped file is present. Any
mismatch exits 1. The counts are printed by the runner; see
[docs/design-notes.md](docs/design-notes.md#how-the-tests-are-pinned) for how fixtures are pinned.
CI runs the same on Ubuntu and Windows.

## Status

`0.4.0`. Verified so far only by its author: one real job through `process-improve`, one harness
built and run through `harness-implement` → `compose` → `evaluate`. No comparison against a plain
Claude Code session has yet shown a win. Approval gates, escalation and loop caps have been
exercised with a human present only a few times — treat them as unproven until you have run them
yourself. Details: [docs/design-notes.md](docs/design-notes.md#status-and-known-limitations).

## Language

The skill and agent bodies are Japanese and are not translated. They carry measured detail —
recorded failures, counts, and the reasons behind each rule — and a machine translation would
quietly drop the parts that matter. If you need an English edition, open an
[issue](https://github.com/drillspark-io/drillspark-harness/issues).

## Contributing

Issues and pull requests are welcome at
[github.com/drillspark-io/drillspark-harness](https://github.com/drillspark-io/drillspark-harness).
Run `bash tests/run.sh` and `claude plugin validate . --strict` before opening a PR. `tests/run.sh`
is a frozen pass condition: fix the implementation, not the test.

## License

Apache-2.0. See [LICENSE](LICENSE).
