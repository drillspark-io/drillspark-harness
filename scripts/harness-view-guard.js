#!/usr/bin/env node
/**
 * harness-view-guard — `harness-visualize` の1枚を書き出す瞬間に効く柵（PreToolUse hook）。
 *
 *   stdin: Claude Code の PreToolUse hook が渡す JSON（tool_name / tool_input）
 *   exit 0 = 通す / exit 2 = 止める（stderr の文面がそのままエージェントに渡る）
 *   環境変数 DRILLSPARK_HARNESS_GUARDS=off で柵を切る（全部 exit 0）
 *
 * 見るのは docs/harness/<ハーネス名>/可視化/*.html への Write / Edit と、
 * Bash で 可視化/*.html へ書く形（リダイレクト・tee・cp・mv）だけ。それ以外は素通し。
 *
 * 守るもの（指示ではなく柵にした理由: 3つとも「破られると1枚の信用が落ちる」規則で、
 * 長い会話の中で本文の指示は破れる）:
 *   1. 既存の1枚を上書きしない — 同じ処理・同じ日の2回目は連番（-2.html）を足す。
 *      これが可視化に承認ゲートを置かなくてよい根拠。
 *   2. 直しは上限2回 — 回数欄 `<!-- 直し: N/2 -->` を先頭に置き、書き直すたびに N を1つ進める。
 *      N が既存＋1 でなければ止める（同じ起動の直しだけを通し、別の起動の上書きを弾く）。
 *      柵に止められた回はファイルが書かれていないので、その直しでは N を進めない。
 *   3. lint（harness-view-lint.js）を通らない内容は書かせない — 書いてから直すのではなく、書く前に止める。
 *      Bash で書くと中身を見られないので、可視化/ への Bash の書き込みは形だけで止める。
 *
 * 依存なし（Node 標準の fs / path / child_process だけ）。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const LIMIT = 2;
const GUARDED = /(^|[\\/])docs[\\/]harness[\\/][^\\/]+[\\/]可視化[\\/][^\\/]+\.html$/;
const COUNT_RE = /<!--\s*直し:\s*(\d+)\s*\/\s*(\d+)\s*-->/;
/** Bash で 可視化/*.html へ書く形。宛先の形だけを見る（中身は見られない）。cp / mv は最後の引数（＝宛先）のときだけ */
const VIEW_FILE = '可視化[\\\\/][^\\s"\']+\\.html?';
const BASH_WRITES = new RegExp(
  `(?:^|[\\s;&|(])\\d?>>?\\s*["']?[^\\s"']*${VIEW_FILE}(?=$|[\\s"';&|)])` +
  `|\\btee\\b[^|;&]*${VIEW_FILE}(?=$|[\\s"';&|)])` +
  `|\\b(?:cp|mv)\\b[^|;&]*\\s\\S*${VIEW_FILE}["']?\\s*(?=$|[|;&]|\\d?>)`,
);

function stop(lines) {
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(2);
}

function countOf(html) {
  const m = COUNT_RE.exec(html.slice(0, 4000));
  return m ? Number(m[1]) : null;
}

function lintOf(html) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'harness-view-lint.js'), '-'], { input: html, encoding: 'utf8' });
  return { status: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}

function main() {
  if (process.env.DRILLSPARK_HARNESS_GUARDS === 'off') process.exit(0);
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    process.exit(0); // hook の入力が読めないときは判定しない（止めるのは可視化の1枚だけ）
  }
  // JSON としては読めても object でない入力（null / 配列 / 数値）で例外を吐かない
  if (!input || typeof input !== 'object' || Array.isArray(input)) process.exit(0);
  const tool = String(input.tool_name || '');
  const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};

  if (tool === 'Bash') {
    if (BASH_WRITES.test(String(ti.command || ''))) {
      stop(['harness-view-guard: 可視化の1枚は Write で書く — 柵が中身を見られるように（Bash のリダイレクト・tee・cp・mv では書かない）。']);
    }
    process.exit(0);
  }

  const file = String(ti.file_path || '');
  if (!file || !GUARDED.test(file)) process.exit(0);

  if (tool !== 'Write') {
    stop([
      `harness-view-guard: 可視化の1枚（${path.basename(file)}）は ${tool} で部分修正しない。`,
      '直すときは Write で全体を書き直し、先頭の回数欄 <!-- 直し: N/2 --> の N を1つ進める。',
    ]);
  }

  const content = String(ti.content || '');
  const next = countOf(content);
  if (next === null) {
    // 回数欄が無いときも lint は先に流し、指摘をまとめて返す（1つずつ返すと往復が増える）
    const r = lintOf(content);
    stop([
      'harness-view-guard: 先頭に回数欄が無い。<!doctype html> の直後に <!-- 直し: 0/2 --> を置く',
      '（初回は 0。書けた1枚を読み戻して直すたびに 1、2 と進める。止められた回は進めない）。',
      r.status === 2 ? 'あわせて view-lint の指摘も直してから Write する:' : '',
      r.status === 2 ? r.out : '',
    ].filter(Boolean));
  }

  const exists = fs.existsSync(file);
  if (!exists) {
    if (next !== 0) {
      stop([
        `harness-view-guard: 新しい1枚の回数欄は 0 から始める（いまは ${next}）。`,
        '別の起動の続きなら、上書きではなく連番を足した新しいファイル名にする。',
      ]);
    }
  } else {
    const prev = countOf(fs.readFileSync(file, 'utf8'));
    if (prev === null) {
      stop([
        `harness-view-guard: ${path.basename(file)} は既にある。既存の1枚は上書きしない。`,
        '同じ処理・同じ日の2回目は <処理名>-<日付>-2.html のように連番を足す。',
      ]);
    }
    if (next !== prev + 1) {
      stop([
        `harness-view-guard: 回数欄が進んでいない（既存 ${prev}/${LIMIT} → 今回 ${next}/${LIMIT}）。`,
        `同じ起動の直しなら ${prev + 1}/${LIMIT} にする。別の起動なら上書きせず連番を足す。`,
      ]);
    }
    if (next > LIMIT) {
      stop([
        `harness-view-guard: 直しは上限 ${LIMIT} 回（今回で ${next} 回目）。これ以上直さない。`,
        '何がどう落ちたかを添えてオーナーへ報告し、止まる。',
      ]);
    }
  }

  const lint = path.join(__dirname, 'harness-view-lint.js');
  const r = spawnSync(process.execPath, [lint, '-'], { input: content, encoding: 'utf8' });
  if (r.status === 0) process.exit(0);
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  if (r.status === 2) {
    stop([
      'harness-view-guard: view-lint に落ちたので書かない。指摘どおり HTML を直し、回数欄はそのままで Write し直す（止められた回は書かれていないので進めない）。',
      out,
    ]);
  }
  stop([
    `harness-view-guard: view-lint が実行エラー（exit ${r.status}）。HTML の直しでは消えない — 止めてオーナーへ報告する。`,
    out,
  ]);
}

main();
