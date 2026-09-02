#!/usr/bin/env node
/**
 * process-write-guard — 業務改善の表と1枚を書く瞬間に効く柵（PreToolUse hook）。
 *
 *   stdin: Claude Code の PreToolUse hook が渡す JSON（tool_name / tool_input / cwd）
 *   exit 0 = 通す / exit 2 = 止める（stderr の文面がそのままエージェントに渡る）
 *
 * 見るのは3つだけ。それ以外は素通し（他の skill の動作を邪魔しない）:
 *   1. `業務改善/*.md` への Write / Edit — 書いたあとの中身を process-table-lint に通し、落ちれば書かせない。
 *      同じフォルダに 業務一覧.md があれば突き合わせ（--list）も掛ける。表を持たない .md（教訓.md）は対象外
 *   2. `業務改善/*.html` への Write / Edit — process-plan-lint に通す。上書きは止めない（1枚は上書きが設計）
 *   3. Bash で `業務改善/` へリダイレクト（> >> tee）— 表は Write で書く（hook が中身を見られるように）
 *   4. DrillSpark の update_diagram — cwd に 業務改善/業務一覧.md があるとき、そのプロジェクトIDが
 *      一覧の「図の在りか」列に無ければ止める（他人が作ったプロジェクトを書き換えない、の柵）。
 *      自分で作った図は create_project の直後に URL を 図の在りか に書く
 *
 * 「書いてよい場所は 業務改善/ だけ」は本文のお願いのまま（全 Write を止めると他の skill が動かない）。
 * この柵が守るのは「業務改善/ に置かれるものは検査を通ったものだけ」。
 *
 * 依存なし（Node 標準の fs / path / child_process だけ）。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MD = /(^|[\\/])業務改善[\\/][^\\/]+\.md$/;
const HTML = /(^|[\\/])業務改善[\\/][^\\/]+\.html$/;

function stop(lines) {
  process.stderr.write(lines.filter(Boolean).join('\n') + '\n');
  process.exit(2);
}

function run(script, content, extra = []) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script), '-', ...extra], { input: content, encoding: 'utf8' });
  return { status: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}

/** Edit のあとの中身を組み立てる。組み立てられなければ null（そのときは止めない — Edit 自体が失敗する） */
function afterEdit(file, ti) {
  if (!fs.existsSync(file)) return null;
  let s = fs.readFileSync(file, 'utf8');
  const edits = Array.isArray(ti.edits) ? ti.edits.map((e) => [e.old_string ?? e.old_text, e.new_string ?? e.new_text])
    : [[ti.old_string, ti.new_string]];
  for (const [a, b] of edits) {
    if (typeof a !== 'string' || typeof b !== 'string' || !s.includes(a)) return null;
    s = ti.replace_all ? s.split(a).join(b) : s.replace(a, b);
  }
  return s;
}

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
  const tool = input.tool_name || '';
  const ti = input.tool_input || {};
  const cwd = input.cwd || process.cwd();

  // 3. Bash のリダイレクトで表を書かせない（`2>&1` や読むだけの Bash は止めない — 向き先が 業務改善/ のときだけ）
  if (tool === 'Bash') {
    const cmd = String(ti.command || '');
    if (/(?:^|[\s;&|(])\d?>>?\s*["']?[^\s"']*業務改善|\btee\b[^|;&]*業務改善/.test(cmd)) {
      stop(['process-write-guard: 業務改善/ のファイルは Bash のリダイレクトではなく Write で書く（書く前に表の検査を通すため）。']);
    }
    process.exit(0);
  }

  // 4. 他人の図を書き換えない
  if (/update_diagram$/i.test(tool)) {
    const list = path.join(cwd, '業務改善', '業務一覧.md');
    if (!fs.existsSync(list)) process.exit(0);
    const id = String(ti.project_id || '');
    if (id && !fs.readFileSync(list, 'utf8').includes(id)) {
      stop([
        'process-write-guard: このプロジェクトは 業務改善/業務一覧.md の「図の在りか」に無い。他人が作った図は読むだけで書き換えない。',
        '自分で作った図なら、create_project の直後にその URL を業務一覧の「図の在りか」列に書いてから update_diagram を呼ぶ。',
      ]);
    }
    process.exit(0);
  }

  const file = String(ti.file_path || '');
  const isMd = MD.test(file);
  const isHtml = HTML.test(file);
  if (!file || (!isMd && !isHtml)) process.exit(0);
  if (!['Write', 'Edit', 'MultiEdit'].includes(tool)) process.exit(0);

  const content = tool === 'Write' ? String(ti.content || '') : afterEdit(file, ti);
  if (content === null) process.exit(0);

  if (isMd) {
    // 表を持たない .md（教訓.md など）は検査の対象外。表の検査は表があるものだけに掛ける
    if (!/^\s*\|.*\|\s*$/m.test(content)) process.exit(0);
    const listPath = path.join(path.dirname(file), '業務一覧.md');
    const extra = path.basename(file) !== '業務一覧.md' && fs.existsSync(listPath) ? ['--list', listPath] : [];
    const r = run('process-table-lint.js', content, extra);
    if (r.status === 0) process.exit(0);
    if (r.status === 2) stop(['process-write-guard: 表の検査に落ちたので書かない。指摘どおり直してから書き直す。', r.out]);
    stop([`process-write-guard: 表の検査が実行エラー（exit ${r.status}）。直さずに利用者へ報告する。`, r.out]);
  }
  const r = run('process-plan-lint.js', content);
  if (r.status === 0) process.exit(0);
  if (r.status === 2) stop(['process-write-guard: 1枚の検査に落ちたので書かない。落ちた箇所だけ直してから書き直す。', r.out]);
  stop([`process-write-guard: 1枚の検査が実行エラー（exit ${r.status}）。直さずに利用者へ報告する。`, r.out]);
}

main();
