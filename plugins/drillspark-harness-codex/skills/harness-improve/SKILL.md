---
name: harness-improve
description: 既存のCodex設定を読み、現状の業務フローをDrillSparkで照合して理想図と差分を作る。設定の変更はharness-implementへ引き渡す。
---

# 既存のCodexハーネスを改善する

[実行規約](../../reference/runtime.md)、[共通手順](../../reference/workflow-contract.md)、
[対応表](../../reference/MAPPING.md) を読む。MCP接続を確認する。
事前の設計書が無くても、AGENTS.md、.agents/skills、.codex/agents、.codex/hooks.json、
.codex/config.toml、参照先の実体を読み、在るものから始める。秘密値を記録へ転載しない。

1. 独立した処理の一覧と入力・出力・担当・根拠のファイルを整理する。
   ファイル数やskill数を処理数としない。存在理由は根拠で確かめ、不明な目的だけ利用者に聞く。
   処理一覧を利用者が確認してから図へ進む。
2. 1処理を選び、現状図を実物から作る。作成したプロジェクトURLを
   docs/harness/<name>/改善/<date>.mdへ直ちに記録する。
   `harness-asis-reviewer` を別エージェントとして起動し、図と実ファイルを独自に照合させる。
3. 利用者と理想図を1枚ずつ育てる。現状を取得・記録してから理想を編集し、変更根拠を残す。
   最大3往復で決着しなければ保留。理想図の明示的な承認前に差分を実装しない。
4. ノード→現状ファイル→理想の意味→必要な変更を対応づける。
   削除候補も利用者の判断として記録し、未使用だけを理由に削除しない。
5. 別処理は新しいセッション。全処理終了後に重複・共有設定・権限・介入点の横断差分をまとめる。
   改善/<date>.mdへ承認済み範囲・差分・保留・相談先・次の依頼文を保存し、file-saved-lint。

編集するのは改善の記録とそのために作成・記録した図。利用者の設定ファイルを直接変更しない。
実装はharness-implementへ、全体設定の反映はharness-composeへ引き渡す。
