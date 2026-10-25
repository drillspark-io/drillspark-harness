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
 * 1つ描いたところで §4（改善案）へ進んでしまうことがある（7工程のうち1つだけ描いて成功の形を聞き始める）。
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
const EDGE_RE = /^([0-9_]+)\s*(?:-\.->|-->)\s*(?:\|\s*"?[^|"]*"?\s*\|\s*)?([0-9_]+)\s*$/;
const NOTE_RE = /^%%\s*note\[([0-9_]+)\]\s*:\s*(.*)$/;

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

function edgesAndNotesOf(src) {
  const edges = [];
  const notes = new Map();
  for (const raw of String(src).split(/\r?\n/)) {
    const line = raw.trim();
    const nm = NOTE_RE.exec(line);
    if (nm) { notes.set(nm[1], nm[2]); continue; }
    if (line.startsWith('%%')) continue;
    const em = EDGE_RE.exec(line);
    if (em) edges.push({ from: em[1], to: em[2] });
  }
  return { edges, notes };
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
  const args = process.argv.slice(2);
  const checkIo = args.includes('--check-io');
  const arg = args.find((a) => a !== '--check-io');
  if (!arg) { console.error('使い方: node process-coverage.js [--check-io] <get_project の JSON ファイル | ->'); process.exit(1); }
  let text;
  try { text = arg === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(arg, 'utf8'); }
  catch (e) { console.error(`読めない: ${e.message}`); process.exit(1); }
  let json;
  try { json = JSON.parse(text); } catch (e) { console.error(`JSON として読めない: ${e.message}`); process.exit(1); }
  const diagrams = diagramsOf(json);
  if (!diagrams) { console.error('get_project の形ではない（content.diagrams.root が無い）'); process.exit(1); }

  const rootNodes = nodesOf(diagrams.root);
  const rootNodeMap = new Map(rootNodes.map((n) => [n.id, n]));
  const { edges: rootEdges, notes: rootNotes } = edgesAndNotesOf(diagrams.root);
  const steps = rootNodes.filter((n) => n.type === 'process' || n.type === 'subroutine');
  if (!steps.length) {
    console.log('root に工程（process / subroutine のノード）が1つも無い。§3-1 で工程を並べてから来る');
    process.exit(2);
  }
  const ioIssues = [];
  const rows = steps.map((n) => {
    const child = typeof diagrams[n.id] === 'string' && /flowchart/.test(diagrams[n.id]) ? diagrams[n.id] : null;
    const childNodes = child ? nodesOf(child) : [];
    const works = child ? childNodes.filter((c) => c.type === 'process' || c.type === 'subroutine' || c.type === 'decision').length : 0;
    const inDocs = rootEdges
      .filter((e) => e.to === n.id && rootNodeMap.get(e.from) && rootNodeMap.get(e.from).type === 'document')
      .map((e) => rootNodeMap.get(e.from).label);
    const outDocs = rootEdges
      .filter((e) => e.from === n.id && rootNodeMap.get(e.to) && rootNodeMap.get(e.to).type === 'document')
      .map((e) => rootNodeMap.get(e.to).label);
    const noteText = rootNotes.get(n.id) || '';
    const hasInNote = /入力\s*[:：]/.test(noteText);
    const hasOutNote = /出力\s*[:：]/.test(noteText);
    if (checkIo) {
      if (inDocs.length === 0 && !hasInNote) {
        ioIssues.push(`工程 ${n.id}（${n.label}）に入力の書類ノードも備考「入力: …」も無い`);
      }
      if (outDocs.length === 0 && !hasOutNote) {
        ioIssues.push(`工程 ${n.id}（${n.label}）に出力の書類ノードも備考「出力: …」も無い`);
      }
      if (child) {
        const childDocLabels = new Set(childNodes.filter((c) => c.type === 'document').map((c) => c.label));
        for (const docLabel of [...inDocs, ...outDocs]) {
          if (!childDocLabels.has(docLabel)) {
            ioIssues.push(`親子図で書類が不一致: 親の工程 ${n.id}（${n.label}）に繋がる書類「${docLabel}」が子図 ${n.id} に無い`);
          }
        }
      }
    }
    return { id: n.id, label: n.label, has: !!child, works, inDocs, outDocs };
  });
  const done = rows.filter((r) => r.has);
  const missing = rows.filter((r) => !r.has);

  console.log('| # | 工程 | 第二階層 |');
  console.log('|---|---|---|');
  for (const r of rows) console.log(`| ${r.id} | ${r.label} | ${r.has ? `あり（${r.works} 作業）${r.works <= 1 ? ' — 作業が1つ。検査・停滞ならそのまま、加工なら隣とまとめる' : ''}` : '**なし**'} |`);
  console.log('');
  const thin = rows.filter((r) => r.has && r.works <= 1);
  if (thin.length) console.log(`作業が1つしか無い工程: ${thin.map((r) => r.id).join(', ')}（検査・停滞の工程ならそれでよい。加工なら第一階層が作業の羅列になっていないか、【止まる③】の前に見直す）`);
  if (missing.length) {
    console.log(`第二階層: ${done.length}/${rows.length}。描いていない工程: ${missing.map((r) => r.id).join(', ')} → §3-2 に戻る。全部描くまで §4（改善案）に進まない`);
    process.exit(2);
  }
  if (checkIo && ioIssues.length) {
    for (const msg of ioIssues) console.log(`[IO_MISMATCH] ${msg}`);
    process.exit(2);
  }
  console.log(`第二階層: ${rows.length}/${rows.length}。全工程に作業が描かれている${checkIo ? '（io=OK: 入出力・親子書類一致）' : ''} → 【止まる③】作業の確認へ`);
}

main();
