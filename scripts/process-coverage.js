#!/usr/bin/env node
/**
 * process-coverage — 業務の図で、第一階層の工程すべてに第二階層（作業）が描かれているかを数える。
 *
 *   node process-coverage.js <get_project の JSON ファイル>     （- で標準入力）
 *
 *   入力: DrillSpark の get_project が返した JSON そのまま（{ data: { content: { diagrams } } }）でも、
 *         content.diagrams だけ（{ "root": "flowchart …", "2": "flowchart …" }）でもよい。
 *   出力: 工程ごとに 第二階層 あり／なし の表。exit 0 = 全工程にある / exit 2 = 描いていない工程がある / exit 1 = 入力が読めない
 *
 * 何のためか: process-improve の §3-2 は「工程を1つ開いて作業を描く」を工程の数だけ繰り返す。
 * 1つ描いたところで §4（改善案）へ進んでしまう事故が実測で出た（7工程のうち1つだけ描いて成功の形を聞き始めた）。
 * 「全部描いたか」を記憶や目視でなく、get_project の中身から機械で数えるための1本。
 *
 * 工程と数えるのは root の process と subroutine のノード（terminal・decision・document・database・io は数えない）。
 * DrillSpark は子の図を「ノードIDをキーにした diagram」で持つ（root の 2 番の中身は diagrams["2"]）。
 * 依存なし。
 */

const fs = require('fs');

const SH = [
  [/^([0-9_]+)\(\["(.+?)"\]\)/, 'terminal'],
  [/^([0-9_]+)\[\["(.+?)"\]\]/, 'subroutine'],
  [/^([0-9_]+)\[\("(.+?)"\)\]/, 'database'],
  [/^([0-9_]+)\[\/"(.+?)"\/\]/, 'io'],
  [/^([0-9_]+)\["(.+?)"\]/, 'process'],
  [/^([0-9_]+)\{"(.+?)"\}/, 'decision'],
  [/^([0-9_]+)@\{\s*shape:\s*doc,\s*label:\s*"(.+?)"\s*\}/, 'document'],
];

function nodesOf(src) {
  const out = [];
  for (const raw of String(src).split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(%%|direction|flowchart|click|classDef|style|linkStyle|class |subgraph|end$)/.test(line)) continue;
    for (const [re, type] of SH) {
      const m = re.exec(line);
      if (m) { out.push({ id: m[1], type, label: m[2].replace(/<br\s*\/?>⏱.*$/, '').trim() }); break; }
    }
  }
  return out;
}

function diagramsOf(json) {
  let d = json;
  if (d && d.data) d = d.data;
  if (d && d.content && d.content.diagrams) d = d.content.diagrams;
  else if (d && d.diagrams && !d.root) d = d.diagrams;
  if (!d || typeof d !== 'object' || typeof d.root !== 'string') return null;
  return d;
}

function main() {
  const arg = process.argv[2];
  if (!arg) { console.error('使い方: node process-coverage.js <get_project の JSON ファイル | ->'); process.exit(1); }
  let text;
  try { text = arg === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(arg, 'utf8'); }
  catch (e) { console.error(`読めない: ${e.message}`); process.exit(1); }
  let json;
  try { json = JSON.parse(text); } catch (e) { console.error(`JSON として読めない: ${e.message}`); process.exit(1); }
  const diagrams = diagramsOf(json);
  if (!diagrams) { console.error('get_project の形ではない（content.diagrams.root が無い）'); process.exit(1); }

  const steps = nodesOf(diagrams.root).filter((n) => n.type === 'process' || n.type === 'subroutine');
  if (!steps.length) {
    console.log('root に工程（process / subroutine のノード）が1つも無い。§3-1 で工程を並べてから来る');
    process.exit(2);
  }
  const rows = steps.map((n) => {
    const child = typeof diagrams[n.id] === 'string' && /flowchart/.test(diagrams[n.id]) ? diagrams[n.id] : null;
    const works = child ? nodesOf(child).filter((c) => c.type === 'process' || c.type === 'subroutine' || c.type === 'decision').length : 0;
    return { id: n.id, label: n.label, has: !!child, works };
  });
  const done = rows.filter((r) => r.has);
  const missing = rows.filter((r) => !r.has);

  console.log('| # | 工程 | 第二階層 |');
  console.log('|---|---|---|');
  for (const r of rows) console.log(`| ${r.id} | ${r.label} | ${r.has ? `あり（${r.works} 作業）${r.works <= 1 ? ' — 作業が1つ。工程ではなく作業では？ 隣とまとめる' : ''}` : '**なし**'} |`);
  console.log('');
  const thin = rows.filter((r) => r.has && r.works <= 1);
  if (thin.length) console.log(`作業が1つしか無い工程: ${thin.map((r) => r.id).join(', ')}（第一階層が作業の羅列になっていないか、【止まる③】の前に見直す）`);
  if (missing.length) {
    console.log(`第二階層: ${done.length}/${rows.length}。描いていない工程: ${missing.map((r) => r.id).join(', ')} → §3-2 に戻る。全部描くまで §4（改善案）に進まない`);
    process.exit(2);
  }
  console.log(`第二階層: ${rows.length}/${rows.length}。全工程に作業が描かれている → 【止まる③】作業の確認へ`);
}

main();
