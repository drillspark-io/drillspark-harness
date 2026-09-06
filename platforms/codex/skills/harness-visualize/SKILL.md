---
name: harness-visualize
description: 1処理のDrillSpark図と設計・実装・評価記録を対応づけ、自己完結HTMLにまとめる。図の設計や実装の修正、独自の合否判定はしない。
---

# 処理1つを1枚にする

[実行規約](../../reference/runtime.md)、[共通手順](../../reference/workflow-contract.md) を読む。
docs/harness/<name>/の設計・処理別成果物・統合・評価を読み、対象処理を1つ選ぶ。
図が参照されている場合はMCP接続を確認して取得する。接続不能を「図無し」と解釈しない。

1. get_projectが返すcontent.diagramsをそのまま `<process>-<date>.diagrams.json` に保存する。
2. [map.jsonの書式](../../reference/visualization-map.md) に従い、全ノードと実装箇所を対応づける。
   目的・介入点5種・合格条件・成果物・抜粋・未完を記録から転記する。評価無しは設計のみ/未記録。
   実ファイル抜粋は1箇所40行まで。秘密値・絶対パスを共有用ページに持ち込まない。
3. `docs/harness/<name>/可視化/<process>-<date>.map.json` をapply_patchで保存する。
   別実行は連番を足す。map/diagramsの補助スクリプトを利用者の作業フォルダへ散らかさない。
4. `node <plugin-root>/scripts/harness-view-build.js <map.jsonのパス>` を実行する。
   この同梱ビルダーだけは書込前に共通ガードを自ら実行するのでHTMLの生成に使える。
   HTMLを手で長文生成しない。失敗時は入力だけを修正し、ガードを迂回しない。
5. 出力を読み戻し、対応づけ・リンク・抜粋・表示を確認する。同実行の修正は最大2回。
   スクリプトが回数を管理する。実行エラーは入力の修正で隠さず報告する。
   file-saved-lintで保存を確認してファイルリンクを渡す。

可視化は判定の根拠を見せる工程。テストが未実施なら「通った」にしない。公開は別の依頼で行う。
