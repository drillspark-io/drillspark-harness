#!/usr/bin/env node
/**
 * process-write-guard — 業務改善の表と1枚を書く瞬間に効く柵（PreToolUse hook）。
 *
 *   stdin: Claude Code の PreToolUse hook が渡す JSON（tool_name / tool_input / cwd）
 *   exit 0 = 通す / exit 2 = 止める（stderr の文面がそのままエージェントに渡る）
 *   環境変数 DRILLSPARK_HARNESS_GUARDS=off で柵を切る（全部 exit 0）
 *
 * 見るのは4つだけ。それ以外は素通し（他の skill の動作を邪魔しない）:
 *   1. `業務改善/` 配下（サブフォルダ含む）の .md / .markdown への Write / Edit —
 *      書いたあとの中身を process-table-lint に通し、落ちれば書かせない。
 *      `業務改善/` 直下に 業務一覧.md があれば突き合わせ（--list）も掛ける。
 *      プラグインの固定名（業務一覧.md・改善案.md・AI化依頼書.md・保留.md）は中身に関係なく必ず検査する。
 *      それ以外の .md は、表を持たない（教訓.md）か、業務改善の表を1つも認識できない（lint が SYNTAX を返す
 *      別件の議事録など。空行で切れた続きの ORPHAN_ROW が伴ってもよい）なら対象外
 *   2. `業務改善/` 配下の .html / .htm への Write / Edit — process-plan-lint に通す。
 *      上書きは止めない（1枚は上書きが設計）。固定名 改善計画-*.html は印が無くても必ず検査し、
 *      それ以外で `data-block=` を1つも持たない HTML はこのプラグインの1枚ではないので対象外
 *   3. Bash — 見るのは書き込みの宛先だけ。`業務改善/` へのリダイレクト（> >> tee）、
 *      宛先が `業務改善/` の cp / mv / install と sed -i、それに cwd が 業務改善/ 配下か
 *      コマンドに `cd …業務改善` があるときのファイルへのリダイレクトを止める
 *      （表は Write で書く — hook が中身を見られるように）。語が含まれるだけでは止めない。
 *      加えて、`業務改善/` のパスを含む python / perl / ruby / php の実行、`node -e`、PowerShell の
 *      書き込みコマンドレット（Set-Content / Out-File / Add-Content）も止める — 実際に python のヒアドキュメントで
 *      業務一覧.md が書き換えられ、表の検査が走らなかった。`node <ファイル>` は lint の呼び方なので止めない
 *   4. DrillSpark の update_diagram — cwd に 業務改善/業務一覧.md か docs/harness/ があるとき、
 *      そのプロジェクトIDが 業務一覧.md（「図の在りか」列）にも docs/harness/ 配下の .md にも無ければ止める
 *      （他人が作ったプロジェクトを書き換えない、の柵）。自分で作った図は create_project の直後に URL を書く —
 *      process-improve は 業務一覧.md の「図の在りか」、harness-implement は 処理/<処理名>/図.md、
 *      harness-improve は 改善/<日付>.md。ハーネスの図の URL を 業務一覧.md に書くと、あの列の「改善後:」は
 *      業務の改善後の図として読まれるので、案内文で置き場を分けている
 *
 * 「書いてよい場所は 業務改善/ だけ」は本文のお願いのまま（全 Write を止めると他の skill が動かない）。
 * この柵が守るのは「Write / Edit で 業務改善/ に置かれる表と1枚は検査を通ったものだけ」で、
 * Bash はリダイレクト・tee・cp/mv/install・sed -i の宛先と、上のスクリプト実行だけを見る。
 *
 * 依存なし（Node 標準の fs / path / child_process だけ）。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MD = /(^|[\\/])業務改善[\\/].+\.(md|markdown)$/i;
const HTML = /(^|[\\/])業務改善[\\/].+\.html?$/i;
/** パスを 業務改善 セグメントまで遡る（サブフォルダの表でも一覧は 業務改善/ 直下にある） */
const ROOT = /^(.*(?:^|[\\/])業務改善)[\\/]/;

/** Bash: 宛先が 業務改善/ のもの。語の直後にパス区切りを必須にして「業務改善」を含むだけの commit や grep を止めない */
const REDIRECT_TO = /(?:^|[\s;&|(])\d?>>?\s*["']?[^\s"']*業務改善[\\/]|\btee\b[^|;&]*業務改善[\\/]/;
/** cp / mv / install は 業務改善/ の引数が最後（＝宛先）のときだけ。元ファイルが 業務改善/ の cp は止めない */
const COPY_TO = /\b(?:cp|mv|install)\b[^|;&]*\s\S*業務改善(?:[\\/][^\s"'|;&]*)?["']?\s*(?=$|[|;&]|\d?>)/;
const SED_IN_PLACE = /\bsed\b[^|;&]*\s--?i[^|;&]*業務改善[\\/]/;
/** 業務改善/ に入ってから書く形。cwd の判定は完全一致のセグメントで見る（業務改善案/ は別物） */
const CD_INTO = /\bcd\s+[^;&|]*業務改善(?=[\\/"'\s;&|]|$)/;
/** プラグイン自身の成果物の名前。中身に関係なく必ず検査に掛ける（下の免除は他人のファイルにだけ効く） */
const OWN_MD = /^(業務一覧|改善案|AI化依頼書|保留)\.(md|markdown)$/i;
const OWN_HTML = /^改善計画-.+\.html?$/i;
/** ファイルへのリダイレクト。>&1 / 2>&1 は宛先が & で始まるので当たらず、/dev/null は後で除く */
const ANY_REDIRECT = /(?:^|[\s;&|(])\d?>>?\s*["']?([^\s"'&][^\s"']*)|\btee\b(?:\s+-\S+)*\s+["']?([^\s"'-][^\s"']*)/g;
/** スクリプトから書く形。python 等の本体・node -e・PowerShell の書き込み。`node <ファイル>`（lint の呼び方）は当たらない */
const SCRIPT_WRITE = /\b(?:python[0-9.]*|py|perl|ruby|php)\b|\bnode\s+(?:-e|--eval|-p|--print)\b|\b(?:pwsh|powershell)\b|\b(?:Set-Content|Out-File|Add-Content)\b|\[IO\.File\]/i;
/** 業務改善/ のパスへの言及（コマンド本文・ヒアドキュメントの中身を含む） */
const MENTIONS_PATH = /業務改善[\\/]/;

function stop(lines) {
  process.stderr.write(lines.filter(Boolean).join('\n') + '\n');
  process.exit(2);
}

function run(script, content, extra = []) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script), '-', ...extra], { input: content, encoding: 'utf8' });
  return { status: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}

/** lint の出力から `  [CODE]` 行のコードを拾う */
function codesOf(out) {
  return out.split('\n').map((l) => /^\s*\[([A-Z_]+)\]/.exec(l)).filter(Boolean).map((m) => m[1]);
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

function inKaizen(cwd) {
  return String(cwd).split(/[\\/]/).includes('業務改善');
}

/** docs/harness/ 配下の .md を全部（深さ6まで。node_modules 等は無い前提の小さな木） */
function mdFilesUnder(dir, depth = 0) {
  let out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 6) out = out.concat(mdFilesUnder(p, depth + 1)); }
    else if (/\.(md|markdown)$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** ファイルへ書くリダイレクトがあるか（2>&1・>&1・/dev/null 行きは「書く」ではない） */
function writesToFile(cmd) {
  ANY_REDIRECT.lastIndex = 0;
  let m;
  while ((m = ANY_REDIRECT.exec(cmd)) !== null) {
    const target = m[1] || m[2] || '';
    if (!/^(\/dev\/null|nul)$/i.test(target)) return true;
  }
  return false;
}

function main() {
  if (process.env.DRILLSPARK_HARNESS_GUARDS === 'off') process.exit(0);
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
  // JSON としては読めても object でない入力（null / 配列 / 数値）で例外を吐かない
  if (!input || typeof input !== 'object' || Array.isArray(input)) process.exit(0);
  const tool = String(input.tool_name || '');
  const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const cwd = input.cwd || process.cwd();

  // 3. Bash — 宛先が 業務改善/ の書き込みだけを止める（読むだけ・語を含むだけの Bash は止めない）
  if (tool === 'Bash') {
    const cmd = String(ti.command || '');
    if (REDIRECT_TO.test(cmd)) {
      stop(['process-write-guard: 業務改善/ のファイルは Bash のリダイレクトではなく Write で書く（書く前に表の検査を通すため）。']);
    }
    if (COPY_TO.test(cmd) || SED_IN_PLACE.test(cmd)) {
      stop(['process-write-guard: 業務改善/ のファイルは cp / mv / install / sed -i ではなく Write で書く（書く前に表の検査を通すため）。']);
    }
    if ((inKaizen(cwd) || CD_INTO.test(cmd)) && writesToFile(cmd)) {
      stop(['process-write-guard: 業務改善/ の中では Bash のリダイレクトでファイルを書かない。業務改善/ のファイルは Write で書く（書く前に表の検査を通すため）。']);
    }
    if ((MENTIONS_PATH.test(cmd) || inKaizen(cwd) || CD_INTO.test(cmd)) && SCRIPT_WRITE.test(cmd)) {
      stop(['process-write-guard: 業務改善/ のファイルは python / node -e / PowerShell などのスクリプトからも書き換えない。読むのは Read、書くのは Write / Edit（書く前に表の検査を通すため）。']);
    }
    process.exit(0);
  }

  // 4. 他人の図を書き換えない
  if (/update_diagram$/i.test(tool)) {
    const id = String(ti.project_id || '');
    if (!id) process.exit(0);
    const list = path.join(cwd, '業務改善', '業務一覧.md');
    const harness = path.join(cwd, 'docs', 'harness');
    const hasList = fs.existsSync(list);
    const hasHarness = fs.existsSync(harness);
    if (!hasList && !hasHarness) process.exit(0);
    if (hasList && fs.readFileSync(list, 'utf8').includes(id)) process.exit(0);
    if (hasHarness && mdFilesUnder(harness).some((f) => fs.readFileSync(f, 'utf8').includes(id))) process.exit(0);
    stop([
      'process-write-guard: このプロジェクトは 業務改善/業務一覧.md の「図の在りか」にも docs/harness/ の .md にも無い。他人が作った図は読むだけで書き換えない。',
      '自分で作った図なら、create_project の直後にその URL を書いてから update_diagram を呼ぶ。置き場はスキルで違う —',
      '  process-improve: 業務改善/業務一覧.md の「図の在りか」列（改善後の図は「改善後:」）',
      '  harness-implement: docs/harness/<ハーネス名>/処理/<処理名>/図.md',
      '  harness-improve: docs/harness/<ハーネス名>/改善/<日付>.md',
      'ハーネスの図の URL を 業務一覧.md に書かない（あの列の「改善後:」は業務の改善後の図として読まれる）。',
    ]);
  }

  const file = String(ti.file_path || '');
  const isMd = MD.test(file);
  const isHtml = HTML.test(file);
  if (!file || (!isMd && !isHtml)) process.exit(0);
  if (!['Write', 'Edit', 'MultiEdit'].includes(tool)) process.exit(0);

  const content = tool === 'Write' ? String(ti.content || '') : afterEdit(file, ti);
  if (content === null) process.exit(0);

  if (isMd) {
    const own = OWN_MD.test(path.basename(file));
    // 表を持たない .md（教訓.md など）は検査の対象外。表の検査は表があるものだけに掛ける（固定名の表は必ず掛ける）
    if (!own && !/^\s*\|.*\|\s*$/m.test(content)) process.exit(0);
    const root = ROOT.exec(file);
    const listPath = root ? path.join(root[1], '業務一覧.md') : null;
    const extra = path.basename(file) !== '業務一覧.md' && listPath && fs.existsSync(listPath) ? ['--list', listPath] : [];
    const r = run('process-table-lint.js', content, extra);
    if (r.status === 0) process.exit(0);
    if (r.status === 2) {
      // 固定名でない .md で、業務改善の表を1つも認識できない（SYNTAX。空行で切れた続き ORPHAN_ROW が伴ってもよい）なら
      // このプラグインの表ではない — 別件の議事録などを止めない。固定名（業務一覧.md など）は中身が何でも止める
      const codes = codesOf(r.out);
      if (!own && codes.includes('SYNTAX') && codes.every((c) => c === 'SYNTAX' || c === 'ORPHAN_ROW')) process.exit(0);
      stop(['process-write-guard: 表の検査に落ちたので書かない。指摘どおり直してから書き直す。', r.out]);
    }
    stop([`process-write-guard: 表の検査が実行エラー（exit ${r.status}）。直さずに利用者へ報告する。`, r.out]);
  }
  // 固定名でない HTML で、塊の印 data-block= を1つも持たないものは、このプラグインの1枚ではない。
  // 改善計画-*.html は印が1つも無くても止める（印を落とした1枚を素通しにしない）
  if (!OWN_HTML.test(path.basename(file)) && !/data-block\s*=/i.test(content)) process.exit(0);
  const r = run('process-plan-lint.js', content);
  if (r.status === 0) process.exit(0);
  if (r.status === 2) stop(['process-write-guard: 1枚の検査に落ちたので書かない。落ちた箇所だけ直してから書き直す。', r.out]);
  stop([`process-write-guard: 1枚の検査が実行エラー（exit ${r.status}）。直さずに利用者へ報告する。`, r.out]);
}

main();
