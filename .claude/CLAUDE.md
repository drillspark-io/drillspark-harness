# drillspark-harness

DrillSpark の BPMN 図を Claude Code の実設定へ落とすプラグイン。

**作業を始める前に [`_internal/HANDOFF.md`](_internal/HANDOFF.md) を読む。**
現在の状態・未決の判断・既知の欠陥・外にある関連物が全部そこにある。

## コマンド

```bash
claude plugin validate . --strict     # マニフェストと同梱物の検証
bash tests/run.sh                     # lint の期待挙動 ＋ 同梱ファイルの存在（これが合格条件）
claude --plugin-dir . -- "…"          # セッション限定でロードして試す
```

`tests/run.sh` は**凍結した合格条件**。lint を直したときに条件のほうを書き換えない。
実装を直して通す。

## 規律

1. **`_internal/` は公開コピーに含めない。** 作業記録と引き継ぎだけが入る
2. **私的情報を持ち込まない** — 絶対パス・メール・DrillSpark のプロジェクトUUID・顧客名・社名。
   追加・編集のたびに grep で確認する
3. **既存の DrillSpark プロジェクトを更新しない。** `update_diagram` は全置換で、
   図は git の外にある。読むのは可
4. **判定基準 `reference/harness-design-criteria.md` を生成側の都合で緩めない。**
   このファイルが作業対象リポジトリの外にあること自体が防御になっている
5. **ファイル編集は Edit ツールで行う。** `sed` / `awk` を使わない
6. 変更したら `bash tests/run.sh` と `claude plugin validate . --strict` を両方通す

## 構成

```text
skills/harness-implement/   目的を考える → … → 評価する（6工程）
skills/harness-improve/     改善する（1工程）
agents/                     レビュー役と評価役。生成側から分離されている
reference/                  判定基準（両エージェントが毎回読む）と 設計.md の雛形
scripts/                    図の構造 lint（依存なし）
tests/                      lint の期待挙動を固定する 10 件＋ランナー
```
