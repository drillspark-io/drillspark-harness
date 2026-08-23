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
skills/harness-improve/       改善する（1工程）。3つの経路とオーナー判断の位置
agents/harness-design-reviewer.md   設計レビュー（Checker）。指摘だけ返す
agents/harness-evaluator.md         評価。合格条件を走らせ、目的の達成を測る
reference/harness-design-criteria.md  レビュー時の判定線。両エージェントが毎回読む
reference/設計.md.template            設計書の雛形
scripts/harness-diagram-lint.js       図の構造を決定論で検査（依存なし）
tests/                                lint の期待挙動を固定する 10 件＋ランナー
```

### The seven stages

```text
目的を考える → 処理の種類を考える → 処理を作る → 設計する → 実装する → 評価する →（改善する）
```

Stages do not chain automatically. Each one stops and waits for the owner —
passing an approval gate means *this stage's output is accepted*, not *start the next one*.

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

`tests/run.sh` runs the lint against 10 fixtures whose filename prefix encodes the
expected exit code (`ok-*` → 0, `ng-*` → 2), then validates the plugin and checks that
every shipped file is present. Any mismatch exits 1.

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
