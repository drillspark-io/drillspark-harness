# DrillSpark Harness — Codex preview

Codexで業務を棚卸しし、DrillSparkの図からCodex用の設定を作るプラグインです。
6スキルと独立したレビュー役を含みます。手順の本文は日本語です。

## 導入

この版はCodexのスキル、MCP、サブエージェント、PreToolUseフックに対応したホストが必要です。
Node.js 20以上をPATHに用意してください。対応下限のCodexバージョンは実機確認後に確定します。

```text
codex plugin marketplace add drillspark-io/drillspark-harness
```

上流リポジトリにこの版が公開された後の導入コマンドです。ローカル開発ではリポジトリの絶対パスを渡します。
Plugins画面で **DrillSpark Harness — Codex** を選んでインストールします。
プラグインの登録、インストール、MCP接続、フックの信頼は別の操作です。

[接続手順](reference/drillspark-setup.md) に従って、同梱MCPのOAuthログインを行います。
通常はAPIキーの発行や環境変数の設定は不要です。接続画面の実機確認はまだ必要です。
新規セッションの `/mcp` で接続、`/hooks` でこのプラグインの定義を確認・信頼してください。
通常のチャットにAPIキーを貼らないでください。

## 試す

インストール後、スキル選択から対象を選ぶか、次のように依頼します。

```text
$process-improve 請求書の受け取りから支払い確認までの業務を棚卸ししたい
```

```text
$harness-implement Codexでブログ記事を作るハーネスがほしい。公開前には私が確認する
```

業務を説明し、工程と作業の図を1枚ずつ確認します。承認待ちの間に後続を実装しません。
Codexの設定生成先はCodexです。Claude Code用設定との相互生成は含みません。

| スキル | 用途 |
|---|---|
| process-improve | 棚卸し、作図、ECRS、AI化依頼書 |
| process-improve-view | 改善計画を1枚のHTMLにする |
| harness-implement | 図からCodex設定の実体を作る |
| harness-compose | 既存設定を保持して全処理を統合する |
| harness-improve | 現状設定と理想図の差分を出す |
| harness-visualize | 図・実装・評価を1枚に重ねる |

## 検証の状態

このパッケージの構造、共通lint、Codexのhook入力に対する検査はローカルテストの対象です。
新規インストールからMCP作図・独立レビュー・生成設定の実行までの実機確認は別途必要です。
`preview` はその区別を表します。構造検査の成功だけで有効化済みとはみなしません。

```text
node scripts/check-codex-package.js .
```

フックはシェルの任意プログラムを隔離するサンドボックスではありません。
保護対象の編集はapply_patch、可視化HTMLは書込前検査を行う同梱ビルダーを使います。
詳しい範囲は [実行規約](reference/runtime.md) を参照してください。

このフォルダは生成物です。変更はリポジトリのplatforms/codex/、reference/、scripts/へ行い、
`node scripts/build-codex-plugin.js` で再生成してください。
