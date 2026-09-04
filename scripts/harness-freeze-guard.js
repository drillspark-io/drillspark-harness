#!/usr/bin/env node
/**
 * harness-freeze-guard — 凍結した合格条件を書き換える瞬間に効く柵（PreToolUse hook）。
 *
 *   stdin: Claude Code の PreToolUse hook が渡す JSON（tool_name / tool_input / cwd）
 *   exit 0 = 通す / exit 2 = 止める（stderr の文面がそのままエージェントに渡る）
 *   環境変数 DRILLSPARK_HARNESS_GUARDS=off で柵を切る（全部 exit 0）
 *
 * 見るのは `docs/harness/` 配下の 合格条件.md だけ。それ以外は素通し。
 *   1. Write / Edit / MultiEdit — 既存のファイルに「凍結」の語があれば凍結済み。書いたあとの中身で、
 *      番号付きの表の行（`| 3 | … |` — 成果物の一覧・合格条件・介入点）が1行でも変わるか消えていれば止める。
 *      行を足すのはよいが、そのときは「第N版」の N を上げる。凍結の語を消すのも止める
 *   2. Bash — 合格条件.md へのリダイレクト（> >> tee）、宛先が 合格条件.md の cp / mv / install と sed -i を止める
 *      （ファイルは Write / Edit で書く — hook が中身を見られるように）
 *
 * 凍結の意味を「番号付きの行は変えず消さず、足すだけ」に固定してある。
 * 条件を変えるなら、元の行を残したまま新しい番号の行で置き換える（「条件3を置き換える」と書く）。
 * 全面的に書き直すときは、利用者が DRILLSPARK_HARNESS_GUARDS=off を自分で付ける。
 *
 * 依存なし（Node 標準の fs だけ）。
 */

const fs = require('fs');

const TARGET = /(^|[\\/])docs[\\/]harness[\\/].*合格条件\.md$/i;
/** Bash: 宛先が docs/harness/…/合格条件.md の書き込み */
const BASH_WRITE = /(?:(?:^|[\s;&|(])\d?>>?\s*|\btee\b[^|;&]*\s|\b(?:cp|mv|install)\b[^|;&]*\s|\bsed\b[^|;&]*\s--?i[^|;&]*\s)["']?[^\s"'|;&]*docs[\\/]harness[\\/][^\s"'|;&]*合格条件\.md/i;
const NUMBERED_ROW = /^\|\s*\d+\s*\|/;
const FROZEN = /凍結/;
const VERSION = /第\s*(\d+)\s*版/;

function stop(lines) {
  process.stderr.write(lines.filter(Boolean).join('\n') + '\n');
  process.exit(2);
}

/** Edit / MultiEdit のあとの中身。組み立てられなければ null（そのときは止めない — Edit 自体が失敗する） */
function afterEdit(s, ti) {
  const edits = Array.isArray(ti.edits) ? ti.edits.map((e) => [e.old_string ?? e.old_text, e.new_string ?? e.new_text])
    : [[ti.old_string, ti.new_string]];
  for (const [a, b] of edits) {
    if (typeof a !== 'string' || typeof b !== 'string' || !s.includes(a)) return null;
    s = ti.replace_all ? s.split(a).join(b) : s.replace(a, b);
  }
  return s;
}

function numberedRows(s) {
  return s.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => NUMBERED_ROW.test(l));
}

function versionOf(s) {
  const m = VERSION.exec(s);
  return m ? Number(m[1]) : 1;
}

function main() {
  if (process.env.DRILLSPARK_HARNESS_GUARDS === 'off') process.exit(0);
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) process.exit(0);
  const tool = String(input.tool_name || '');
  const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};

  if (tool === 'Bash') {
    if (BASH_WRITE.test(String(ti.command || ''))) {
      stop(['harness-freeze-guard: 合格条件.md は Bash のリダイレクト・tee・cp・mv・sed -i ではなく Write / Edit で書く（凍結の検査を通すため）。']);
    }
    process.exit(0);
  }
  if (!['Write', 'Edit', 'MultiEdit'].includes(tool)) process.exit(0);
  const file = String(ti.file_path || '');
  if (!TARGET.test(file) || !fs.existsSync(file)) process.exit(0);

  const before = fs.readFileSync(file, 'utf8');
  if (!FROZEN.test(before)) process.exit(0);
  const after = tool === 'Write' ? String(ti.content || '') : afterEdit(before, ti);
  if (after === null) process.exit(0);

  const oldRows = numberedRows(before);
  const newRows = numberedRows(after);
  const newSet = new Set(newRows);
  const lost = oldRows.filter((r) => !newSet.has(r));
  const oldSet = new Set(oldRows);
  const added = newRows.filter((r) => !oldSet.has(r));

  const why = [];
  if (!FROZEN.test(after)) why.push('「凍結」の語が消えている。');
  if (lost.length) {
    why.push(`凍結済みの番号付きの行が ${lost.length} 行、変わるか消えている:`);
    for (const r of lost.slice(0, 5)) why.push('  ' + r);
    if (lost.length > 5) why.push(`  …ほか ${lost.length - 5} 行`);
  }
  if (added.length && versionOf(after) <= versionOf(before)) {
    why.push(`番号付きの行を ${added.length} 行足しているのに「第N版」が上がっていない（いまは 第${versionOf(before)}版）。`);
  }
  if (!why.length) process.exit(0);
  stop([
    'harness-freeze-guard: 合格条件.md は凍結されている。番号付きの行（成果物・合格条件・介入点）は変えず消さず、足すだけ。',
    ...why,
    '条件を変えるなら、元の行を残したまま新しい番号の行で置き換える（「条件3を置き換える」と書く）。足したら「第N版」を上げ、',
    '第N版で足したものを冒頭に書く。全面的に書き直すのは利用者の判断で、DRILLSPARK_HARNESS_GUARDS=off を付けて行う。',
  ]);
}

main();
