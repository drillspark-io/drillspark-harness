---
name: animal-office-view
description: DrillSpark の図を、動物の社員が書類を回して働く「動物たちの会社」の 3D ページ（HTML 1枚・外部読み込みなし）にする。部署（レーン）ごとに動物が1匹いて、工程の机を回り、分岐で選ばせ、サブプロセスはエレベーターで下の階へ潜る。所要時間が作業の長さになり、合計も出る。図を読まない人に業務の流れと時間のかかり方を見せたいとき、社内で共有するときに使う。判定も図の修正もしない。
allowed-tools: Read, Write, Glob, Bash, mcp__drillspark__list_projects, mcp__drillspark__get_project, mcp__claude_ai_DrillSpark__list_projects, mcp__claude_ai_DrillSpark__get_project
---

# animal-office-view — 図を「動物たちの会社」の 3D にする

**1枚はモデルが書かない。** three.js と動物のモデルを埋め込んだ数 MB の HTML を組むのは同梱の
生成スクリプト `scripts/animal-office-build.js` で、モデルが書くのは**図の写し（`diagrams.json`）**と、
任意の**配役（`office.json`）**だけ。HTML を Write / Edit しようとすると柵（`harness-view-guard`）が止める。

## やらないこと

- **判定しない。** 図の良し悪し・改善案は出さない（それは `process-improve` と判定役の仕事）
- **図を書き換えない。** 読むだけ。`update_diagram` はこのスキルの許可ツールに無い
- **HTML を手で書かない・直さない。** 直すのは `diagrams.json` か `office.json` で、生成し直す
- **プロジェクト ID や URL を1枚に入れない。** 共有先で私的情報になる（lint が UUID を落とす）

## 図と会社の対応（生成スクリプトが決める。モデルは手を出さない）

| 図 | 会社 |
|---|---|
| root 図 | 1F。子図は B1F・B2F…（キー `4_3` は root › 4 › 4_3） |
| レーン（subgraph） | 部署の島。**部署に動物1匹**。同じ名前のレーンは全フロアで同じ動物 |
| 作業 | 机（動物は机の奥に立つ） |
| 分岐 | 案内板。再生で止まり、辺のラベルで選ばせる（↩ は戻り＝ループ） |
| 開始・終了 | START / EXIT のドア |
| サブプロセス | エレベーター。子図があれば ▼ が光り、再生で下の階へ潜って戻る |
| データストア・成果物 | 書庫・書類トレイ。**先へ出ていく辺が無ければ**流れの外（作業中に写しが飛んでいく先）。開始 → 書類 → 作業 のように流れの途中にあれば、書類を書く工程として回る |
| 入出力 | 受付カウンター |
| `%% duration[id]`（分） | 作業の長さ（対数で 1〜6 秒）と ⏱ 札。再生の終わりに、**実際に通った工程**の合計。下の階へ潜った工程は中の工程で数え、親の時間は足さない（子の合計が親と食い違う図では、root の合計と一致しない） |

動物は 14 種: `neko` ねこ・`inu` いぬ・`usagi` うさぎ・`kuma` くま・`pengin` ペンギン・`kitsune` きつね・`tanuki` たぬき・
`risu` りす・`koala` コアラ・`buta` ぶた・`hitsuji` ひつじ・`saru` さる・`kaeru` かえる・`fukurou` ふくろう。
指定が無ければこの順に、root から出てきた部署へ割り当てる（14 部署を超えたら使い回す）。

## 手順

1. **DrillSpark に繋がるか1回だけ確かめる。** `list_projects()`（接頭辞は `mcp__drillspark__` か `mcp__claude_ai_DrillSpark__`）。
   繋がらなければ**止めて案内する** → `${CLAUDE_PLUGIN_ROOT}/reference/drillspark-setup.md` を **`Read` で読んでから**案内する
   （展開されないときは `Glob` で `**/drillspark-harness/reference/drillspark-setup.md`）。代わりに Mermaid を貼って進めない
2. **どのプロジェクトかを決める。** 利用者が名前か URL を言っていればそれ。言っていなければ `list_projects` の結果を見せて1回だけ聞く
3. **図を写す。** `get_project` が返した `content.diagrams`（`{ "root": "flowchart …", "2": … }`）を**そのまま**
   `drillspark-office/<名前>-<YYYY-MM-DD>.diagrams.json` に Write する（`<名前>` はファイル名に使える短い英数字かかな。
   置き場は利用者が言えばそこ）。**手で編集しない — 原文が正。** ノード・レーン・辺はスクリプトが機械で拾う。
   **図が大きいと `get_project` の結果は会話に出ず、ファイルに保存される**（「exceeds maximum allowed tokens」）。
   そのときは中身を読み直して書き写さず、保存されたファイルを**そのまま** `.diagrams.json` の名前で写す
   （`cp <保存先> drillspark-office/<名前>-<日付>.diagrams.json`）。生成スクリプトが応答の包み（`success` / `data` / `text`）を剥がす
4. **配役を書く（任意）。** 次のどれかがあるときだけ、同じ basename の `.office.json` を Write する。無ければ書かない

   ```json
   { "title": "受注から出荷まで", "animals": { "営業": "kitsune", "倉庫": "kuma" }, "omitNotes": false }
   ```

   | キー | 書くとき |
   |---|---|
   | `title` | 画面の題。**書かなければファイル名が出る**ので、プロジェクト名を入れるのが普通 |
   | `animals` | 利用者が「営業はきつね」のように言ったとき。キーはレーンの表示名そのまま、値は上の 14 種の英字 |
   | `omitNotes` | 図の備考に社外へ出せない情報（担当者のメール・社内パス）があり、lint に落とされたとき `true` |

5. **生成する。**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/animal-office-build.js" drillspark-office/<名前>-<日付>.diagrams.json
   # exit 0 = 書いた / 2 = 入力の不備か柵に止められた（理由が stderr） / 1 = 実行エラー
   ```

   書く前に柵（上書き・回数欄・`animal-office-lint`）を通す。止められたら**直すのは `diagrams.json` か `office.json`** で、
   同じコマンドを再実行する。回数欄 `<!-- 直し: N/2 -->` はスクリプトが進め、**作り直しは2回まで**。
   超えたら `<名前>-<日付>-2.diagrams.json` のように連番の新しい1枚にするか、止めて報告する。
   実行エラー（exit 1）は入力の直しでは消えないので、直さずに報告する。
   stderr に「読めなかった行」が出たら、その行の辺やノードは会社に出ていない — 報告に書き添える
6. **伝える。** 置き場（`drillspark-office/<名前>-<日付>.office.html`、ダブルクリックでブラウザが開く）と、
   stdout の「配属」（どの部署がどの動物か）を1〜2行で伝える。操作は ▶ 再生・速度・「分岐を自動で選ぶ」・
   「サブプロセスにも入る」・工程リストとクリックで説明、ドラッグで視点、と一言添える

## 生成される1枚（スクリプトが保証する契約。lint が見る）

| | |
|---|---|
| 形 | 1ファイル完結。three.js（0.160・MIT）と使う動物のモデルだけを埋め込む。外部読み込みゼロ・オフラインで開ける |
| 大きさ | 部署 3 つで約 1.7 MB。上限 8 MB（lint） |
| データ | `<script type="application/json" id="office-data">` にフロア・部署・工程の座標・辺。`id="office-models"` に .glb の base64 |
| WebGL が無い環境 | 工程の表だけを出す |
| 私的情報 | ホーム配下の絶対パス・UUID・メールアドレス・API キーの形は lint が落とす（図の備考から入りうる） |

**このスキル自身**（生成・lint・柵）の合格条件は `tests/run.sh` の「動物たちの会社」節に凍結してある（保守用。実行時には走らせない）。
ランタイムを変えたら `cd assets/animal-office && npm install && npm run build` で `runtime.js` を作り直してコミットする。

## 教訓（最大10行）

- 背の高い家具（ドア・エレベーター）の奥に動物を立たせるとカメラから隠れる。立ち位置は形で変える（実描画でしか分からない）
- CSS2D の札は、親のグループをシーンから外しても DOM に残る。階を移るときは札の要素を外す
- 全景のままだと動物が豆粒になる。再生中は書類を追って寄る
