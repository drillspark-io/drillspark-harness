#!/usr/bin/env node
/**
 * process-file-lint — 指定されたパスに**実際に保存されたか**だけを決定論で検査する。
 *
 *   node "$CLAUDE_PLUGIN_ROOT/scripts/process-file-lint.js" <保存先パス> [<パス> ...]
 *
 * 依存なし（Node 標準の fs だけ）。どのリポジトリからでも単体で動く。
 * exit 0 = 合格 / 2 = 違反あり / 1 = 実行エラー
 *
 * なぜ要るか:
 *   「1枚を書き出した」は、書き出したつもりで終わっていても同じ言葉で報告できる。
 *   利用者は渡された道順を開くまで気づかない。**在るかどうかは機械にしか分からない。**
 *
 * 見ないもの（**実装に無い。ここを実際より広く書くと、通ったことが根拠に使われる**）:
 *   - **中身を一切開かない。** 空でなければ通る。8つの塊があるかは
 *     `process-plan-lint.js` の仕事で、この lint は在るかだけを見る
 *   - 拡張子・置き場所（`業務改善/` 配下かどうか）・ファイル名の綴り
 *   - 更新日時（今回の実行で書かれたものか、前回の残りか）
 *   - 私的情報（絶対パスを渡すのは正常な使い方なので、パス自体は咎めない）
 */

const fs = require('fs');

function lint(paths) {
  const findings = [];
  const add = (code, id, message) => findings.push({ code, id, message });

  for (const p of paths) {
    let stat;
    try {
      stat = fs.statSync(p);
    } catch (err) {
      add('NOT_SAVED', p, `そのパスにファイルが無い（${err.code || err.message}）。書き出したつもりで終わっている`);
      continue;
    }
    if (!stat.isFile()) {
      add('NOT_SAVED', p, 'そのパスはファイルではない（ディレクトリ等）');
      continue;
    }
    if (stat.size === 0) {
      add('NOT_SAVED', p, 'ファイルはあるが中身が0バイト（保存が途中で終わっている）');
    }
  }

  return findings;
}

function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error('保存先のパスを1つ以上渡す: node process-file-lint.js <path> [<path> ...]');
    process.exit(1);
  }

  const findings = lint(paths);
  const where = paths.join(' ');

  if (findings.length === 0) {
    console.log(`OK  ${where}`);
    process.exit(0);
  }

  console.error(`NG  ${where} — ${findings.length} 件`);
  for (const f of findings) console.error(`  [${f.code}] ${f.id}: ${f.message}`);
  process.exit(2);
}

main();
