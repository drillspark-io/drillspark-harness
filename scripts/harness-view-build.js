#!/usr/bin/env node
/**
 * harness-view-build — `harness-visualize` の1枚を、対応づけ JSON と図の JSON から決定論で組み立てる。
 *
 *   node "$CLAUDE_PLUGIN_ROOT/scripts/harness-view-build.js" docs/harness/<名>/可視化/<処理名>-<日付>.map.json
 *
 *   入力（同じフォルダ・同じ basename）:
 *     <処理名>-<日付>.map.json       人（モデル）が書く対応づけと転記。書き方は skills/harness-visualize/SKILL.md
 *     <処理名>-<日付>.diagrams.json  DrillSpark の get_project が返す content.diagrams をそのまま（{ "root": "flowchart …", "2": … }）
 *   出力:
 *     <処理名>-<日付>.html            書く前に harness-view-guard（回数欄・上書き・view-lint）を通す。落ちれば書かない
 *
 *   exit 0 = 書いた / 2 = 入力の不備か柵に止められた（stderr に理由） / 1 = 実行エラー
 *
 * なぜ要るか:
 *   1枚は 100 KB を超える（図8枚の表・原文・抜粋・CSS・JS）。モデルに1回の Write で書かせると、
 *   headless で 15〜45 分止まって出ない。決定論にできる部分（図→表、原文、抜粋の切り出し、
 *   設計システム、両方向リンク）が9割で、モデルが判断するのは対応づけだけ。だからそこだけ JSON で受け取る。
 *
 * 見ないもの（実装に無い）:
 *   - 対応づけの正しさ（何になったか・仕組み・実装先）— 転記元との突き合わせは人が読み戻す
 *   - 図の意味（レーンが正しいか・ループ上限があるか）— それは diagram-lint と判定役の仕事
 *
 * 依存なし（Node 標準の fs / path / child_process だけ）。
 */

'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const LIMIT = 2;
const MECH = { plea: '指示', ask: '確認', fence: '柵', agent: 'agent', none: '—' };
const TYPE = { terminal: '開始／終了', process: '作業', subroutine: 'サブプロセス', decision: '分岐', document: '成果物', database: 'データストア', io: '入出力' };
const STATUS = { t: ['s-t', '通った'], s: ['s-s', '止まった'], d: ['s-d', '設計のみ'], n: ['s-n', '未記録'] };

const CSS = "\r\n  /* デザインシステム（skills/harness-visualize/SKILL.md「画面の作り」）。\r\n     色は意味役で持つ: neutral ／ accent（この1枚・選択・飛ぶ）／ 状態 ok・stop・draft ／ 仕組み plea・ask・fence・agent。\r\n     状態と仕組みは色＋文字＋印（✓ ■ ○ ／ · ? ⊘ ⇢）で伝え、色だけに頼らない。罫線と余白で区切り、影は最小。 */\r\n  :root {\r\n    --bg: #f6f8fa; --card: #ffffff; --surface-2: #f6f8fa; --line: #d1d9e0; --line-2: #e6eaef;\r\n    --fg: #1f2328; --muted: #59636e; --muted-2: #818b98;\r\n    --accent: #0969da; --accent-strong: #0550ae; --sel: #ddf4ff; --selline: #54aeff; --flash: #b6e3ff;\r\n    --ok: #1a7f37; --stop: #9a6700; --draft: #59636e; --draft-line: #d1d9e0; --link: #0969da;\r\n    --plea: #59636e; --plea-bg: #f6f8fa; --plea-line: #d1d9e0;\r\n    --ask: #0969da; --ask-bg: #ddf4ff; --ask-line: #54aeff;\r\n    --fence: #d1242f; --fence-bg: #ffebe9;\r\n    --agent: #8250df; --agent-bg: #fbefff; --agent-line: #c297ff;\r\n    --add: #fbfcfd; --acline: #afb8c1; --new: #f6f8fa; --warn: #fff8c5; --warn-line: #d4a72c;\r\n    --font: -apple-system, BlinkMacSystemFont, \"Segoe UI\", \"Hiragino Sans\", \"Noto Sans JP\", \"Yu Gothic UI\", Meiryo, sans-serif;\r\n    --mono: ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, \"Cascadia Mono\", Consolas, \"BIZ UDGothic\", \"Liberation Mono\", monospace;\r\n    --shadow: 0 1px 0 rgba(31,35,40,.04);\r\n  }\r\n  @media (prefers-color-scheme: dark) {\r\n    :root:not([data-theme=\"light\"]) {\r\n      --bg: #0d1117; --card: #161b22; --surface-2: #1c2129; --line: #3d444d; --line-2: #2a3038;\r\n      --fg: #e6edf3; --muted: #9198a1; --muted-2: #6e7681;\r\n      --accent: #4493f8; --accent-strong: #79c0ff; --sel: #0c2d6b; --selline: #1f6feb; --flash: #1f6feb;\r\n      --ok: #3fb950; --stop: #d29922; --draft: #9198a1; --draft-line: #3d444d; --link: #4493f8;\r\n      --plea: #9198a1; --plea-bg: #1c2129; --plea-line: #3d444d;\r\n      --ask: #4493f8; --ask-bg: #0c2d6b; --ask-line: #1f6feb;\r\n      --fence: #f85149; --fence-bg: #3c1618;\r\n      --agent: #ab7df8; --agent-bg: #271052; --agent-line: #6e40c9;\r\n      --add: #12161c; --acline: #3d444d; --new: #1c2129; --warn: #272115; --warn-line: #9e6a03;\r\n      --shadow: none;\r\n    }\r\n  }\r\n  * { box-sizing: border-box; }\r\n  html { scroll-behavior: smooth; }\r\n  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }\r\n  body { background: var(--bg); color: var(--fg); font-family: var(--font); font-size: 14px;\r\n         line-height: 1.65; margin: 0; padding: 0 1.5rem 4rem; -webkit-font-smoothing: antialiased; }\r\n  a { color: var(--link); text-decoration: none; } a:hover { text-decoration: underline; }\r\n  main { max-width: 72rem; margin: 0 auto; }\r\n  h1 { font-size: 26px; line-height: 1.35; letter-spacing: -.01em; margin: 0 0 .5rem; }\r\n  h2 { font-size: 18px; line-height: 1.35; font-weight: 600; margin: 0 0 .75rem; }\r\n  h3 { font-size: 14px; font-weight: 600; margin: 1.5rem 0 .5rem; display: flex; align-items: center; gap: .5rem; }\r\n  h3::before { content: \"\"; width: 3px; height: 14px; background: var(--accent); border-radius: 2px; }\r\n  .sub { color: var(--muted); font-size: 12.5px; margin: 0 0 1rem; }\r\n  .banner { background: var(--warn); border: 1px solid var(--warn-line);\r\n            padding: .65rem .9rem; border-radius: 6px; font-size: 13px; margin-bottom: 1rem; }\r\n  section { background: var(--card); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow);\r\n            padding: 1rem 1.5rem 1.5rem; margin-bottom: 1rem; scroll-margin-top: 3.4rem; }\r\n  .tag { display: inline-block; font-size: 11.5px; color: var(--muted); background: var(--surface-2); border: 1px solid var(--line-2);\r\n         border-radius: 999px; padding: 0 .5rem; line-height: 18px; vertical-align: middle; margin-left: .5rem; font-weight: 400; white-space: nowrap; }\r\n  .note { font-size: 12.5px; color: var(--muted); margin: .75rem 0 0; }\r\n\r\n  /* 目次（追従） */\r\n  nav.toc { position: sticky; top: 0; z-index: 5; background: var(--bg); border-bottom: 1px solid var(--line);\r\n            margin: 0 -1.5rem 1.5rem; padding: .5rem 1.5rem; font-size: 12.5px; }\r\n  nav.toc ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: .25rem; align-items: center; }\r\n  nav.toc a { color: var(--muted); text-decoration: none; padding: 2px 10px; border-radius: 999px; }\r\n  nav.toc a:hover, nav.toc a:focus-visible { background: var(--sel); color: var(--accent-strong); font-weight: 600; text-decoration: none; }\r\n  nav.toc .here { margin-left: auto; color: var(--muted-2); }\r\n\r\n  /* 表: 縦罫を捨て、横罫だけ */\r\n  .wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 6px; }\r\n  table { border-collapse: collapse; width: 100%; font-size: 13px; line-height: 1.5; }\r\n  .wrap.wide table { min-width: 1080px; }\r\n  th, td { padding: 7px 10px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--line-2); }\r\n  th { font-size: 11.5px; font-weight: 600; color: var(--muted); background: var(--surface-2); white-space: nowrap;\r\n       border-bottom: 1px solid var(--line); letter-spacing: .02em; }\r\n  tr:last-child td { border-bottom: 0; }\r\n  td.nw, .s-t, .s-s, .s-d, .s-n { white-space: nowrap; }\r\n  td.nw { font-family: var(--mono); font-size: 12px; color: var(--muted); }\r\n  th.add, td.add { background: var(--add); }\r\n  th.add { border-top: 2px solid var(--acline); }\r\n  th.ac, td.ac { border-left: 1px solid var(--line); }\r\n  tr.sel td { background: var(--sel) !important; box-shadow: inset 3px 0 0 var(--accent); }\r\n  tr[hidden] { display: none; }\r\n  code { font-family: var(--mono); font-size: .93em; background: var(--surface-2); border: 1px solid var(--line-2);\r\n         padding: 0 .35rem; border-radius: 4px; }\r\n  .s-t, .s-s, .s-d, .s-n { font-size: 12.5px; }\r\n  .s-t::before, .s-s::before, .s-d::before, .s-n::before { display: inline-block; width: 14px; font-size: 11px; }\r\n  .s-t { color: var(--ok); font-weight: 600; }   .s-t::before { content: \"✓\"; }\r\n  .s-s { color: var(--stop); font-weight: 600; } .s-s::before { content: \"■\"; }\r\n  .s-d { color: var(--draft); font-weight: 500; } .s-d::before { content: \"○\"; }\r\n  .s-n { color: var(--muted-2); }                 .s-n::before { content: \"–\"; }\r\n  .me td { font-weight: 600; }\r\n\r\n  /* 仕組みの印: 塗ったチップ＋先頭記号。破れない 柵 だけ枠を太く */\r\n  .mech { display: inline-block; font-size: 11.5px; line-height: 18px; padding: 0 .45rem 0 .4rem; border-radius: 4px; border: 1px solid;\r\n          white-space: nowrap; font-weight: 600; }\r\n  .mech::before { font-size: 10px; margin-right: 4px; }\r\n  .mech.fence { color: var(--fence); background: var(--fence-bg); border-color: var(--fence); border-width: 1.5px; } .mech.fence::before { content: \"⊘\"; }\r\n  .mech.ask   { color: var(--ask);   background: var(--ask-bg);   border-color: var(--ask-line); }   .mech.ask::before   { content: \"?\"; }\r\n  .mech.plea  { color: var(--plea);  background: var(--plea-bg);  border-color: var(--plea-line); }  .mech.plea::before  { content: \"·\"; font-size: 14px; }\r\n  .mech.agent { color: var(--agent); background: var(--agent-bg); border-color: var(--agent-line); } .mech.agent::before { content: \"⇢\"; }\r\n  .mech.none  { color: var(--muted-2); border-color: var(--line); font-weight: 400; }\r\n\r\n  /* 飛ぶリンク */\r\n  a.jump { color: inherit; cursor: pointer; text-decoration: underline; text-decoration-color: var(--selline); text-underline-offset: 3px; }\r\n  a.jump:hover { text-decoration-color: var(--accent); background: var(--sel); }\r\n  a.jump:focus-visible, .part:focus-visible, svg a:focus-visible > * { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }\r\n  a.jump::after { content: \"↗\"; color: var(--accent); margin-left: .2rem; font-size: 11px; }\r\n\r\n  /* 図: 枠は持たず地だけ */\r\n  figure.dia { margin: .75rem 0 .5rem; background: var(--surface-2); border: 0;\r\n               border-radius: 6px; padding: .75rem; overflow-x: auto; }\r\n  figure.dia svg { display: block; width: 100%; height: auto; margin: 0 auto; }\r\n  .nd { fill: var(--card); stroke: var(--draft-line); stroke-width: 1.5; }\r\n  .nd.st-t { stroke: var(--ok); stroke-width: 2; }\r\n  .nd.st-s { stroke: var(--stop); stroke-width: 2; }\r\n  .nd.st-d { stroke: var(--draft); stroke-width: 1.5; stroke-dasharray: 5 4; }\r\n  .nd.st-n { stroke: var(--line); stroke-width: 1.5; }\r\n  svg a { cursor: pointer; }\r\n  svg a:hover .nd { fill: var(--sel); }\r\n  svg a.sel .nd { fill: var(--sel); stroke: var(--accent); stroke-width: 2.5; stroke-dasharray: none; }\r\n  .lbl { fill: var(--fg); font: 13px var(--font); text-anchor: middle; pointer-events: none; }\r\n  .lbl.sm { font-size: 11px; fill: var(--muted); }\r\n  .lbl.b { font-weight: 600; }\r\n  .eg { stroke: var(--muted-2); stroke-width: 1.5; fill: none; }\r\n  .eg.dash { stroke-dasharray: 2 4; stroke-linecap: round; }\r\n  .lane { fill: var(--card); stroke: var(--line); }\r\n  .lane-t { fill: var(--muted-2); font: 600 10.5px var(--font); letter-spacing: .04em; }\r\n  .shared { fill: var(--card); stroke: var(--acline); stroke-width: 1.5; stroke-dasharray: 2 3; }\r\n  .legend { font-size: 12px; color: var(--muted); display: flex; gap: .3rem .9rem; flex-wrap: wrap;\r\n            margin: .4rem 0 0; align-items: center; }\r\n  .legend .g { font-weight: 600; color: var(--fg); }\r\n  .legend .k { display: inline-block; width: 18px; height: 11px; border: 2px solid; border-radius: 3px;\r\n               margin-right: 5px; vertical-align: -1px; }\r\n  .legend .k.t { border-color: var(--ok); }\r\n  .legend .k.s { border-color: var(--stop); }\r\n  .legend .k.d { border-style: dashed; border-width: 1.5px; border-color: var(--draft); }\r\n  .legend .k.n { border-width: 1.5px; border-color: var(--line); }\r\n  .legend .ln { display: inline-block; width: 22px; border-top: 2px dotted var(--muted-2); margin-right: 5px; vertical-align: middle; }\r\n  .legend .ln.solid { border-top: 1.5px solid var(--muted-2); }\r\n  /* 階層: パンくず（現在地だけ塗る）・深さバッジ・サブフローを持つノードは枠を太く */\r\n  .crumb { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; margin: 0 0 .5rem; }\r\n  .crumb span { border: 1px solid var(--selline); background: var(--sel); color: var(--accent-strong); border-radius: 999px; padding: 1px 10px; white-space: nowrap; }\r\n  .crumb span.here { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }\r\n  .crumb i { color: var(--muted-2); font-style: normal; }\r\n  .crumb .depth { margin-left: 8px; border: 0; font-size: 11px; font-weight: 600; color: var(--accent); background: var(--sel); }\r\n  .nd.dd { stroke-width: 2.5; }\r\n  .ddm { fill: var(--accent); font: 600 10px var(--font); text-anchor: end; pointer-events: none; }\r\n  .stm { font: 600 11px var(--font); text-anchor: end; pointer-events: none; }\r\n  /* ノードID: 図・表・逆引きで同じ形 */\r\n  .nid { display: inline-block; font: 600 11px/16px var(--mono); color: var(--muted); background: var(--surface-2); border: 1px solid var(--line);\r\n         border-radius: 3px; padding: 0 5px; min-width: 22px; text-align: center; vertical-align: 1px; }\r\n  tr.sel .nid { color: var(--accent-strong); border-color: var(--accent); background: var(--card); }\r\n  .nidr { fill: var(--surface-2); stroke: var(--line); stroke-width: 1; }\r\n  .nidt { fill: var(--muted); font: 600 10.5px var(--mono); text-anchor: middle; pointer-events: none; }\r\n  svg a.sel .nidr { stroke: var(--accent); fill: var(--card); } svg a.sel .nidt { fill: var(--accent-strong); }\r\n  /* 列グループの見出し行（図から／転記） */\r\n  tr.grp th { color: var(--muted-2); background: var(--card); text-align: center; border-bottom: 1px solid var(--line-2); padding: 4px 10px; }\r\n  tr.grp th.add { color: var(--muted); background: var(--add); border-bottom: 2px solid var(--acline); }\r\n  th.me, td.me { background: var(--sel); } th.me { color: var(--accent-strong); }\r\n  .hit { color: var(--ok); font-weight: 600; } .miss { color: var(--muted-2); }\r\n  /* 図の右に凡例・絞り込みを置く */\r\n  .dia-row { display: flex; gap: 1.5rem; align-items: flex-start; flex-wrap: wrap; margin: .75rem 0 .5rem; }\r\n  .dia-row figure.dia { flex: 1 1 58%; min-width: 20rem; margin: 0; }\r\n  .dia-row .side { flex: 1 1 30%; min-width: 16rem; }\r\n  .dia-row .side .legend { margin: 0 0 .6rem; }\r\n  .subs { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 12px; color: var(--muted); margin: 0 0 .6rem; }\r\n  .subs .chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--selline); background: var(--sel); color: var(--accent-strong); border-radius: 999px; padding: 1px 10px 1px 6px; }\r\n  .stm.t { fill: var(--ok); } .stm.s { fill: var(--stop); } .stm.d { fill: var(--draft); }\r\n\r\n  /* 状態の絞り込み */\r\n  .filter { display: flex; gap: .4rem; flex-wrap: wrap; align-items: center; font-size: 12.5px; color: var(--muted); margin: .75rem 0 .5rem; }\r\n  .filter button { font: inherit; background: var(--card); color: var(--fg); border: 1px solid var(--line);\r\n                   border-radius: 999px; padding: 2px 12px; cursor: pointer; }\r\n  .filter button[aria-pressed=\"true\"] { background: var(--fg); color: var(--card); border-color: var(--fg); font-weight: 600; }\r\n\r\n  /* ハーネス地図の処理カード */\r\n  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: .75rem; margin: .5rem 0; }\r\n  .card { border: 1px solid var(--line); border-radius: 6px; padding: .75rem 1rem; font-size: 13px; background: var(--card); }\r\n  .card.me { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }\r\n  .card h4 { margin: 0 0 .5rem; font-size: 14px; }\r\n  .card dl { margin: 0; display: grid; grid-template-columns: 4.5rem 1fr; gap: 3px 10px; }\r\n  .card dt { color: var(--muted-2); font-size: 12px; padding-top: 1px; }\r\n  .card dd { margin: 0; }\r\n\r\n  /* 実ファイル: 左に行番号、帯はコード列に */\r\n  details.dsrc { background: none; margin: .5rem 0 1rem; border: 1px solid var(--line); border-radius: 6px; }\r\n  details.dsrc > summary { font-size: 12px; color: var(--muted); padding: .3rem .6rem; cursor: pointer; }\r\n  pre.mermaid { background: var(--surface-2); border: 0; border-top: 1px solid var(--line);\r\n                padding: .7rem .9rem; overflow-x: auto; font-size: 12.5px; margin: 0; font-family: var(--mono); }\r\n  details.file { border: 1px solid var(--line); border-radius: 6px; margin: .5rem 0; background: var(--surface-2); scroll-margin-top: 3.4rem; overflow: hidden; }\r\n  details.file > summary { cursor: pointer; padding: .5rem .75rem; font-size: 13px; font-family: var(--mono); }\r\n  details.file > summary:hover { background: var(--line-2); }\r\n  summary .meta { font-family: var(--font); color: var(--muted-2); font-size: 12px; margin-left: .5rem; }\r\n  /* 行は .ln で1行ずつ持つ。pre の改行は white-space: normal で潰し、行の中だけ pre にする（二重の空行を防ぐ）。行番号は CSS カウンタ */\r\n  pre.src { margin: 0; border-top: 1px solid var(--line); background: var(--card); padding: .5rem 0;\r\n            overflow-x: auto; font-size: 12.5px; line-height: 1.6; font-family: var(--mono);\r\n            white-space: normal; counter-reset: ln; }\r\n  pre.src .ln { display: block; white-space: pre; padding: 0 1rem 0 0; min-height: 1.6em; counter-increment: ln; }\r\n  pre.src .ln::before { content: counter(ln); display: inline-block; width: 44px; text-align: right; margin-right: 14px;\r\n                        color: var(--muted-2); font-size: 11px; user-select: none; }\r\n  .part { display: block; position: relative; margin: 3px 0; padding: 0 0 3px; scroll-margin-top: 4rem; cursor: pointer; }\r\n  .part::after { content: \"\"; position: absolute; left: 52px; right: 0; top: 0; bottom: 0; z-index: 0;\r\n                 background: var(--sel); border-left: 3px solid var(--selline); border-radius: 0 4px 4px 0; }\r\n  .part > .ln { position: relative; z-index: 1; }\r\n  .part > .ln::before { color: var(--accent); }\r\n  .part::before { content: attr(data-label); position: relative; z-index: 1; display: block; padding: 3px 0 2px 72px;\r\n                  font: 600 11px/1.5 var(--font); color: var(--accent-strong); }\r\n  .part.flash::after { animation: flash 2.6s ease-out forwards; }\r\n  .part.sel::after { border-left-color: var(--accent); box-shadow: inset 0 0 0 1px var(--selline); }\r\n  @keyframes flash { 0%, 55% { background: var(--flash); } 100% { background: var(--sel); } }\r\n  @media (prefers-reduced-motion: reduce) { .part.flash::after { animation: none; background: var(--flash); } }\r\n\r\n  footer { color: var(--muted-2); font-size: 12px; margin-top: 2rem; }\r\n";
const JS = "\r\n// このページ内だけで完結する（外部読み込みは無い）。\r\n// 1) 表の「実装先／箇所」→ 実ファイルの該当部分を開いて光らせる\r\n// 2) 図のノード → 表の行を選択して飛ぶ\r\n// 3) 実ファイルの部分 → 図のノードと表の行を選択して飛ぶ\r\n// 4) 状態で行を絞り込む\r\n(function () {\r\n  function flash(el) {\r\n    var prev = document.querySelector('.part.flash');\r\n    if (prev) prev.classList.remove('flash');\r\n    void el.offsetWidth;\r\n    el.classList.add('flash');\r\n  }\r\n  function select(ref) {\r\n    document.querySelectorAll('.sel').forEach(function (e) { e.classList.remove('sel'); });\r\n    if (!ref) return;\r\n    // 属性名と = を分けて書く: lint は「data-node-id=」の並びを属性として拾うので、スクリプト内に並べない\r\n    document.querySelectorAll('[data-node-id' + '=\"' + ref + '\"]').forEach(function (e) { e.classList.add('sel'); });\r\n    document.querySelectorAll('svg a[data-ref=\"' + ref + '\"], .part[data-ref=\"' + ref + '\"]').forEach(function (e) { e.classList.add('sel'); });\r\n  }\r\n  function goTo(id) {\r\n    var target = document.getElementById(id);\r\n    if (!target) return;\r\n    var d = target.closest('details');\r\n    if (d) d.open = true;\r\n    target.scrollIntoView({ behavior: 'smooth', block: 'center' });\r\n    if (target.classList.contains('part')) flash(target);\r\n    if (target.hasAttribute('tabindex')) target.focus({ preventScroll: true });\r\n  }\r\n\r\n  document.addEventListener('click', function (e) {\r\n    var jump = e.target.closest ? e.target.closest('a.jump') : null;\r\n    if (jump) {\r\n      e.preventDefault();\r\n      var id = jump.getAttribute('data-goto');\r\n      var t = document.getElementById(id);\r\n      select(t && t.getAttribute('data-ref'));\r\n      goTo(id);\r\n      return;\r\n    }\r\n    var node = e.target.closest ? e.target.closest('svg a[data-ref]') : null;\r\n    if (node) {\r\n      e.preventDefault();\r\n      select(node.getAttribute('data-ref'));\r\n      goTo(node.getAttribute('href').slice(1));\r\n      return;\r\n    }\r\n    var part = e.target.closest ? e.target.closest('.part[data-ref]') : null;\r\n    if (part) {\r\n      var ref = part.getAttribute('data-ref');\r\n      select(ref);\r\n      goTo('r-' + ref);\r\n      return;\r\n    }\r\n    var btn = e.target.closest ? e.target.closest('.filter button') : null;\r\n    if (btn) {\r\n      var f = btn.getAttribute('data-filter');\r\n      btn.parentNode.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });\r\n      document.querySelectorAll('#t-steps tr[data-node-id], #t-gates tr[data-node-id]').forEach(function (tr) {\r\n        var st = tr.querySelector('.s-t, .s-s, .s-d');\r\n        tr.hidden = !!f && !(st && st.classList.contains(f));\r\n      });\r\n    }\r\n  });\r\n  // 実ファイルの部分は Enter でも飛べる（キーボード到達性）\r\n  document.addEventListener('keydown', function (e) {\r\n    if (e.key !== 'Enter') return;\r\n    var part = e.target.closest ? e.target.closest('.part[data-ref]') : null;\r\n    if (!part) return;\r\n    e.preventDefault();\r\n    select(part.getAttribute('data-ref'));\r\n    goTo('r-' + part.getAttribute('data-ref'));\r\n  });\r\n})();\r\n";

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** 転記の文は HTML を許す（<code> や <strong>）。エスケープしない代わりに、外部読み込みは lint が落とす */
const raw = (s) => String(s == null ? '' : s);

function fail(lines, code = 2) {
  process.stderr.write(lines.filter(Boolean).join('\n') + '\n');
  process.exit(code);
}

// ---------- 図を決定論で読む ----------
function parseMmd(src) {
  const nodes = []; const edges = []; const notes = {}; const durs = {}; let lane = null; const lanes = [];
  const SH = [
    [/^([0-9_]+)\(\["(.+?)"\]\)/, 'terminal'],
    [/^([0-9_]+)\[\["(.+?)"\]\]/, 'subroutine'],
    [/^([0-9_]+)\[\("(.+?)"\)\]/, 'database'],
    [/^([0-9_]+)\[\/"(.+?)"\/\]/, 'io'],
    [/^([0-9_]+)\["(.+?)"\]/, 'process'],
    [/^([0-9_]+)\{"(.+?)"\}/, 'decision'],
    [/^([0-9_]+)@\{\s*shape:\s*doc,\s*label:\s*"(.+?)"\s*\}/, 'document'],
  ];
  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.trim();
    let m;
    if ((m = /^subgraph\s+\S+\s+\["(.+?)"\]/.exec(line))) { lane = m[1]; lanes.push(lane); continue; }
    if (line === 'end') { lane = null; continue; }
    if ((m = /^%% note\[([0-9_]+)\]:\s*(.*)$/.exec(line))) { notes[m[1]] = m[2].replace(/\\n/g, '\n'); continue; }
    if ((m = /^%% duration\[([0-9_]+)\]:\s*(\d+)/.exec(line))) { durs[m[1]] = Number(m[2]); continue; }
    if (/^(%%|direction|flowchart|click|classDef|style|linkStyle|class )/.test(line)) continue;
    if ((m = /^([0-9_]+)\s+(-->|-\.->)\s*(?:\|"(.+?)"\|)?\s*([0-9_]+)$/.exec(line))) { edges.push({ from: m[1], kind: m[2], label: m[3] || '', to: m[4] }); continue; }
    for (const [re, type] of SH) {
      if ((m = re.exec(line))) { nodes.push({ id: m[1], type, label: m[2].replace(/<br\s*\/?>⏱.*$/, '').trim(), lane }); break; }
    }
  }
  for (const n of nodes) {
    const note = notes[n.id] || '';
    n.note = note.replace(/^lane:\s*\w+\n?/, '');
    n.dur = durs[n.id] || 0;
  }
  return { nodes, edges, lanes };
}
/** 生成行（click／classDef／style／linkStyle／class／rowOrder）を省いた原文。原文が正なので中身は変えない */
function stripGenerated(src) {
  return src.split(/\r?\n/).filter((l) => !/^\s*(click|classDef|style |linkStyle|class |%% rowOrder|%% Theme)/.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- 部品 ----------
const nid = (id) => `<span class="nid">${esc(id)}</span>`;
const mech = (m) => (!m || m === 'none') ? '<span class="mech none">—</span>' : `<span class="mech ${esc(m)}">${MECH[m] || esc(m)}</span>`;
const status = (s) => { const [cls, t] = STATUS[s] || STATUS.n; return `<span class="${cls}">${t}</span>`; };
const jump = (id, text) => `<a class="jump" href="#r-${esc(id)}" data-goto="r-${esc(id)}">${text}</a>`;
const jumps = (ids) => (ids || []).map((i) => jump(i, nid(i))).join(' ');

function crumb(k, map) {
  const chain = []; let c = k; while (c) { chain.unshift(c); c = map.parent[c]; }
  return `<div class="crumb">${chain.map((c, i) => `<span class="${i === chain.length - 1 ? 'here' : ''}">${c === 'root' ? esc(map.process) : esc(c) + ' ' + esc(map.titles[c] || '')}</span>`).join('<i>›</i>')}<span class="depth">階層 ${chain.length}</span></div>`;
}

function stepsTable(d, map) {
  const rows = d.nodes.map((n) => {
    const m = map.nodes[n.id] || { what: '未記録', mech: 'none', file: '未記録', where: '未記録', src: '—', status: 'd' };
    return `<tr data-node-id="${esc(n.id)}" id="r-${esc(n.id)}"><td>${nid(n.id)}</td><td>${esc(n.label)}<div class="note" style="margin:2px 0 0">${TYPE[n.type] || n.type}／${esc(n.lane || '')}${n.dur ? '／⏱ ' + n.dur + ' 分' : ''}</div></td><td>${status(m.status)}${m.evidence ? `<div class="note" style="margin:2px 0 0">${raw(m.evidence)}</div>` : ''}</td><td>${raw(m.what)}</td><td>${mech(m.mech)}</td><td>${m.file && m.file !== '—' ? `<code>${esc(m.file)}</code>` : '—'}</td><td>${raw(m.where)}</td><td class="nw">${raw(m.src)}</td></tr>`;
  }).join('\n');
  return `<div class="wrap wide"><table><thead><tr class="grp"><th colspan="3">図から（決定論）</th><th class="add" colspan="5">転記（実装.md・合格条件.md）</th></tr><tr><th>ノード</th><th>工程</th><th>状態</th><th class="add">何になったか</th><th class="add">仕組み</th><th class="add">実装先ファイル</th><th class="add">箇所</th><th class="add">転記元</th></tr></thead><tbody>\n${rows}\n</tbody></table></div>`;
}

/** root の SVG。レーンを横に並べ、レーン内はノードの出現順に左から置く（LR）。成果物は下段 */
function rootSvg(d, map) {
  const W = 118, H = 44, DW = 92, DH = 34, GAP = 20, PAD = 16, TOP = 60, BOT = 160;
  const laneNames = d.lanes.length ? d.lanes : ['—'];
  const byLane = {}; for (const ln of laneNames) byLane[ln] = { main: [], docs: [] };
  for (const n of d.nodes) { const l = byLane[n.lane || laneNames[0]] || byLane[laneNames[0]]; (n.type === 'document' || n.type === 'database' ? l.docs : l.main).push(n); }
  const pos = {}; let x = 10; const laneBoxes = [];
  for (const ln of laneNames) {
    const l = byLane[ln]; const x0 = x; let cx = x0 + PAD + 40;
    for (const n of l.main) { const w = n.type === 'terminal' ? 60 : n.type === 'decision' ? 104 : W; pos[n.id] = [cx + (w - 60) / 2, TOP]; cx += w + GAP; }
    let dx = x0 + PAD + 46;
    for (const n of l.docs) { pos[n.id] = [dx, BOT]; dx += DW + GAP; }
    const x1 = Math.max(cx, dx) + PAD - GAP;
    laneBoxes.push([ln, x0, x1]); x = x1 + 10;
  }
  const width = x + 10;
  const half = (n) => n.type === 'terminal' ? 30 : n.type === 'decision' ? 52 : n.type === 'document' || n.type === 'database' ? DW / 2 : W / 2;
  const top = (n) => n.type === 'decision' ? 30 : n.type === 'terminal' ? 16 : n.type === 'document' || n.type === 'database' ? DH / 2 : H / 2;
  const byId = Object.fromEntries(d.nodes.map((n) => [n.id, n]));
  const shape = (n, x, y, st) => {
    const cls = `nd st-${st}${n.type === 'subroutine' ? ' dd' : ''}`;
    if (n.type === 'terminal') return `<rect class="${cls}" x="${x - 30}" y="${y - 16}" width="60" height="32" rx="16"/>`;
    if (n.type === 'decision') return `<polygon class="${cls}" points="${x},${y - 30} ${x + 52},${y} ${x},${y + 30} ${x - 52},${y}"/>`;
    if (n.type === 'document') return `<path class="${cls}" d="M${x - DW / 2},${y - DH / 2} h${DW} v${DH - 6} q-${DW / 4},-10 -${DW / 2},0 q-${DW / 4},10 -${DW / 2},0 z"/>`;
    if (n.type === 'database') return `<rect class="${cls}" x="${x - DW / 2}" y="${y - DH / 2}" width="${DW}" height="${DH}" rx="12"/>`;
    const r = `<rect class="${cls}" x="${x - W / 2}" y="${y - H / 2}" width="${W}" height="${H}" rx="4"/>`;
    return n.type === 'subroutine' ? r + `<line class="eg" x1="${x - W / 2 + 6}" y1="${y - H / 2}" x2="${x - W / 2 + 6}" y2="${y + H / 2}"/><line class="eg" x1="${x + W / 2 - 6}" y1="${y - H / 2}" x2="${x + W / 2 - 6}" y2="${y + H / 2}"/>` : r;
  };
  let s = `<svg viewBox="0 0 ${width} 230" role="img" aria-label="処理「${esc(map.process)}」の第一階層。レーン ${laneNames.length}・ノード ${d.nodes.length}"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--muted-2)"/></marker></defs>`;
  for (const [t, x0, x1] of laneBoxes) s += `<rect class="lane" x="${x0}" y="14" width="${x1 - x0}" height="204" rx="6"/><text class="lane-t" x="${x0 + 10}" y="32">${esc(t)}</text>`;
  for (const e of d.edges) {
    const a = byId[e.from], b = byId[e.to]; if (!a || !b || !pos[a.id] || !pos[b.id]) continue;
    const [x1, y1] = pos[a.id], [x2, y2] = pos[b.id];
    const dash = e.kind === '-.->' ? ' dash' : '';
    let dpath, lx = (x1 + x2) / 2, ly = (y1 + y2) / 2 - 4;
    if (y1 === y2 && x2 > x1) dpath = `M${x1 + half(a)},${y1} H${x2 - half(b)}`;
    else if (y1 === y2) { dpath = `M${x1},${y1 - top(a)} V40 H${x2} V${y2 - top(b)}`; ly = 38; }
    else if (x1 === x2) dpath = `M${x1},${y1 + top(a)} V${y2 - top(b)}`;
    else dpath = `M${x1},${y1 + top(a)} V${y2 - top(b) - 12} H${x2} V${y2 - top(b)}`;
    s += `<path class="eg${dash}" d="${dpath}" marker-end="url(#ah)"/>`;
    if (e.label) s += `<text class="lbl sm" x="${lx}" y="${ly}">${esc(e.label)}</text>`;
  }
  for (const n of d.nodes) {
    const [x, y] = pos[n.id]; const st = (map.nodes[n.id] || {}).status || 'd';
    const lbl = n.label.length > 10 ? [n.label.slice(0, 9), n.label.slice(9, 19)] : [n.label];
    s += `<a href="#r-${esc(n.id)}" data-ref="${esc(n.id)}" aria-label="ノード ${esc(n.id)} ${esc(n.label)}">${shape(n, x, y, st)}` +
      lbl.map((t, i) => `<text class="lbl${n.type === 'subroutine' ? ' b' : ''}" x="${x}" y="${y + (lbl.length === 1 ? 4 : i * 14 - 3)}">${esc(t)}</text>`).join('') +
      `<rect class="nidr" x="${x - 14}" y="${y - top(n) - 16}" width="28" height="14" rx="3"/><text class="nidt" x="${x}" y="${y - top(n) - 5}">${esc(n.id)}</text>` +
      `<text class="stm ${st}" x="${x + half(n) - 4}" y="${y - top(n) + 12}">${st === 't' ? '✓' : st === 's' ? '■' : '○'}</text></a>`;
  }
  return s + '</svg>';
}

function excerptHtml(e, cwd) {
  const file = path.resolve(cwd, e.file);
  if (!fs.existsSync(file)) fail([`harness-view-build: 抜粋のファイルが無い: ${e.file}`]);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const from = Math.max(1, e.from | 0), to = Math.min(lines.length, e.to | 0);
  if (to - from + 1 > 40) fail([`harness-view-build: 抜粋は1箇所 40 行まで（${e.file} ${from}〜${to} 行）。効いている部分だけに絞る`]);
  const id = 'p-' + e.file.replace(/[^A-Za-z0-9]/g, '-') + '-' + e.ref + '-' + from;
  return `<span class="part" id="${id}" data-ref="${esc(e.ref)}" data-label="${esc(e.label)}（${from}〜${to}行）" tabindex="0" style="counter-reset: ln ${from - 1}">` +
    lines.slice(from - 1, to).map((l) => `<span class="ln">${esc(l)}</span>`).join('') + `</span>`;
}

// ---------- 組み立て ----------
function build(map, diagrams, cwd) {
  const keys = Object.keys(diagrams);
  if (!keys.includes('root')) fail(['harness-view-build: diagrams.json に "root" が無い（get_project の content.diagrams をそのまま入れる）']);
  const order = ['root', ...keys.filter((k) => k !== 'root').sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))];
  const parsed = {};
  for (const k of order) { const src = String(diagrams[k]); parsed[k] = { key: k, ...parseMmd(src), mmd: stripGenerated(src) }; }
  map.parent = map.parent || {}; map.titles = map.titles || {}; map.nodes = map.nodes || {};

  const stepsSection = order.map((k) => {
    const d = parsed[k];
    const subs = d.nodes.filter((n) => n.type === 'subroutine' && parsed[n.id]);
    return `<h3 id="d-${esc(k)}">${k === 'root' ? '第一階層（root）' : `子図 ${esc(k)}`} ${esc(map.titles[k] || (k === 'root' ? map.process : ''))}<span class="tag">ノード ${d.nodes.length}・エッジ ${d.edges.length}・レーン ${d.lanes.length}</span></h3>
${crumb(k, map)}
${k === 'root' ? `<div class="dia-row"><figure class="dia">${rootSvg(d, map)}</figure><div class="side">
<div class="legend"><span class="g">枠の色と印＝状態</span><span><span class="k t"></span>✓ 通った</span><span><span class="k s"></span>■ 止まった</span><span><span class="k d"></span>○ 設計のみ</span></div>
<div class="legend"><span class="g">線</span><span><span class="ln solid"></span>制御（実線）</span><span><span class="ln"></span>データ・人との受け渡し（点線）</span></div>
<div class="legend"><span class="g">形＝種別</span><span>角丸＝開始／終了</span><span>角＝作業</span><span>二重線＝サブプロセス（子図あり）</span><span>ひし形＝分岐</span><span>底が波＝成果物</span></div>
${subs.length ? `<div class="subs">子図: ${subs.map((n) => `<span class="chip">${nid(n.id)} ${esc(map.titles[n.id] || n.label)}</span>`).join('')}</div>` : ''}
<div class="filter" role="group" aria-label="状態で絞り込む">絞り込み: <button data-filter="" aria-pressed="true">すべて</button><button data-filter="s-t" aria-pressed="false">通った</button><button data-filter="s-s" aria-pressed="false">止まった</button><button data-filter="s-d" aria-pressed="false">設計のみ</button></div>
</div></div>` : ''}
${stepsTable(d, map)}
<details class="dsrc"><summary>Mermaid 原文（DrillSpark から取得。生成行 click／classDef／style／linkStyle は省略）</summary><pre class="mermaid">${esc(d.mmd)}</pre></details>`;
  }).join('\n');

  const hm = map.harnessMap || {};
  const cards = (hm.cards || []).map((c) => `<div class="card${c.me ? ' me' : ''}"><h4>${raw(c.name)}${c.me ? ' <span class="tag">この1枚</span>' : ''}</h4><dl><dt>状態</dt><dd>${raw(c.state)}</dd><dt>起動</dt><dd>${raw(c.start)}</dd><dt>成果物</dt><dd>${raw(c.products)}</dd><dt>介入点</dt><dd>${raw(c.gates)}</dd></dl></div>`).join('');
  const procs = (hm.cards || []).map((c) => c.short || c.name);
  const shared = (hm.shared || []).length ? `<h3>共有部品（ハーネスに1つしかないもの）</h3><div class="wrap"><table><thead><tr><th>部品</th><th>どこ</th>${procs.map((p) => `<th>${raw(p)}</th>`).join('')}</tr></thead><tbody>${hm.shared.map((r) => `<tr><td>${raw(r.part)}</td><td>${raw(r.where)}</td>${(r.cols || []).map((c) => `<td class="${/^(—|無し|書かない|呼ばない|読まない|判定しない)/.test(String(c)) ? 'miss' : 'hit'}">${raw(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="note">共有部品: 無し</p>';
  const harnessMap = `<p class="note" style="margin:0 0 .6rem">${raw(hm.note || '')}</p><div class="cards">${cards || '<div class="card">処理一覧: 無し</div>'}</div>${shared}${hm.totals ? `<p class="note">${raw(hm.totals)}</p>` : ''}`;

  const gates = (map.gates || []).length ? `<div class="wrap"><table id="t-gates"><thead><tr><th>種別</th><th>図・ノード</th><th>どのファイルのどこで止まるか</th><th>仕組み</th><th>実測</th></tr></thead><tbody>${map.gates.map((g) => `<tr><td><strong>${raw(g.kind)}</strong></td><td>${jumps(g.nodes)}${g.nodesNote ? ' ' + raw(g.nodesNote) : ''}</td><td>${raw(g.where)}</td><td>${mech(g.mech)}</td><td>${status(g.status)}</td></tr>`).join('')}</tbody></table></div>${map.gatesNote ? `<p class="note">${raw(map.gatesNote)}</p>` : ''}` : '<p>無し</p>';

  const t = map.tests || {};
  const tests = `${t.note ? `<p class="sub" style="margin:0 0 .6rem">${raw(t.note)}</p>` : ''}${(t.rows || []).length ? `<div class="wrap"><table><thead><tr>${(t.head || ['#', '条件', 'テストデータ', '期待', '結果']).map((h) => `<th>${raw(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="nw"' : ''}>${raw(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p>無し</p>'}${t.footnote ? `<p class="note">${raw(t.footnote)}</p>` : ''}`;

  const p = map.products || {};
  const products = (p.rows || []).length ? `<div class="wrap"><table><thead><tr>${(p.head || ['#', 'パス', '種別', '由来（レーン／ノード）', '実際はどこになったか']).map((h) => `<th>${raw(h)}</th>`).join('')}</tr></thead><tbody>${p.rows.map((r) => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="nw"' : ''}>${Array.isArray(c) ? jumps(c) : raw(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${p.note ? `<p class="note">${raw(p.note)}</p>` : ''}` : '<p>無し</p>';

  const byFile = {};
  for (const [id, m] of Object.entries(map.nodes)) { if (!m.file || m.file === '—') continue; (byFile[m.file] = byFile[m.file] || []).push([id, m]); }
  const filesIndex = Object.keys(byFile).length ? `<div class="wrap"><table><thead><tr><th>ファイル</th><th>部分</th><th>担う作業（ノード）</th><th>仕組み</th></tr></thead><tbody>${Object.entries(byFile).map(([f, list]) => {
    const parts = {}; for (const [id, m] of list) (parts[m.where || '—'] = parts[m.where || '—'] || []).push([id, m.mech]);
    return Object.entries(parts).map(([w, ids], i) => `<tr>${i === 0 ? `<td rowspan="${Object.keys(parts).length}"><code>${esc(f)}</code></td>` : ''}<td>${raw(w)}</td><td>${jumps(ids.map(([id]) => id))}</td><td>${[...new Set(ids.map(([, mm]) => mm || 'none'))].map(mech).join(' ')}</td></tr>`).join('');
  }).join('')}</tbody></table></div>` : '<p>無し</p>';

  const exByFile = {};
  for (const e of map.excerpts || []) (exByFile[e.file] = exByFile[e.file] || []).push(e);
  const src = Object.keys(exByFile).length ? Object.entries(exByFile).map(([f, list]) => `<details class="file" id="f-${f.replace(/[^A-Za-z0-9]/g, '-')}"><summary>${esc(f)}<span class="meta">抜粋 ${list.length} 箇所（効いている部分だけ。全文は埋め込まない）</span></summary><pre class="src">${list.map((e) => excerptHtml(e, cwd)).join('')}</pre></details>`).join('\n') : '<p>無し</p>';

  const toc = [['s-purpose', '目的'], ['s-harness', 'ハーネス全体'], ['s-steps', '工程 → 実装先'], ['s-gates', '介入点'], ['s-tests', '合格条件'], ['s-products', '成果物'], ['s-files', 'ファイル → ノード'], ['s-src', '実ファイル'], ['s-open', '未完']];

  return `<!doctype html>
<!-- 直し: __COUNT__/${LIMIT} -->
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(map.harness)} ／ ${esc(map.process)} — 可視化</title>
<style>${CSS}</style>
</head>
<body>
<main>
<nav class="toc" aria-label="目次"><ul>${toc.map(([id, t]) => `<li><a href="#${id}">${t}</a></li>`).join('')}<li class="here">処理「${esc(map.process)}」／ ${esc(map.date)}</li></ul></nav>
<h1>${esc(map.harness)} ／ ${esc(map.process)}</h1>
<p class="sub">${raw(map.materials || '')}</p>
${map.banner ? `<div class="banner">${raw(map.banner)}</div>` : ''}
<section data-section="目的" id="s-purpose"><h2>目的<span class="tag">転記元: 設計.md 1節</span></h2><p>${raw(map.purpose || '無し')}</p></section>
<section data-section="処理一覧" id="s-harness"><h2>ハーネス全体と処理一覧<span class="tag">転記元: 設計.md 2節・統合.md・各処理の 実装.md 2節</span></h2>${harnessMap}</section>
<section data-section="工程" id="s-steps"><h2>工程 → 実装先<span class="tag">図 ${order.length} 枚（決定論で抽出）＋ 実装.md 1節の転記</span></h2>
<p class="note" style="margin:0 0 .5rem">左3列は図から機械で取った（手で数えていない）。右5列は <code>実装.md</code> と <code>合格条件.md</code> からの転記で、実ファイルを読んで埋め直していない。行の <code>data-node-id</code> は全図で一意。</p>
<div id="t-steps">${stepsSection}</div></section>
<section data-section="介入点" id="s-gates"><h2>人間の介入点（5種）<span class="tag">転記元: 合格条件.md 5節・図.md</span></h2>${gates}</section>
<section data-section="合格条件" id="s-tests"><h2>合格条件${t.tag ? `<span class="tag">${raw(t.tag)}</span>` : ''}</h2>${tests}</section>
<section data-section="成果物" id="s-products"><h2>成果物<span class="tag">転記元: 実装.md 1節・合格条件.md 1節</span></h2>${products}</section>
<section data-section="ファイル→ノード" id="s-files"><h2>ファイル → ノード（逆引き）</h2>${filesIndex}</section>
<section data-section="実ファイル" id="s-src"><h2>実ファイル<span class="tag">効いている部分の抜粋。1ファイル最大 40 行</span></h2><p class="note" style="margin:0 0 .5rem">部分をクリック（または Enter）すると図のノードと表の行が選択されて戻れる。</p>${src}</section>
<section data-section="未完" id="s-open"><h2>未完</h2>${(map.open || []).length ? `<ul>${map.open.map((o) => `<li>${raw(o)}</li>`).join('')}</ul>` : '<p>無し</p>'}<p>出典: <a href="https://drillspark.io/">DrillSpark</a></p></section>
<footer>1ファイル完結・外部読み込みゼロ ／ 必須の節7つ＋任意の節3つ ／ <code>data-node-id</code> は表の行だけ（図と逆引きは <code>data-ref</code>）／ 生成: harness-view-build</footer>
</main>
<script>${JS}</script>
</body>
</html>
`;
}

// ---------- 入口 ----------
function main() {
  const mapPath = process.argv[2];
  if (!mapPath) fail(['使い方: node harness-view-build.js <処理名>-<日付>.map.json（同じフォルダに <処理名>-<日付>.diagrams.json）'], 1);
  const base = mapPath.replace(/\.map\.json$/i, '');
  if (base === mapPath) fail(['harness-view-build: 入力は *.map.json の名前にする（出力の名前がそこから決まる）']);
  const diagPath = base + '.diagrams.json';
  const outPath = base + '.html';
  let map, diagrams;
  try { map = JSON.parse(fs.readFileSync(mapPath, 'utf8')); } catch (e) { fail([`harness-view-build: map.json が読めない: ${e.message}`]); }
  if (!fs.existsSync(diagPath)) fail([`harness-view-build: 図の JSON が無い: ${path.basename(diagPath)}（get_project の content.diagrams をそのまま Write する）`]);
  try { diagrams = JSON.parse(fs.readFileSync(diagPath, 'utf8')); } catch (e) { fail([`harness-view-build: diagrams.json が読めない: ${e.message}`]); }
  if (diagrams && diagrams.content && diagrams.content.diagrams) diagrams = diagrams.content.diagrams;
  if (diagrams && diagrams.diagrams) diagrams = diagrams.diagrams;

  const missing = ['harness', 'process', 'date', 'purpose'].filter((k) => !map[k]);
  if (missing.length) fail([`harness-view-build: map.json に必須の項目が無い: ${missing.join(', ')}`]);
  if (!map.nodes || typeof map.nodes !== 'object') fail(['harness-view-build: map.json の nodes が無い（ノードID → {what, mech, file, where, src, status}）']);

  const cwd = process.cwd();
  let html = build(map, diagrams, cwd);

  // 回数欄: 新規は 0、既存があれば その値＋1（上限は柵が見る）
  let count = 0;
  if (fs.existsSync(outPath)) {
    const m = /<!--\s*直し:\s*(\d+)\s*\/\s*\d+\s*-->/.exec(fs.readFileSync(outPath, 'utf8').slice(0, 4000));
    if (!m) fail([`harness-view-build: ${path.basename(outPath)} は既にあり回数欄が無い。既存の1枚は上書きしない — 日付か連番を変えた名前にする`]);
    count = Number(m[1]) + 1;
  }
  // 置き場が契約どおり（docs/harness/<名>/可視化/）なら柵も同じことを見る。外に書く場合も上限だけはここで守る
  if (count > LIMIT) fail([`harness-view-build: 直しは上限 ${LIMIT} 回（今回で ${count} 回目）。これ以上直さない — 何がどう落ちたかを添えてオーナーへ報告する。`]);
  html = html.replace('__COUNT__', String(count));

  // 書く前に柵を通す（Write と同じ検査: 上書き・回数欄・view-lint）
  const guard = path.join(__dirname, 'harness-view-guard.js');
  const g = spawnSync(process.execPath, [guard], { input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: outPath, content: html }, cwd }), encoding: 'utf8', env: { ...process.env, DRILLSPARK_HARNESS_GUARDS: '' } });
  if (g.status !== 0) fail([`harness-view-build: 柵に止められたので書かない（exit ${g.status}）。map.json か diagrams.json を直して再実行する。`, (g.stderr || g.stdout || '').trim()], g.status === 2 ? 2 : 1);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  const nodes = Object.keys(map.nodes).length;
  process.stdout.write(`OK  ${outPath}  ${Buffer.byteLength(html)} bytes  回数欄 ${count}/${LIMIT}  対応づけ ${nodes} ノード\n`);
}

main();
