# 2環境のソースと配布

Claude版は従来どおりリポジトリ直下。Codex版はplugins/drillspark-harness-codex/。
ブランドは共通、インストールするプラグインは別。

| 正本 | 用途 |
|---|---|
| reference/workflow-contract.md | 両版の工程・承認・成果物の意味 |
| reference/の業務表と評価基準 | 両版の形式と判定基準 |
| scripts/の既存lint・guard・ビルダー | 両版で同じコードを使用 |
| skills/、agents/ | 既存Claude版の入口・役割。役割本文はCodex版にも生成 |
| platforms/codex/ | Codex固有の入口・設定対応・実行規約・導入案内 |
| scripts/build-codex-plugin.js | 共通資料とCodex固有資料から自己完結の配布物を生成 |

Claude固有の設定対応は丸ごとCodexの対応表に切り替える。単語置換で架空の権限設定を作らない。
役割本文・テンプレートに残る環境名/パスは生成時に変換し、意味の異なる検証箇所は明示的に置き換える。
元の該当箇所が変わったら生成を失敗させ、移植の再確認を要求する。
共通手順と各入口の整合は実機確認の対象。生成物を直接修正しない。

```text
node scripts/build-codex-plugin.js
node scripts/build-codex-plugin.js --check
node scripts/check-codex-package.js plugins/drillspark-harness-codex
node --test tests/codex-guard.test.js tests/codex-package.test.js tests/codex-config.test.js
bash tests/run.sh
```

生成物はGitに含め、インストール時にビルドを要求しない。秘密ファイル、_internal、.git、node_modulesは入力にしない。
生成先の想定外ファイルを自動削除しない。余分なものがあれば停止して保守者が確認する。
CIはWindows/Ubuntuで再生成の一致・リンク・フックの配線・動作・既存Claude版を検証する。

## ローカル導入

リポジトリをソースとして登録し、Codex版だけをインストールする。

```text
codex plugin marketplace add <path-to-clone>
codex plugin add drillspark-harness-codex@drillspark-harness
```

パスは各開発者のclone先へ変える。CLI 0.153.4でこのコマンドの存在を確認。
インストール済みコピーはキャッシュから読まれる。ソース修正後は更新/再インストールし、新規セッションで確認する。
実機の記録は [確認表](codex-release-checklist.md)。hookの信頼操作を自動化しない。
