#!/usr/bin/env node
/**
 * process-plan-lint — 改善計画の1枚（HTML）が契約どおりかを決定論で検査する。
 *
 *   node "$CLAUDE_PLUGIN_ROOT/scripts/process-plan-lint.js" <file.html>
 *   標準入力から流す場合: ... | node "$CLAUDE_PLUGIN_ROOT/scripts/process-plan-lint.js" -
 *
 * 依存なし（Node 標準の fs だけ）。どのリポジトリからでも単体で動く。
 * exit 0 = 合格 / 2 = 違反あり / 1 = 実行エラー
 *
 * なぜ要るか:
 *   1枚は「それらしい見た目が出た」で完了にできてしまう。材料が欠けた回に
 *   **塊ごと静かに落ちる**のが最も起きやすい壊れ方で、読み手（業務改善の素人）には
 *   落ちたことが見えない。目視では落ちるので、機械で見る。
 *
 * なぜ `harness-view-lint.js` を使い回さないか:
 *   あちらは UUID を私的情報として弾く。改善計画の1枚には **DrillSpark の URL
 *   （UUID を含む）が正当に入る**ので、そのままでは通らない（設計 3.1）。
 *   **違いは UUID の1点だけ** — 絶対パスとメールアドレスは同じように弾く。
 *   この1枚は一般公開ツールの出力で、そのまま社内で共有される（オーナー承認 2026-08-31）。
 *
 * 見ないもの（**実装に無い。ここを実際より広く書くと、通ったことが根拠に使われる**）:
 *   - **UUID 単体を弾かない。** DrillSpark の URL（`drillspark.io/editor?id=<uuid>`）が
 *     1枚から図へ戻る導線として正当に入るため。**UUID の形をした別物も一緒に通る**
 *   - 塊の**中身**（`data-block` の属性が在るかだけ。中が空でも通る）
 *   - 塊の**順序**（成功の形 → 図 → 改善案 → AI化依頼書 → 保留 の並び）
 *   - **印そのものが落ちた1枚。** MISSING_MARK が発火するのは
 *     「本文に語がある ∧ `data-mark` が無い」ときだけで、
 *     **語ごと消えた1枚は通る**。印の要否は材料の側（改善案の `出どころ` 列が
 *     `一般例` か）で決まり、**この lint は材料を持たない**ので突き合わせられない。
 *     ここは判定基準のレビュー側 MUST に残る（1枚だけを見て決定論には落ちない）
 *   - 印が**正しいノード・正しい行**に付いているか（付け先の正しさは人間が見る）
 *   - 改善案が優先度順に並んでいるか・落ちた案が無いか
 *   - 電話番号・住所・社名・顧客名（決定論の型を持たないので機械では拾えない）
 *   - インライン `<script>` の中で実行時に外部を取りに行くもの（fetch など）
 *   - 図が読めるか・表として成立しているか・素人に通じるか
 */

const fs = require('fs');

/** 1枚に必ず載る8つの塊。欠けているものは「用意できなかった」と理由つきで書いてでも出す */
const REQUIRED_BLOCKS = [
  '成功の形',
  '図または取れなかった経緯',
  '改善案',
  '誰がやるか',
  '優先度',
  'ECRSのどれか',
  'AI化依頼書',
  '保留',
];

/** 2種の印。本文に語があるなら、目立たせる印が要る */
const MARKS = [
  { word: '未確認', why: '利用者から聞けなかった箇所' },
  { word: '一般例', why: 'AIが一般論から補った箇所。その職場の実態ではない' },
];

/**
 * 読み込み位置。ここに入ってよい値は data: と #（ページ内アンカー）だけ。
 * 本文中のリンク <a href="https://…"> は読み込みではないので対象にしない
 * （**DrillSpark の図の URL がここに入る**）。
 */
const LOAD_POSITIONS = [
  { re: /<link\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, what: 'link href', group: 1 },
  // `data-src=` のような別属性に当てないよう、直前の1文字も一緒に取る（lookbehind を使わない）
  { re: /(^|[^\w-])src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gim, what: 'src', group: 2 },
  { re: /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\)/gi, what: 'url()', group: 1 },
  { re: /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s;)]+))/gi, what: '@import', group: 1 },
];

/**
 * 公開できない値。**UUID は入れない** — DrillSpark の URL に正当に含まれるため
 * （ここが `harness-view-lint.js` との唯一の違い。設計 3.1・条件10）。
 * テストデータに実在の値を入れないこと（規律2はテストにも効く）。
 */
const PRIVATE_PATTERNS = [
  { re: /[A-Za-z]:[\\/](?:Users|home)[\\/][^\s"'<>]+/g, what: '利用者のホーム配下の絶対パス' },
  { re: /\/(?:Users|home)\/[A-Za-z0-9._-]+[^\s"'<>]*/g, what: '利用者のホーム配下の絶対パス' },
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, what: 'メールアドレス' },
];

function lineOf(src, index) {
  return src.slice(0, index).split(/\r?\n/).length;
}

function clip(text, max = 40) {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max) + '…' : one;
}

function lint(src) {
  const findings = [];
  const add = (code, id, message) => findings.push({ code, id, message });

  if (!/<html[\s>]/i.test(src) || !/<body[\s>]/i.test(src)) {
    add('SYNTAX', '-', '<html> と <body> が見当たらない。1枚の HTML ファイルとして出す');
    return findings;
  }

  // コメントは読み込まれないし塊でもない。ここを剥がさないと、説明として書いた
  // <link href="https://…"> や「一般例」の語が違反として拾われる
  const body = src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));

  // 1. 読み込み位置 — data: と # だけを通す。DrillSpark の URL は <a href> なので当たらない
  const seenRef = new Set();
  for (const pos of LOAD_POSITIONS) {
    pos.re.lastIndex = 0;
    let m;
    while ((m = pos.re.exec(body)) !== null) {
      const g = pos.group;
      const value = (m[g] ?? m[g + 1] ?? m[g + 2] ?? '').trim();
      if (!value) continue;
      if (/^data:/i.test(value) || value.startsWith('#')) continue;
      const line = lineOf(body, m.index);
      const key = `${line}|${value}`;
      if (seenRef.has(key)) continue;
      seenRef.add(key);
      add('EXTERNAL_REF', `${line}行目`,
        `${pos.what} が外部を読んでいる: ${clip(value)} — 1ファイル完結にする（CSS/JSはインライン、画像は data: URI）`);
    }
  }

  // 2. 8つの塊 — 材料が欠けた回に塊ごと静かに落ちるのを塞ぐ
  const blocks = new Set();
  const blockRe = /data-block\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let b;
  while ((b = blockRe.exec(body)) !== null) blocks.add((b[1] ?? b[2] ?? '').trim());
  for (const required of REQUIRED_BLOCKS) {
    if (!blocks.has(required)) {
      add('MISSING_BLOCK', required,
        `data-block="${required}" の塊が無い（材料が無いなら「用意できなかった」と理由つきで書いて塊は出す）`);
    }
  }

  // 3. 印 — 本文に語があるのに目立たせる印が無い。
  //    タグを剥がしてから探す。剥がさないと data-mark="未確認" の属性値そのものが
  //    「本文に語がある」と読まれ、印を付けた1枚が違反になる
  const text = body.replace(/<[^>]*>/g, ' ');
  for (const mark of MARKS) {
    if (!text.includes(mark.word)) continue;
    if (!new RegExp(`data-mark\\s*=\\s*(?:"${mark.word}"|'${mark.word}')`).test(body)) {
      add('MISSING_MARK', mark.word,
        `本文に「${mark.word}」（${mark.why}）があるのに data-mark="${mark.word}" が無い（印を付けてから見せる）`);
    }
  }

  // 4. 私的情報 — コメントの中も見る（ファイルに残っている時点で共有できない）。
  //    DrillSpark の URL は UUID を見ないことで通る（許可リストは持たない）
  const seenPrivate = new Set();
  for (const p of PRIVATE_PATTERNS) {
    p.re.lastIndex = 0;
    let q;
    while ((q = p.re.exec(src)) !== null) {
      const line = lineOf(src, q.index);
      const key = `${line}|${q[0]}`;
      if (seenPrivate.has(key)) continue;
      seenPrivate.add(key);
      add('PRIVATE_INFO', `${line}行目`, `${p.what}が入っている: ${clip(q[0], 24)}`);
    }
  }

  return findings;
}

function main() {
  const arg = process.argv[2];
  let src;
  try {
    src = (!arg || arg === '-') ? fs.readFileSync(0, 'utf8') : fs.readFileSync(arg, 'utf8');
  } catch (err) {
    console.error(`読み込めない: ${err.message}`);
    process.exit(1);
  }

  const findings = lint(src);
  const where = arg && arg !== '-' ? arg : '(stdin)';

  if (findings.length === 0) {
    console.log(`OK  ${where}`);
    process.exit(0);
  }

  console.error(`NG  ${where} — ${findings.length} 件`);
  for (const f of findings) console.error(`  [${f.code}] ${f.id}: ${f.message}`);
  process.exit(2);
}

main();
