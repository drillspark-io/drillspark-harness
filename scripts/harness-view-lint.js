#!/usr/bin/env node
/**
 * harness-view-lint — `harness-visualize` が出した HTML が契約どおりかを決定論で検査する。
 *
 *   node "$CLAUDE_PLUGIN_ROOT/scripts/harness-view-lint.js" <file.html>
 *   標準入力から流す場合: ... | node "$CLAUDE_PLUGIN_ROOT/scripts/harness-view-lint.js" -
 *
 * 依存なし（Node 標準の fs だけ）。どのリポジトリからでも単体で動く。
 * exit 0 = 合格 / 2 = 違反あり / 1 = 実行エラー
 *
 * なぜ要るか:
 *   可視化は「見た目が出た」で完了にできてしまう。外部 CDN を1本読んだ HTML は
 *   オフラインや配布先で崩れ、絶対パスや UUID を1行貼っただけで公開できない成果物になる。
 *   どちらも目視では落ちるので、機械で見る。
 *
 * 見ないもの（**実装に無い。ここを実際より広く書くと、通ったことが根拠に使われる**）:
 *   - 図が読めるか・状態の割り当てが正しいか・説明が足りているか
 *   - `<pre class="mermaid">` があるか・表が併記されているか・状態が3値か
 *     （＝「lint を通す最小の空の枠」は通る。中身があるかは人間が見る）
 *   - インライン `<script>` の中で fetch("https://…") や img.src = "…" のように
 *     実行時に外部を取りに行くもの（タグの属性に書かれた読み込みだけを見る）
 *   - `<a>` の属性値（本文リンクなので、href 以外の属性も見ない）
 */

const fs = require('fs');

/** 出力 HTML が必ず持つ節。欠けているものは「無し」と書いてでも出す */
const REQUIRED_SECTIONS = ['目的', '処理一覧', '工程', '介入点', '合格条件', '成果物', '未完'];

/** ノードIDは図と同じ綴り（数値・アンダースコア区切り） */
const NUMERIC_ID = /^[0-9]+(_[0-9]+)*$/;

/**
 * 読み込み位置。<a> 以外のタグは属性値を全部見る。見る属性名を列挙する方式だと、
 * srcset・poster・<object data>・action・formaction・xlink:href がすり抜けた。
 *   - 読み込み属性（LOAD_ATTRS）: data: と #（ページ内アンカー）以外は全部違反
 *   - それ以外の属性: 値が URL かパスの形（//…・https://…・/…・./…・../…）なら違反
 * 本文中のリンク <a href="https://…"> は読み込みではないので対象にしない
 * （実行記録には出典 URL が本文として正当に入る）。CSS の url() と @import はタグの属性でないので別に見る。
 */
const LOAD_ATTRS = new Set(['src', 'srcset', 'href', 'poster', 'data', 'action', 'formaction', 'xlink:href']);
const URL_SHAPED = /^(?:(?:https?:)?\/\/|\.{0,2}\/)/i;
// 引用符の中の > で切れないよう、属性を1つずつ読む形で開始タグを取る
const TAG = /<([A-Za-z][\w:-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;
const ATTR = /([^\s"'>\/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const CSS_POSITIONS = [
  { re: /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\)/gi, what: 'url()' },
  { re: /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s;)]+))/gi, what: '@import' },
];

/** 公開できない値。テストデータに実在の値を入れないこと（規律2はテストにも効く） */
const PRIVATE_PATTERNS = [
  { re: /[A-Za-z]:[\\/](?:Users|home)[\\/][^\s"'<>]+/g, what: '利用者のホーム配下の絶対パス' },
  { re: /\/(?:Users|home)\/[A-Za-z0-9._-]+[^\s"'<>]*/g, what: '利用者のホーム配下の絶対パス' },
  { re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, what: 'UUID（プロジェクトID・セッションID）' },
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, what: 'メールアドレス' },
  // 鍵の形（Bearer ヘッダ・DrillSpark・Anthropic・GitHub・AWS）。桁数だけのダミーでも当たる
  { re: /\b(?:Bearer\s+[A-Za-z0-9._-]{8,}|dsk_[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/g, what: 'API キー・トークン' },
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

  // コメントは読み込まれないし節でもない。ここを剥がさないと、説明として書いた
  // <link href="https://…"> のような例示が違反として拾われる
  const body = src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));

  // 1. 読み込み位置 — data: と # だけを通す
  const seenRef = new Set();
  const isLocal = (value) => /^data:/i.test(value) || value.startsWith('#');
  const flagRef = (index, what, value) => {
    const line = lineOf(body, index);
    const key = `${line}|${value}`;
    if (seenRef.has(key)) return;
    seenRef.add(key);
    add('EXTERNAL_REF', `${line}行目`,
      `${what} が外部を読んでいる: ${clip(value)} — 1ファイル完結にする（CSS/JSはインライン、画像は data: URI）`);
  };
  TAG.lastIndex = 0;
  let t;
  while ((t = TAG.exec(body)) !== null) {
    const tag = t[1].toLowerCase();
    if (tag === 'a') continue;
    const attrsAt = t.index + 1 + t[1].length;
    ATTR.lastIndex = 0;
    let a;
    while ((a = ATTR.exec(t[2])) !== null) {
      const name = a[1].toLowerCase();
      const raw = (a[2] ?? a[3] ?? a[4] ?? '').trim();
      // srcset は「URL 幅」の候補をカンマで並べる。data: URI の中のカンマで割らないよう、
      // 空白が続くカンマだけで割り、各候補の先頭語（URL）を見る
      const values = name === 'srcset' ? raw.split(/,(?=\s)/).map((c) => c.trim().split(/\s+/)[0]) : [raw];
      for (const value of values) {
        if (!value || isLocal(value)) continue;
        if (LOAD_ATTRS.has(name) || URL_SHAPED.test(value)) flagRef(attrsAt + a.index, `${tag} ${name}`, value);
      }
    }
  }
  for (const pos of CSS_POSITIONS) {
    pos.re.lastIndex = 0;
    let m;
    while ((m = pos.re.exec(body)) !== null) {
      const value = (m[1] ?? m[2] ?? m[3] ?? '').trim();
      if (!value || isLocal(value)) continue;
      flagRef(m.index, pos.what, value);
    }
  }

  // 2. ノード注釈 — 図のどのノードの話かが機械で辿れること
  const ids = [];
  const idRe = /data-node-id\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let n;
  while ((n = idRe.exec(body)) !== null) {
    ids.push({ value: (n[1] ?? n[2] ?? '').trim(), line: lineOf(body, n.index) });
  }
  if (ids.length === 0) {
    add('NO_NODE', '-', 'data-node-id が1つも無い。工程・ノードの要素に図のIDを付ける');
  }
  const firstSeen = new Map();
  for (const id of ids) {
    if (!NUMERIC_ID.test(id.value)) {
      add('NODE_ID', id.value || '(空)', `${id.line}行目の data-node-id が数値ID形式でない（1・2_1・5_10_12）`);
      continue;
    }
    if (firstSeen.has(id.value)) {
      add('DUPLICATE', id.value,
        `${firstSeen.get(id.value)}行目と ${id.line}行目で同じノードIDが2回出ている（どちらの状態が正か読めない）`);
    } else {
      firstSeen.set(id.value, id.line);
    }
  }

  // 3. 節 — 欠けているものは「無し」と書いてでも出す。書かないのと「無い」と書くのは違う
  const sections = new Set();
  const secRe = /data-section\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let s;
  while ((s = secRe.exec(body)) !== null) sections.add((s[1] ?? s[2] ?? '').trim());
  for (const required of REQUIRED_SECTIONS) {
    if (!sections.has(required)) {
      add('MISSING_SECTION', required, `data-section="${required}" の節が無い（中身が無いなら「無し」と書いて節は出す）`);
    }
  }

  // 4. 私的情報 — コメントの中も見る（ファイルに残っている時点で公開できない）
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
