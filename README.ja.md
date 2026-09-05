# DrillSpark Harness

> English: [README.md](README.md)

**先に業務の流れを図に描き、その図から Claude Code にハーネスを作らせて検証する。**

[DrillSpark](https://drillspark.io/) の BPMN 図を Claude Code の実設定 — skill・agent・hook・権限・合格条件 — に落とし、
人の業務も同じ方法で棚卸しして改善する Claude Code プラグインです。レビュー役と評価役は生成した側とは別のエージェントで、
生成側が書き換えられない判定基準ファイルに照らして判定します。

## できること

| 系統 | 手元にあるもの | 出てくるもの |
|---|---|---|
| `harness-*` | Claude Code のハーネスの目的（または既にある `.claude/`） | 承認済みの DrillSpark の図、凍結した合格条件、それを実装した `.claude/` の実ファイル。別のエージェントがレビューと評価をする |
| `process-*` | 自分の仕事。面談か1枚の棚卸しシートで答える | 時間の重い順に並んだ業務一覧（ABC 分析）、重い業務の図、1問ずつ進める ECRS の改善案、何を AI に渡しどこで人が承認するかを書いた引き渡しの1枚 |

全体を支える規則は2つです。

- **図が契約。** 誰が・何を・どの順で・どこで人が止めるかは図の上で決めて承認します。会話の中で即興しません。
- **生成した側は自分を採点しない。** レビューと評価は別のエージェントが `reference/harness-design-criteria.md` を読んで行います。
  このファイルはプラグインの中、あなたのリポジトリの外にあります。

## インストール

前提:

| | |
|---|---|
| Claude Code | `2.1.233` 以上 |
| Node.js | 14 以上。どのセッションでも `PATH` に在ること（hook が `node` を起動します。依存は無し） |
| DrillSpark | アカウントと、MCP サーバの接続。下を見てください |

**1. DrillSpark に繋ぐ。** [drillspark.io](https://drillspark.io/) でアカウントを作ります。
アカウントが無い人にはクーポンコード `drill-kaizen` を渡します（1ヶ月無料。お支払い画面で入力）。
**無料期間が終わる前に自分で解約**しないと課金が始まります。続けて MCP サーバを繋ぎます。

- **Claude Code** — [ダッシュボード](https://drillspark.io/dashboard)で API キー（`dsk_…`）を発行し、
  `https://drillspark.io/api/mcp/mcp` を `http` サーバとして `drillspark` の名前で追加し、`Authorization: Bearer <キー>` ヘッダを付けます。
- **Claude Desktop / claude.ai** — 設定のコネクタからアカウントを連携します（OAuth）。

`/mcp` で確かめます。セッションの途中で繋いだら再起動が要ります。skill は2つのサーバ名（`drillspark` と claude.ai コネクタ）を
受け付けます。それ以外の名前では、レビュー役の agent が図を読めません。症状ごとの案内は
[`reference/drillspark-setup.md`](reference/drillspark-setup.md) にあります。

**2. プラグインを入れる。** このリポジトリ自身がマーケットプレースです。

```bash
/plugin marketplace add drillspark-io/drillspark-harness
/plugin install drillspark-harness@drillspark-harness
```

入れずに1セッションだけ試すなら、clone した先から:

```bash
claude --plugin-dir ./drillspark-harness
```

## クイックスタート

ハーネスを最初から作る（処理は1セッションに1つ）:

```text
/drillspark-harness:harness-implement  新しいハーネスを作りたい。目的は「ブログ記事を書いて公開する」
```

引き継いだハーネスを見直す（`.claude/` を読んで図を起こす。編集はしない）:

```text
/drillspark-harness:harness-improve  このリポジトリのハーネスを見直したい
```

自分の業務を棚卸しして改善する（ファイルは要らない。skill が聞きます）:

```text
/drillspark-harness:process-improve  私の業務を棚卸ししたい
```

どの工程も承認ゲートで止まり、次に進む前に結果を `docs/harness/<名>/`（`process-*` は `業務改善/`）のファイルに書きます。

## skill

| skill | 使うとき | 出てくるもの |
|---|---|---|
| `harness-implement` | 新しいハーネスを作る、既存のハーネスに2つ目の処理を足す、図を直して実ファイルに再適用する | 目的と処理一覧（`設計.md`）、処理ごとに1つの DrillSpark プロジェクト、凍結した合格条件、その処理の `.claude/` ファイル。8工程のうち6つ。1セッションに1処理 |
| `harness-compose` | 全処理の実装が終わった | `settings.json` の hook と権限、`CLAUDE.md`、束ねた合格条件の置き場。処理をまたいで共有するファイルを書く唯一の工程 |
| `harness-improve` | ハーネスを引き継いだ、理想と `.claude/` の中身の差分が欲しい | 処理の一覧表、処理ごとに一緒に育てる理想図、`harness-implement` へ渡す差分。`.claude/` の下には書かない |
| `harness-visualize` | 処理1つの図・設計・実際に起きたことを1枚で見たい | `docs/harness/<名>/可視化/` の自己完結の HTML 1枚。`scripts/harness-view-build.js` が組み立てる |
| `process-improve` | 人の業務を棚卸しして改善したい | `業務改善/業務一覧.md`、ABC の順位、DrillSpark の図、現状と改善後の2枚で見比べる ECRS の案、`AI化依頼書.md` |
| `process-improve-view` | 改善計画を1枚にしたい | `業務改善/改善計画-<処理>.html` |

skill は `/drillspark-harness:<skill>` で登録されます。依頼が description に合えば Claude が自分で呼びます。

## agent

どの agent も**指摘を返すだけで編集しません**。毎回判定基準ファイルを読み、見つからなければ判定を拒みます。

| agent | 役割 |
|---|---|
| `harness-design-reviewer` | 図と実装を判定基準に照らしてレビューし、MUST / NICE を返す |
| `harness-asis-reviewer` | 現状図を実際の `.claude/` ファイルと突き合わせる |
| `harness-evaluator` | 凍結した合格条件を走らせ、処理ごとに実タスクを通し、成功指標を測る |
| `process-expert` | 渡された専門家の役割で、業務の工程→作業の割り当て表を提案する。承認の場には出ない |
| `process-improve-reviewer` | 業務改善の出力を `reference/business-improvement-criteria.md` に照らして判定する |

## hook（柵）

インストールすると、3本の柵スクリプトが **PreToolUse hook** として登録されます。定義は `hooks/hooks.json` にあり、
あなたの `settings.json` には何も書きません。

| 柵 | 止めるもの |
|---|---|
| `harness-view-guard.js` | 可視化の1枚の上書き、直しの回数欄が2を超えたもの、lint に落ちる1枚 |
| `process-write-guard.js` | `業務改善/` 配下で lint に落ちる表と1枚、Bash のリダイレクトやスクリプト経由の書き込み、プラグインが記録していない DrillSpark プロジェクトへの `update_diagram`（他人の図） |
| `harness-freeze-guard.js` | 凍結した `合格条件.md` の番号付きの行の変更・削除、版を上げない行の追加、「凍結」の印の削除 |

それ以外は即座に exit 0 です。柵1本につき `node` の起動1回、約 100 ms、モデルの文脈は使いません。
柵だけ切るには `DRILLSPARK_HARNESS_GUARDS=off`、外すには `claude plugin disable drillspark-harness`。

## lint とスクリプト

どのスクリプトも依存なしで、終了コードは `0`（合格）/ `2`（違反。1件1行）/ `1`（実行エラー）です。
セッションの中では `$CLAUDE_PLUGIN_ROOT` がプラグインを指します。clone した先では `node scripts/…` で呼びます。

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/diagram-lint.js"       diagram.mmd            # 構文でなく構造を見る
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-view-lint.js"  docs/harness/<名>/可視化/<処理>-<日付>.html
node "$CLAUDE_PLUGIN_ROOT/scripts/process-table-lint.js" 業務改善/業務一覧.md
node "$CLAUDE_PLUGIN_ROOT/scripts/process-plan-lint.js"  業務改善/改善計画-<処理>.html
node "$CLAUDE_PLUGIN_ROOT/scripts/process-abc.js"        業務改善/業務一覧.md   # ABC の順位と無駄の印
node "$CLAUDE_PLUGIN_ROOT/scripts/process-coverage.js"   < get_project.json     # 全工程に第二階層があるか
node "$CLAUDE_PLUGIN_ROOT/scripts/file-saved-lint.js"    <パス>                 # 本当に保存されたか
```

各 lint のコードと、なぜその検査があるか: [docs/design-notes.md](docs/design-notes.md#the-lints)（英語）。

## 仕組み

```text
目的を考える → 処理の種類を考える
  →〔1処理ずつ〕処理を作る → 合格条件を決める → 実装する
  →（全処理そろったら）統合する → 評価する →（改善する）
```

- 工程は自動で連鎖しません。ゲートを通ることは「この出力を受け入れた」であって「次を始めてよい」ではありません。
- **すべての工程がファイルを残し**、`docs/harness/<名>/` に在ることを機械で確かめます。
- **1セッションで作るのは1処理。** 同じ文脈で2つ目を描くと1つ目の癖が混ざります。規則を読み直させても直らず、セッションを分けると直りました。
- **承認は図より上に集約します。** 図より下のゲートは合格条件の凍結だけで、設計レビューは実装の中で agent 同士が行います。
- 生成される側のハーネスも、工程ごとにファイルを残します（図の document ノード）。次の工程の入力になる成果物には、書き込み道具を持たない検査役の agent を挟みます。

理由の全文、2系統の設計、規則を形づくった実際の欠陥の記録: [docs/design-notes.md](docs/design-notes.md)（英語）。

## 検証

```bash
claude plugin validate . --strict
bash tests/run.sh
```

`tests/run.sh` は、ファイル名の接頭辞が期待する終了コードを表す 58 件のサンプルに lint を当て、続けて1枚の生成・第二階層の網羅・
入力画面・図の表示・接続の案内・柵・hook の配線を検査し、プラグインを validate し、同梱ファイルの存在を確かめます。1件でも違えば exit 1 です。
件数はランナーが出力します。サンプルの固定の仕方は [docs/design-notes.md](docs/design-notes.md#how-the-tests-are-pinned) を見てください。
CI は Ubuntu と Windows で同じものを走らせます。

## 現状

`0.4.0`。検証したのは作者だけです。`process-improve` に実際の業務を1人分、`harness-implement` → `compose` → `evaluate` で
ハーネスを1つ作って実タスクを1件通しました。素の Claude Code との比較で勝ちを示せてはいません。承認ゲート・エスカレーション・
ループの上限を人が立ち会って動かしたのは数回です。自分で走らせるまでは未検証と扱ってください。
詳細: [docs/design-notes.md](docs/design-notes.md#status-and-known-limitations)（英語）。

## 言語について

skill と agent の本文は日本語で、これが正本です。計測された細部 — 記録された失敗、件数、各規則の理由 — を多く含むので、
機械翻訳はしていません。英語版が必要なら [issue](https://github.com/drillspark-io/drillspark-harness/issues) を立ててください。

## 貢献

issue と pull request は [github.com/drillspark-io/drillspark-harness](https://github.com/drillspark-io/drillspark-harness) へ。
PR の前に `bash tests/run.sh` と `claude plugin validate . --strict` を通してください。`tests/run.sh` は凍結した合格条件です。
直すのは実装で、テストではありません。

## ライセンス

Apache-2.0。[LICENSE](LICENSE) を見てください。
