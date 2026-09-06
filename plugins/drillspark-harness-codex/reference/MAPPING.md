# 図からCodex設定への対応

実行環境=codex、生成先=codex。同じ図の意味は [workflow-contract.md](workflow-contract.md)。
Claudeのsettings.jsonやpermissionsの名前をCodexへそのまま移さない。

| 図・役割 | 出力・実行 |
|---|---|
| 独立した処理 | `.agents/skills/<name>/SKILL.md`。name/descriptionを持つ |
| 別担当のagent | `.codex/agents/<name>.toml`。name/description/developer_instructions。モデルは既定を継承 |
| 人間の承認 | 質問→明示的な回答待ち。未承認状態は工程記録へ保存 |
| 機械の検査 | Nodeスクリプト＋`.codex/hooks.json`の該当イベント |
| 常時必要な案内 | `AGENTS.md`。短い索引。手順全文はスキルへ |
| 特定ディレクトリだけの指示 | 適切な下位ディレクトリのAGENTS.md、または必要時に読むreference |
| 外部サービス | 接続済みMCP。呼べるツールを実際に確認する |
| 成果物/長期状態 | 図のdocument/data storeが指すファイル。保存を機械確認 |
| 評価基準 | 所有者が管理する基準。プラグイン基準はインストール先のreferenceを読む |
| 凍結テスト | `tests/harness/<name>/`。処理の合格条件を改変せず集める |

## agent例

```toml
name = "workflow_reviewer"
description = "この処理の成果物を基準に照らし指摘する"
sandbox_mode = "read-only"
developer_instructions = """
対象と指定された基準を自分で読む。ファイル・図を変更せず、再現可能な指摘を返す。
"""
```

read-only はローカルファイルの制約。MCPの書き込みを止めるにはその接続のenabled_tools /
disabled_tools等の対応仕様を別途確認し、必要な読み取りツールだけに制限する。
親の実行時設定に上書きされる可能性もあるため、制限は実際の子で検証する。
プラグイン自体のレビュー役はruntime.mdの明示的起動で使い、利用者の設定を勝手に追加しない。

## hook例

```json
{"hooks":{"PreToolUse":[{"matcher":"^apply_patch$","hooks":[{"type":"command","command":"node .codex/hooks/check-workflow.js","timeout":10}]}]}}
```

PreToolUse の tool_name は apply_patch / Bash / MCP名。apply_patchの内容はtool_input.command。
exit 2がその操作を拒否する。無関係な操作を通す入力も必ずテストする。
複数の一致フックは並行して動く。順序依存なら単一スクリプト内で直列化する。
ホストでの信頼確認と発火確認が済むまで、生成済み/有効化未確認を分ける。

## 設定と権限

- `.codex/config.toml` と `.codex/hooks.json`、既存AGENTS.mdを先に読む。
- ユーザー/組織の既存制限を緩めない。全ファイルを上書きせず、所有する項目だけを差分で統合する。
- Claudeのpermissions.allow/ask/deny、paths付きrules、output stylesに架空の同名設定を作らない。
  Codexのsandbox、approval_policy、rules、MCP設定で要求を満たせるか公式仕様と実機で確認する。
  業務上の承認とOS操作の許可は別。片方だけで両方満たしたとしない。
- 任意のファイル変更の不可能性をAGENTS.mdの文章だけで保証しない。設定上できない制限は
  未対応/運用制約として実装.mdと合格条件に残し、権限を黙って広げない。
- 設定変更は具体的な差分を利用者が確認してから適用する。秘密値を差分や共有設定へ複製しない。
- TOML/JSONの構文確認後、新しいセッションで読込・MCP・hook・agentを実測する。

仕様確認日: 2026-09-06。
公式: https://learn.chatgpt.com/docs/agent-configuration/subagents
https://learn.chatgpt.com/docs/hooks
https://developers.openai.com/plugins/build/plugins
