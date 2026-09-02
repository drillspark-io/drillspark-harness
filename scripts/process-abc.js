#!/usr/bin/env node
/**
 * process-abc — 業務一覧から ABC 分析（重点分析）を決定論で出す。
 *
 *   node "$CLAUDE_PLUGIN_ROOT/scripts/process-abc.js" 業務改善/業務一覧.md [--abc 70,90]
 *   標準入力から流す場合: ... | node "$CLAUDE_PLUGIN_ROOT/scripts/process-abc.js" - [--abc 70,90]
 *
 * 依存なし。exit 0 = 出せた / 1 = 実行エラー（表が無い・時間が1件も読めない）
 *
 * なぜ要るか:
 *   skill は「機械で計算する。利用者に判断させない」と書くが、計算する部品が無ければ
 *   LLM の暗算になる。累積割合の閾値判定は LLM が外す典型で、そこだけ決定論にする。
 *   ムダの印（転記／二重入力／目的が薄い／待ち）も、**一覧のどの列のどの語から付けたか**を
 *   添えて出す。語の無い印は付けない — 印そのものが「もっともらしく埋まる」危険を持つため。
 *
 * 出力（Markdown の表。そのまま利用者に見せられる）:
 *   | 順 | 業務名 | 時間/月 | 累積% | ランク | 印の候補（根拠の語） |
 *
 * 見ないもの:
 *   - 時間の単位の換算。`= <数字>時間/月` の形だけを読む。読めない行は `単位不明` として末尾に出し、
 *     ランクの計算からは外す（外したことを隠さない）
 *   - 印の妥当さ。語の一致だけで、その業務が本当にムダかは利用者と現場が決める
 */

const fs = require('fs');

const SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
/** 語の一致で付ける印。語は一覧の「作業」「きっかけ」「使う道具」「仕事の目的」から探す */
const MARKS = [
  { mark: '転記', words: ['転記', '手入力', '打ち込', '書き写', 'コピー'], columns: ['作業'] },
  { mark: '二重入力', words: ['二重', '2回', '２回', 'もう一度', '再入力', '両方に'], columns: ['作業'] },
  { mark: '待ち', words: ['待つ', '待ち', '承認待', '返事', '来るまで'], columns: ['作業', 'きっかけ'] },
  { mark: '目的が薄い', words: ['不要', '保留', '慣例', '昔から', 'なんとなく'], columns: ['仕事の目的'] },
];

function cells(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

function findList(src) {
  const lines = src.split(/\r?\n/);
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!/\|/.test(lines[i]) || !SEPARATOR.test(lines[i + 1])) continue;
    const header = cells(lines[i]);
    if (!header.includes('業務名') || !header.includes('かかる時間')) continue;
    const rows = [];
    for (let j = i + 2; j < lines.length; j++) {
      if (!/\|/.test(lines[j]) || !lines[j].trim()) break;
      rows.push(cells(lines[j]));
    }
    return { header, rows };
  }
  return null;
}

/** `月30件 × 4分 = 2時間/月` → 2。`= 90分/月` → 1.5。読めなければ null */
function hoursPerMonth(text) {
  const t = text.replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const m = /=\s*([0-9]+(?:\.[0-9]+)?)\s*(時間|h|分)\s*\/?\s*月/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === '分' ? n / 60 : n;
}

function main() {
  const args = process.argv.slice(2);
  const abcAt = args.indexOf('--abc');
  let [aMax, bMax] = [70, 90];
  if (abcAt !== -1) {
    const v = (args[abcAt + 1] || '').split(',').map(Number);
    if (v.length === 2 && v.every((n) => n > 0 && n <= 100) && v[0] < v[1]) [aMax, bMax] = v;
    else { console.error('--abc は 70,90 のように 0〜100 の2つを昇順で'); process.exit(1); }
  }
  const arg = args.filter((a, i) => abcAt === -1 || (i !== abcAt && i !== abcAt + 1))[0];
  let src;
  try {
    src = (!arg || arg === '-') ? fs.readFileSync(0, 'utf8') : fs.readFileSync(arg, 'utf8');
  } catch (err) {
    console.error(`読み込めない: ${err.message}`); process.exit(1);
  }
  const list = findList(src);
  if (!list) { console.error('業務一覧の表（業務名・かかる時間 の列）が見当たらない'); process.exit(1); }

  const at = (name) => list.header.indexOf(name);
  const items = []; const unknown = [];
  for (const row of list.rows) {
    const name = row[at('業務名')] || '';
    if (!name) continue;
    const hours = hoursPerMonth(row[at('かかる時間')] || '');
    const marks = [];
    for (const m of MARKS) {
      for (const c of m.columns) {
        const v = at(c) === -1 ? '' : (row[at(c)] || '');
        const hit = m.words.find((w) => v.includes(w));
        if (hit) { marks.push(`${m.mark}（${c}:「${hit}」）`); break; }
      }
    }
    if (hours === null) unknown.push({ name, marks }); else items.push({ name, hours, marks });
  }
  if (items.length === 0) { console.error('「かかる時間」が `= <数字>時間/月` の形で読める行が1件も無い'); process.exit(1); }

  items.sort((a, b) => b.hours - a.hours);
  const total = items.reduce((s, x) => s + x.hours, 0);
  let cum = 0;
  const out = ['| 順 | 業務名 | 時間/月 | 累積% | ランク | 印の候補（根拠の語） |', '|---|---|---|---|---|---|'];
  items.forEach((x, i) => {
    cum += x.hours;
    const pct = (cum / total) * 100;
    const rank = i === 0 || pct <= aMax ? 'A' : pct <= bMax ? 'B' : 'C';
    out.push(`| ${i + 1} | ${x.name} | ${Math.round(x.hours * 100) / 100} | ${Math.round(pct)}% | ${rank} | ${x.marks.join('、') || '—'} |`);
  });
  unknown.forEach((x) => out.push(`| — | ${x.name} | 単位不明 | — | — | ${x.marks.join('、') || '—'} |`));
  out.push('', `合計 ${Math.round(total * 100) / 100} 時間/月。A＝累積 ${aMax}% まで（先頭の1件は必ず A）、B＝${bMax}% まで、C＝それ以外。印は語の一致だけで、本当にムダかは現場が決める。`);
  console.log(out.join('\n'));
}

main();
