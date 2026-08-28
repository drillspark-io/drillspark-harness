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
| DrillSpark MCP server | connected, exposing `mcp__drillspark__*` tools |

**MCP naming caveat.** The skills and agents declare `mcp__drillspark__*` in their
`allowed-tools` / `tools` lists.
If your DrillSpark server is connected under a different prefix (a hosted connector may
expose it as `mcp__claude_ai_DrillSpark__*`), those entries simply do not pre-authorize
anything — the tools still work, they just prompt. Nothing breaks; you may want to
rename the server in your MCP config so the declaration matches.

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
skills/harness-implement/     目的を考える → … → 評価する（6工程）
  SKILL.md                    工程の手順そのもの
  MAPPING.md                  図の要素 → Claude Code の構成要素。唯一の対応表
  FRONTIER.md                 図が決めていないことを潰す問いの立て方＋網羅チェックリスト11項目
skills/harness-improve/       改善する（1工程）。処理一覧 → 理想図 → 差分。実装はしない
skills/harness-visualize/     可視化する（処理）。図＋設計＋実測を自己完結の HTML 1枚に
agents/harness-design-reviewer.md   設計レビュー（Checker）。指摘だけ返す
agents/harness-evaluator.md         評価。合格条件を走らせ、目的の達成を測る
reference/harness-design-criteria.md  レビュー時の判定線。両エージェントが毎回読む
reference/設計.md.template            設計書の雛形
scripts/harness-diagram-lint.js       図の構造を決定論で検査（依存なし）
scripts/harness-view-lint.js          可視化 HTML の契約を決定論で検査（依存なし）
tests/                                lint の期待挙動を固定する 16 件＋ランナー
```

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

### The seven stages

```text
目的を考える → 処理の種類を考える → 処理を作る → 合格条件を決める → 実装する → 評価する →（改善する）
```

Stages do not chain automatically. Each one stops and waits for the owner —
passing an approval gate means *this stage's output is accepted*, not *start the next one*.

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
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-diagram-lint.js" diagram.mmd   # 0 / 2 / 1
mcp-output | node "$CLAUDE_PLUGIN_ROOT/scripts/harness-diagram-lint.js" -
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

`tests/run.sh` runs the two lints against 16 fixtures whose filename prefix encodes the
expected exit code (`ok-*` → 0, `ng-*` → 2) — 10 `.mmd` for the diagram lint and 6 `.html`
for the visualization lint — then validates the plugin and checks that every shipped file
is present. Any mismatch exits 1.

The `.html` fixtures also carry an `expect: <CODE> x<count>` line, and the runner checks
the reported code and count, not just the exit status. An exit code alone is not a pass
condition: a lint that returned 2 for everything would satisfy "violation sample exits 2".

## Status and known limitations

Current status: **`0.1.0` — extracted from a working private harness, not yet
independently validated.** Stated plainly, because a harness that overstates its own
maturity is exactly the failure mode it exists to prevent.

- **This pipeline has never been produced by itself.** It was hand-written first and
  diagrammed afterwards, in the reverse of the order it prescribes. A run in the correct
  order was started and reached the first approval gate; the remaining stages are untried.
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
