# DrillSpark Harness

> English: [README.md](README.md)

**Claude Code の設定を、先に業務の図を描いてから作る。作ったものは、作った AI とは別の AI が採点する。**

## どんな問題を解くか

Claude Code に長い手順を書いても、そのとおりには動きません。「必ず確認して」と書いた確認は飛ばされ、
どこで人が止めるべきかは誰も決めておらず、できあがったものは作った本人が「できました」と言うだけです。

このプラグインは順番を変えます。

1. **先に図を描く。** 誰が・何を・どの順で・どこで人が確認するかを、[DrillSpark](https://drillspark.io/) の業務フロー図に描いて、
   あなたが1枚ずつ承認します。図が契約です。
2. **図から設定を作る。** 承認した図から、Claude Code の skill・agent・hook・権限を作ります。「必ず確認して」の一文は、
   確認を通らないと動かない hook（柵）になります。
3. **別の AI が採点する。** 作った側とは別のエージェントが、プラグインに同梱された判定基準に照らして指摘します。
   判定基準はあなたのリポジトリの外にあるので、作った側が書き換えられません。

同じ方法で**人の仕事**も扱えます。読むファイルが無いので聞き取りで業務の一覧と図を作り、
どの作業を AI に任せてどこで人が承認するかを決めた1枚を出します。

![DrillSpark に描いた処理の図。第一階層には工程だけを置き、各工程が残す書類を横に描く](docs/images/drillspark-root.jpg)

*このプラグイン自身の処理「業務を改善する」の図。第一階層は工程だけ。工程を開くと作業の図になります。*

## 使ってみる

### ハーネスを作る

```text
/drillspark-harness:harness-implement  新しいハーネスを作りたい。目的は「ブログ記事を書いて公開する」
```

起きること:

1. **目的を聞かれる。** 誰のため・何を成果物とするか・成功を何で測るか・やらないこと。答えは `docs/harness/<名>/設計.md` に保存されます。
2. **処理（ワークフロー）の一覧を提案される。** 「記事を書く」「公開する」のように、独立した仕事の単位ごとに1行。あなたが確認して確定します。
3. **図を1枚ずつ描く。** まず全体の骨格、次に工程ごとの作業。1枚描くたびに DrillSpark の図が表示され、「この図でよいか」と聞かれます。
   工程ごとに何をファイルに残すか、成果物を誰が検査するかも図の上に描かれます。

   ![工程「業務を図にする」を開いた第二階層。利用者と AI のレーンに分かれ、「工程はこれでよい?」「作業はこれでよい?」で人が止める](docs/images/drillspark-drilldown.jpg)
4. **合格条件を見せられる。** 図から導いた、機械で判定できるテスト（hook が止める入力と通す入力、lint の合否など）。承認すると凍結され、以後は実装の都合で変えられません。
5. **実装される。** `.claude/` に skill・agent・hook・rule が書かれ、レビュー役の agent が判定基準に照らして指摘し、凍結した合格条件が実行されます。ここでは人は止まりません。
6. **次の処理は新しいセッションで。** 1回の起動で作るのは処理1つです。全部そろったら `harness-compose` が `settings.json` と `CLAUDE.md` を書き、`harness-evaluator` が実タスクを通して測ります。

### 自分の仕事を棚卸しして改善する

```text
/drillspark-harness:process-improve  私の業務を棚卸ししたい
```

起きること:

1. **仕事を聞かれる。** 業務名・頻度・1回の時間・目的。`Artifact` が使える環境では1枚の入力シートが開き、1業務1行で書き込めます。
2. **時間の重い順に並ぶ。** ABC 分析はスクリプトが計算します。答えられなかった欄は空欄ではなく「未確認: ◯◯さんに聞く」として残ります。
3. **重い業務が図になる。** 工程ごとに、作業を1つずつ「これでよいか」と確かめながら描きます。専門家役の AI が一般知識で埋めた箇所には「一般例」の印が付きます。
4. **改善を1問ずつ聞かれる。** なくせるか・まとめられるか・順番を変えられるか・簡単にできるか（ECRS）。案は改善後の図として描かれ、現状の図と見比べます。
5. **引き渡しの1枚が出る。** どの作業を AI に任せるか（H1〜H5）、どこで人が承認するか、どれだけ時間が浮くか。実装はしません。

### 引き継いだハーネスを見直す

```text
/drillspark-harness:harness-improve  このリポジトリのハーネスを見直したい
```

`.claude/` のファイルを読んで、いまの動きを図に起こし、あなたと対話しながら理想の形へ直し、差分を出します。
ファイルは編集しません。差分は `harness-implement` への作業指示になります。

### 用語

| 語 | 意味 |
|---|---|
| ハーネス | Claude Code に渡す設定の一式。`CLAUDE.md`・skill・agent・hook・権限 |
| 処理 | ハーネスが持つ独立した仕事の単位。「記事を書く」「請求書を転記する」。1処理＝DrillSpark の1プロジェクト |
| 工程 | 処理の中の段階。図の第一階層。その下に作業が並ぶ |

## インストール

| 前提 | |
|---|---|
| Claude Code | `2.1.233` 以上 |
| Node.js | 14 以上。`PATH` に在ること（hook が `node` を起動します。依存パッケージは無し） |
| DrillSpark | アカウントと MCP サーバの接続 |

**1. DrillSpark に繋ぐ。** [drillspark.io](https://drillspark.io/) でアカウントを作ります。
アカウントが無い人にはクーポンコード `drill-kaizen` を渡します（1ヶ月無料。お支払い画面で入力）。
**無料期間が終わる前に自分で解約**しないと課金が始まります。

- **Claude Code** — [ダッシュボード](https://drillspark.io/dashboard)で API キー（`dsk_…`）を発行し、
  `https://drillspark.io/api/mcp/mcp` を `http` サーバとして `drillspark` の名前で追加します（`Authorization: Bearer <キー>`）。
- **Claude Desktop / claude.ai** — 設定のコネクタから連携します。

`/mcp` で確かめます。途中で繋いだら再起動が要ります。サーバ名は `drillspark` か claude.ai コネクタのどちらかにしてください。
それ以外の名前だとレビュー役の agent が図を読めません。繋がらないときの切り分けは
[`reference/drillspark-setup.md`](reference/drillspark-setup.md)。

**2. プラグインを入れる。**

```bash
/plugin marketplace add drillspark-io/drillspark-harness
/plugin install drillspark-harness@drillspark-harness
```

入れずに1セッションだけ試すなら、clone した先で `claude --plugin-dir ./drillspark-harness`。

## 中身

### skill

| skill | 使うとき |
|---|---|
| `harness-implement` | ハーネスを新しく作る。既存のハーネスに処理を足す。図を直して実ファイルに再適用する |
| `harness-compose` | 全処理の実装が終わり、`settings.json` と `CLAUDE.md` を1回で書く |
| `harness-improve` | ハーネスを引き継いだ。理想と `.claude/` の差分を知りたい |
| `harness-visualize` | 処理1つの図・設計・実行記録を HTML 1枚で見たい |
| `process-improve` | 自分の（誰かの）仕事を棚卸しして、AI に任せる部分を決めたい |
| `process-improve-view` | 改善計画を HTML 1枚にしたい |

### agent

どの agent も指摘を返すだけで、ファイルを直しません。

| agent | 役割 |
|---|---|
| `harness-design-reviewer` | 図と実装を判定基準に照らしてレビューする |
| `harness-asis-reviewer` | 現状図が `.claude/` の実ファイルと合っているかを見る |
| `harness-evaluator` | 凍結した合格条件を走らせ、実タスクを通し、成功指標を測る |
| `process-expert` | 専門家の役割で業務の工程と作業を提案する |
| `process-improve-reviewer` | 業務改善の出力を判定基準に照らして判定する |

### 柵（hook）

インストールすると PreToolUse hook が3本入ります。`settings.json` には何も書きません。

| 柵 | 止めるもの |
|---|---|
| `harness-view-guard.js` | 可視化の1枚の上書き、直しの回数が上限を超えた書き込み、lint に落ちる1枚 |
| `process-write-guard.js` | `業務改善/` の表で lint に落ちるもの、スクリプトやリダイレクト経由の書き込み、プラグインが記録していない DrillSpark の図の書き換え |
| `harness-freeze-guard.js` | 凍結した合格条件の行の変更・削除 |

対象外の操作は即座に通ります（`node` の起動1回、約 100 ms）。切るには `DRILLSPARK_HARNESS_GUARDS=off`。

### スクリプト

依存なしの Node.js スクリプト。終了コードは `0` 合格 / `2` 違反 / `1` エラー。図の構造 lint、可視化 HTML の lint、
業務改善の表と1枚の lint、ABC 分析、第二階層の網羅、保存の確認。呼び方とコードの一覧は
[docs/design-notes.md](docs/design-notes.md#the-lints)。

## 設計の背景

なぜ図を契約にするのか、なぜ1セッションで1処理なのか、どんな失敗からこの規則ができたか。
[docs/design-notes.md](docs/design-notes.md)（英語）にまとめてあります。

## 現状

`0.4.0`。検証したのは作者だけです。`process-improve` に実際の業務を1人分、`harness-implement` からの一連でハーネスを1つ作って
実タスクを1件通しました。素の Claude Code との比較で勝ちを示せてはいません。自分で走らせるまでは未検証と扱ってください。

## 言語について

skill と agent の本文は日本語で、これが正本です。英語版が必要なら
[issue](https://github.com/drillspark-io/drillspark-harness/issues) を立ててください。

## 貢献

issue と pull request は [github.com/drillspark-io/drillspark-harness](https://github.com/drillspark-io/drillspark-harness) へ。
PR の前に `bash tests/run.sh` と `claude plugin validate . --strict` を通してください。

## ライセンス

Apache-2.0。[LICENSE](LICENSE) を見てください。
