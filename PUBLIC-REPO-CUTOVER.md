# Release Checklist

> Maintainer checklist. Users of the plugin do not need to read this file; it lives outside
> `_internal/` because it has to survive the history rewrite described below.

This repository already has the target layout — the cutover from the private workspace
is done. What remains is publication.

## Origin

Extracted 2026-08-23 from a private workspace where the harness ran as
`.claude/skills/harness-*`, `.claude/agents/harness-*`, `.claude/rules/`,
`scripts/diagram-lint.js` and `.claude/tests/`.

**Nothing syncs the two.** They were identical at extraction time apart from the
sanitization listed below. Decide which one is canon before either drifts further.

## What was sanitized during extraction

| Item | Change |
|---|---|
| `MAPPING.md` header | Two real DrillSpark project UUIDs removed; workspace-specific wording generalized |
| `MAPPING.md` | Reference to a private plugin-promotion plan removed |
| `MAPPING.md` | `drillspark-from-harness` dropped — that skill does not exist |
| `FRONTIER.md` | A worked example naming a private skill path generalized |
| `SKILL.md` | Links into the private workspace's `docs/` and `.claude/rules/` replaced with `reference/` |
| `harness-design-criteria.md` | `paths:` frontmatter dropped (plugins cannot distribute rules); moved to `reference/`, read explicitly by the agents |
| `agents/*.md` | Criteria path switched to `${CLAUDE_PLUGIN_ROOT}/reference/`, with a Glob fallback and a refuse-to-judge rule |
| `agents/harness-design-reviewer.md` | The 決着済み list was rebuilt: workspace-specific rulings removed, a slot added for the user's own |
| `diagram-lint.js` | Header comment paths generalized |
| `tests/run.sh` | Rewritten to be plugin-relative |

Verified absent: e-mail addresses, absolute local paths, drive letters, customer or
company names, project UUIDs.

## Do not publish

- `_internal/` — working notes and handoff, not part of the plugin
- anything copied back from the private workspace's `docs/harness/**`

A marketplace install copies the **whole repository** into the user's plugin cache — there is
no ignore file. Anything tracked in git ships, `_internal/` included. That is why the history
rewrite below has to happen before the first install by anyone else.

## Before publishing

The repository exists at `jackasser/drillspark-harness` and is **private**.

- [x] create the GitHub repository
- [x] set the real `repository` URL in `.claude-plugin/plugin.json`
- [x] **strip `_internal/` from the history** — done 2026-09-03 with `git filter-branch`
      (every branch), `_internal/` added to `.gitignore`, `main` force-pushed. The directory
      still exists on the maintainer's machine, untracked. Going public cannot be undone
- [ ] flip visibility to public
- [ ] set `homepage` and a support / issue tracker URL
- [ ] `claude plugin validate . --strict`
- [ ] `bash tests/run.sh`
- [ ] clean-environment install test — a machine that has never seen the private workspace
- [x] declare both DrillSpark tool prefixes (`mcp__drillspark__*` and
      `mcp__claude_ai_DrillSpark__*`) in every skill and agent — agents' `tools` is an allowlist
- [x] `.claude-plugin/marketplace.json` so `/plugin marketplace add jackasser/drillspark-harness`
      resolves — verified with a local `marketplace add` → `install` → `uninstall` round trip
- [ ] decide whether the Japanese skill bodies ship untranslated (README says they do)
- [ ] tag the version in `.claude-plugin/plugin.json` (`v0.3.0` at the time of writing)
- [ ] submit to the official marketplace

## Marketplace notes

Submission runs `claude plugin validate` on the plugin; run it locally first.
If a workspace already defines same-named local skills, Claude Code may expose these
with a namespace prefix (`/drillspark-harness:harness-implement`). That is expected.
