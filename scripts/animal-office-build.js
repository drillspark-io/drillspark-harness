#!/usr/bin/env node
/**
 * animal-office-build — DrillSpark の図を「動物たちの会社」の 3D ページ（1ファイル完結）に組み立てる。
 * `animal-office-view` スキルの本体。
 *
 *   node "$CLAUDE_PLUGIN_ROOT/scripts/animal-office-build.js" <置き場>/<名前>.diagrams.json
 *   node "$CLAUDE_PLUGIN_ROOT/scripts/animal-office-build.js" <置き場>/<名前>.office.json
 *
 *   入力（同じフォルダ・同じ basename）:
 *     <名前>.diagrams.json  DrillSpark の get_project が返す content.diagrams をそのまま（{ "root": "flowchart …", "2": … }）。必須
 *     <名前>.office.json    任意。{ "title": "…", "animals": { "レーン名": "neko" }, "omitNotes": false }
 *   出力:
 *     <名前>.office.html    書く前に harness-view-guard（回数欄・上書き・animal-office-lint）を通す。落ちれば書かない
 *
 *   exit 0 = 書いた / 2 = 入力の不備か柵に止められた（stderr に理由） / 1 = 実行エラー
 *
 * 図 → 会社の対応:
 *   図1枚 = フロア（root が 1F、子図は B1F・B2F…）／レーン = 部署の島（部署に動物1匹。同じ名前のレーンは全フロアで同じ動物）
 *   作業 = 机／分岐 = 案内板／開始・終了 = ドア／子図を持つ工程 = エレベーター／データストア = 書庫／入出力 = 受付／成果物 = 書類トレイ
 *   座標はここで決める（部署 = 奥行きの列、工程 = 最長路の段で横）。ページは並べ方を持たない。
 *
 * 依存なし（Node 標準の fs / path / child_process だけ）。three.js と動物モデルは同梱の
 * assets/animal-office/runtime.js と assets/animal-office/models/*.glb をそのまま埋め込む。
 */

'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const LIMIT = 2;
const ASSETS = path.join(__dirname, '..', 'assets', 'animal-office');
/** 割り当て順（見分けやすい順）。名前は吹き出しと表に出る */
const ANIMALS = [
  ['neko', 'ねこ'], ['inu', 'いぬ'], ['usagi', 'うさぎ'], ['kuma', 'くま'], ['pengin', 'ペンギン'], ['kitsune', 'きつね'], ['tanuki', 'たぬき'],
  ['risu', 'りす'], ['koala', 'コアラ'], ['buta', 'ぶた'], ['hitsuji', 'ひつじ'], ['saru', 'さる'], ['kaeru', 'かえる'], ['fukurou', 'ふくろう'],
];
const ANIMAL_NAME = Object.fromEntries(ANIMALS);
const LANE_COLORS = ['#dcebd6', '#f6e3c8', '#dfe4f5', '#f5dde3', '#e3f0f0', '#efe9d2', '#e8def0', '#f0e0d0'];
const NO_LANE = '（担当なし）';
const X_STEP = 3.4;
const LANE_DEPTH = 4.2;
const SIDE = new Set(['document', 'database']);

function fail(lines, code = 2) {
  process.stderr.write(lines.filter(Boolean).join('\n') + '\n');
  process.exit(code);
}

// ---------- 図を読む（DrillSpark の Mermaid。形・レーン・辺・%% duration / note） ----------
const SHAPES = [
  ['([', '])', 'terminal'], ['[[', ']]', 'subroutine'], ['[(', ')]', 'database'], ['[/', '/]', 'io'], ['[\\', '\\]', 'io'],
  ['((', '))', 'terminal'], ['{{', '}}', 'process'], ['{', '}', 'decision'], ['(', ')', 'terminal'], ['[', ']', 'process'], ['>', ']', 'process'],
];
const AT_SHAPE = { doc: 'document', docs: 'document', document: 'document', 'lin-doc': 'document', cyl: 'database', db: 'database', database: 'database',
  diam: 'decision', decision: 'decision', stadium: 'terminal', terminal: 'terminal', circle: 'terminal', subproc: 'subroutine', 'fr-rect': 'subroutine',
  subroutine: 'subroutine', 'lean-r': 'io', 'lean-l': 'io', 'in-out': 'io' };
const ARROW = /^\s*<?(-{2,}>|-{3,}|-\.+->|-\.+-|={2,}>|={3,}|--[ox]|~~~)\s*(?:\|\s*"?([^|]*?)"?\s*\|)?\s*/;
const TEXT_ARROW = /^\s*<?(--|-\.|==)\s*"?([^">|]+?)"?\s*(-{2,}>|\.->|={2,}>|-{3,})\s*/;

function cleanLabel(s) {
  return String(s)
    .replace(/<br\s*\/?>\s*⏱.*$/i, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/#quot;/g, '"')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .trim();
}

/** 行の先頭から「ID（＋形）」を1つ読む。読めなければ null */
function readNode(s) {
  const m = /^([A-Za-z0-9_]+)/.exec(s);
  if (!m) return null;
  let rest = s.slice(m[0].length);
  const node = { id: m[1] };
  const at = /^@\{([^}]*)\}/.exec(rest);
  if (at) {
    const shape = /shape:\s*"?([\w-]+)/.exec(at[1]);
    const lbl = /label:\s*"((?:[^"\\]|\\.)*)"/.exec(at[1]) || /label:\s*([^,}]+)/.exec(at[1]);
    node.type = AT_SHAPE[shape ? shape[1] : ''] || 'process';
    node.label = lbl ? cleanLabel(lbl[1]) : m[1];
    return { node, rest: rest.slice(at[0].length) };
  }
  for (const [open, close, type] of SHAPES) {
    if (!rest.startsWith(open)) continue;
    let body = rest.slice(open.length);
    let end;
    if (body.startsWith('"')) {
      end = body.indexOf('"' + close, 1);
      if (end < 0) return null;
      node.label = cleanLabel(body.slice(1, end));
      end += 1;
    } else {
      end = body.indexOf(close);
      if (end < 0) return null;
      node.label = cleanLabel(body.slice(0, end));
    }
    node.type = type;
    return { node, rest: body.slice(end + close.length) };
  }
  return { node, rest };
}

function parseMmd(src) {
  const nodes = new Map();
  const edges = [];
  const lanes = [];
  const durs = {};
  const notes = {};
  const unparsed = [];
  const stack = [];
  const touch = (n) => {
    const lane = stack.length ? stack[stack.length - 1] : null;
    const cur = nodes.get(n.id);
    if (!cur) nodes.set(n.id, { id: n.id, type: n.type || 'process', label: n.label ?? n.id, lane, shaped: !!n.type });
    else {
      if (n.type && !cur.shaped) Object.assign(cur, { type: n.type, label: n.label ?? cur.label, shaped: true });
      if (!cur.lane && lane) cur.lane = lane;
    }
  };
  for (const rawLine of String(src).split(/\r?\n/)) {
    const line = rawLine.trim().replace(/;$/, '');
    let m;
    if (!line) continue;
    if ((m = /^%%\s*duration\[([^\]]+)\]:\s*([\d.]+)/.exec(line))) { durs[m[1]] = Number(m[2]) || 0; continue; }
    if ((m = /^%%\s*note\[([^\]]+)\]:\s*(.*)$/.exec(line))) { notes[m[1]] = m[2].replace(/\\n/g, '\n'); continue; }
    if (/^(%%|flowchart\b|graph\b|direction\b|click\b|classDef\b|class\b|style\b|linkStyle\b)/.test(line)) continue;
    if ((m = /^subgraph\s+([^\s[]+)\s*(?:\[\s*"?(.*?)"?\s*\])?\s*$/.exec(line))) {
      const name = cleanLabel(m[2] || m[1]);
      stack.push(name);
      if (!lanes.includes(name)) lanes.push(name);
      continue;
    }
    if (line === 'end') { stack.pop(); continue; }
    // 文: ノード（ --> ノード ）*
    let rest = line;
    let prev = null;
    let pending = null;
    let ok = true;
    while (rest.length) {
      const r = readNode(rest.trimStart());
      if (!r) { ok = false; break; }
      touch(r.node);
      if (prev && pending) edges.push({ from: prev, to: r.node.id, label: pending.label ? cleanLabel(pending.label) : '', dashed: pending.dashed });
      prev = r.node.id;
      rest = r.rest;
      if (!rest.trim()) break;
      const a = ARROW.exec(rest) || TEXT_ARROW.exec(rest);
      if (!a) { ok = false; break; }
      pending = ARROW.exec(rest) ? { label: a[2], dashed: a[1].includes('.') } : { label: a[2], dashed: a[1].includes('.') || a[3].includes('.') };
      rest = rest.slice(a[0].length);
    }
    if (!ok) unparsed.push(line);
  }
  for (const n of nodes.values()) {
    n.dur = durs[n.id] || 0;
    n.note = (notes[n.id] || '').replace(/^lane:\s*\w+\n?/, '');
    delete n.shaped;
  }
  return { nodes: [...nodes.values()], edges, lanes, unparsed };
}

// ---------- 並べる ----------
function layout(d, laneAnimal, opts) {
  const lanes = [...d.lanes];
  if (d.nodes.some((n) => !n.lane)) lanes.push(NO_LANE);
  for (const n of d.nodes) if (!n.lane) n.lane = NO_LANE;
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  // 成果物・データストアは「流れの先へ出ていく辺が無い」ときだけ流れの外（写しが飛んでいく先）。
  // 開始 → 書類 → 作業 のように流れの途中にある書類は、工程として回る（書類を書く作業）
  const sideIds = new Set(d.nodes.filter((n) => SIDE.has(n.type) && !d.edges.some((e) => e.from === n.id && byId.has(e.to) && !SIDE.has(byId.get(e.to).type))).map((n) => n.id));
  const isFlow = (id) => byId.has(id) && !sideIds.has(id);
  const flow = d.nodes.filter((n) => isFlow(n.id));
  const edges = d.edges.filter((e) => byId.has(e.from) && byId.has(e.to)).map((e) => ({ ...e, data: !isFlow(e.from) || !isFlow(e.to), back: false }));
  const outs = new Map(flow.map((n) => [n.id, []]));
  const indeg = new Map(flow.map((n) => [n.id, 0]));
  for (const e of edges) if (!e.data) { outs.get(e.from).push(e); indeg.set(e.to, indeg.get(e.to) + 1); }

  const noIn = flow.filter((n) => indeg.get(n.id) === 0);
  const start = (noIn.find((n) => n.type === 'terminal') || noIn[0] || flow[0] || {}).id || null;

  // 戻り辺（ループ）を DFS で見分ける。段の計算から外し、再生の自動選択でも選ばない
  const state = new Map();
  const visit = (root) => {
    const st = [[root, 0]];
    state.set(root, 1);
    while (st.length) {
      const top = st[st.length - 1];
      const list = outs.get(top[0]);
      if (top[1] >= list.length) { state.set(top[0], 2); st.pop(); continue; }
      const e = list[top[1]++];
      const s = state.get(e.to);
      if (s === 1) e.back = true;
      else if (!s) { state.set(e.to, 1); st.push([e.to, 0]); }
    }
  };
  if (start) visit(start);
  for (const n of flow) if (!state.get(n.id)) visit(n.id);

  // 段 = 最長路（戻り辺を除いた DAG）
  const rank = new Map(flow.map((n) => [n.id, 0]));
  const deg = new Map(flow.map((n) => [n.id, 0]));
  for (const e of edges) if (!e.data && !e.back) deg.set(e.to, deg.get(e.to) + 1);
  const queue = flow.filter((n) => deg.get(n.id) === 0).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift();
    for (const e of outs.get(id)) {
      if (e.back) continue;
      rank.set(e.to, Math.max(rank.get(e.to), rank.get(id) + 1));
      deg.set(e.to, deg.get(e.to) - 1);
      if (deg.get(e.to) === 0) queue.push(e.to);
    }
  }

  const laneZ = new Map(lanes.map((l, i) => [l, i * LANE_DEPTH]));
  const slots = new Map();
  const out = [];
  for (const n of flow) {
    const r = rank.get(n.id);
    const key = `${n.lane}|${r}`;
    const k = slots.get(key) || 0;
    slots.set(key, k + 1);
    const hasOut = outs.get(n.id).length > 0;
    out.push({ ...n, side: false, x: r * X_STEP + (k ? 0.9 : 0), z: laneZ.get(n.lane) + k * 1.7, drill: opts.isDiagram(n.id), isEnd: n.type === 'terminal' && !hasOut && n.id !== start });
  }
  const pos = new Map(out.map((n) => [n.id, n]));
  const perSource = new Map();
  const maxX = Math.max(0, ...out.map((n) => n.x));
  for (const n of d.nodes.filter((x) => sideIds.has(x.id))) {
    const link = edges.find((e) => e.to === n.id && pos.has(e.from)) || edges.find((e) => e.from === n.id && pos.has(e.to));
    const anchor = link ? pos.get(link.to === n.id ? link.from : link.to) : null;
    const k = anchor ? (perSource.get(anchor.id) || 0) : 0;
    if (anchor) perSource.set(anchor.id, k + 1);
    const x = anchor ? anchor.x - 0.45 + k * 0.8 : maxX + X_STEP;
    const z = anchor ? anchor.z + 1.45 : laneZ.get(n.lane);
    out.push({ ...n, side: true, x, z, drill: false, isEnd: false });
  }
  for (const n of out) if (opts.omitNotes) n.note = '';

  const xs = out.map((n) => n.x);
  const zs = out.map((n) => n.z);
  return {
    lanes: lanes.map((name, i) => ({ name, z: laneZ.get(name), color: LANE_COLORS[i % LANE_COLORS.length], animal: laneAnimal.get(name), animalName: ANIMAL_NAME[laneAnimal.get(name)] })),
    nodes: out,
    edges: edges.map(({ from, to, label, dashed, back, data }) => ({ from, to, label, dashed, back, data })),
    start,
    bounds: { minX: Math.min(0, ...xs) - 1, maxX: Math.max(0, ...xs) + 1, minZ: Math.min(0, ...zs) - 2.4, maxZ: Math.max(0, ...zs) + 2 },
  };
}

// ---------- 組み立て ----------
function parentOf(key, keys) {
  if (key === 'root') return null;
  const i = key.lastIndexOf('_');
  const p = i > 0 ? key.slice(0, i) : 'root';
  return keys.includes(p) ? p : 'root';
}

function build(diagrams, office, baseName) {
  const keys = Object.keys(diagrams);
  if (!keys.includes('root')) fail(['animal-office-build: diagrams.json に "root" が無い（get_project の content.diagrams をそのまま入れる）']);
  const order = ['root', ...keys.filter((k) => k !== 'root').sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))];
  const parsed = {};
  const warn = [];
  for (const k of order) {
    parsed[k] = parseMmd(diagrams[k]);
    if (!parsed[k].nodes.length) fail([`animal-office-build: 図 "${k}" からノードを1つも読めなかった（flowchart の原文か確かめる）`]);
    if (parsed[k].unparsed.length) warn.push(`図 "${k}" で読めなかった行 ${parsed[k].unparsed.length} 件: ${parsed[k].unparsed.slice(0, 3).map((l) => JSON.stringify(l)).join(' / ')}`);
  }

  // 部署 → 動物。全フロアのレーン名の和集合に、root から順に割り当てる（同じ部署は階が変わっても同じ動物）
  const fixed = office.animals || {};
  for (const [lane, key] of Object.entries(fixed)) {
    if (!ANIMAL_NAME[key]) fail([`animal-office-build: office.json の animals["${lane}"] = "${key}" は無い動物。使えるのは ${ANIMALS.map((a) => a[0]).join(' / ')}`]);
  }
  const laneAnimal = new Map();
  const used = new Set(Object.values(fixed));
  let next = 0;
  for (const k of order) {
    const names = [...parsed[k].lanes];
    if (parsed[k].nodes.some((n) => !n.lane)) names.push(NO_LANE);
    for (const name of names) {
      if (laneAnimal.has(name)) continue;
      if (fixed[name]) { laneAnimal.set(name, fixed[name]); continue; }
      let pick = null;
      for (let i = 0; i < ANIMALS.length && !pick; i += 1) {
        const cand = ANIMALS[(next + i) % ANIMALS.length][0];
        if (!used.has(cand)) { pick = cand; next = (next + i + 1) % ANIMALS.length; }
      }
      if (!pick) { pick = ANIMALS[next % ANIMALS.length][0]; next += 1; } // 14 部署を超えたら使い回す
      used.add(pick);
      laneAnimal.set(name, pick);
    }
  }

  const title = office.title || baseName;
  const floors = {};
  const depthOf = (k) => { let d = 0; for (let p = parentOf(k, keys); p; p = parentOf(p, keys)) d += 1; return d; };
  for (const k of order) {
    const parent = parentOf(k, keys);
    const parentNode = parent ? parsed[parent].nodes.find((n) => n.id === k) : null;
    const depth = depthOf(k);
    floors[k] = {
      key: k,
      parent,
      depth,
      floorName: depth === 0 ? '1F' : `B${depth}F`,
      title: k === 'root' ? title : (parentNode ? parentNode.label : k),
      ...layout(parsed[k], laneAnimal, { isDiagram: (id) => id !== 'root' && keys.includes(id), omitNotes: !!office.omitNotes }),
    };
  }
  const models = {};
  for (const key of new Set(laneAnimal.values())) {
    const file = path.join(ASSETS, 'models', `staff_${key}.glb`);
    if (!fs.existsSync(file)) fail([`animal-office-build: 動物モデルが無い: assets/animal-office/models/staff_${key}.glb`], 1);
    models[key] = fs.readFileSync(file).toString('base64');
  }
  const data = { title, rootKey: 'root', order, floors };
  return { data, models, warn, lanes: laneAnimal };
}

const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function page(data, models, runtime) {
  return `<!doctype html>
<!-- 直し: __COUNT__/${LIMIT} -->
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="drillspark-harness animal-office-view">
<title>${esc(data.title)}</title>
</head>
<body>
<div id="app" aria-label="${esc(data.title)} の 3D 表示"></div>
<noscript>このページは JavaScript で 3D を描きます。</noscript>
<script type="application/json" id="office-data">${json(data)}</script>
<script type="application/json" id="office-models">${json(models)}</script>
<script>${runtime.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>
`;
}

function main() {
  const arg = process.argv[2];
  if (!arg || !/\.(diagrams|office)\.json$/.test(arg)) {
    fail(['使い方: node animal-office-build.js <置き場>/<名前>.diagrams.json（または <名前>.office.json）']);
  }
  const base = arg.replace(/\.(diagrams|office)\.json$/, '');
  const diagPath = `${base}.diagrams.json`;
  const officePath = `${base}.office.json`;
  const outPath = path.resolve(`${base}.office.html`);
  if (!fs.existsSync(diagPath)) fail([`animal-office-build: ${path.basename(diagPath)} が無い。get_project の content.diagrams をそのまま Write する`]);
  let diagrams;
  try { diagrams = JSON.parse(fs.readFileSync(diagPath, 'utf8')); } catch (e) { fail([`animal-office-build: diagrams.json が読めない: ${e.message}`]); }
  if (diagrams && diagrams.content && diagrams.content.diagrams) diagrams = diagrams.content.diagrams; // get_project の data ごと写した場合
  if (!diagrams || typeof diagrams !== 'object' || Array.isArray(diagrams)) fail(['animal-office-build: diagrams.json は { "root": "flowchart …", … } の形にする']);
  let office = {};
  if (fs.existsSync(officePath)) {
    try { office = JSON.parse(fs.readFileSync(officePath, 'utf8')); } catch (e) { fail([`animal-office-build: office.json が読めない: ${e.message}`]); }
  }
  const runtimePath = path.join(ASSETS, 'runtime.js');
  if (!fs.existsSync(runtimePath)) fail(['animal-office-build: assets/animal-office/runtime.js が無い（プラグインの同梱物が欠けている）'], 1);

  const { data, models, warn, lanes } = build(diagrams, office, path.basename(base));
  let html = page(data, models, fs.readFileSync(runtimePath, 'utf8'));

  let count = 0;
  if (fs.existsSync(outPath)) {
    const m = /<!--\s*直し:\s*(\d+)\s*\/\s*\d+\s*-->/.exec(fs.readFileSync(outPath, 'utf8').slice(0, 4000));
    if (!m) fail([`animal-office-build: ${path.basename(outPath)} は既にあり回数欄が無い。既存の1枚は上書きしない — 連番を足した名前にする`]);
    count = Number(m[1]) + 1;
  }
  if (count > LIMIT) fail([`animal-office-build: 作り直しは上限 ${LIMIT} 回（今回で ${count} 回目）。新しい1枚は <名前>-2.diagrams.json のように連番を足して作る。`]);
  html = html.replace('__COUNT__', String(count));

  // 書く前に柵を通す（Write と同じ検査: 上書き・回数欄・animal-office-lint）
  const guard = path.join(__dirname, 'harness-view-guard.js');
  const g = spawnSync(process.execPath, [guard], { input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: outPath, content: html } }), encoding: 'utf8', env: { ...process.env, DRILLSPARK_HARNESS_GUARDS: '', ANIMAL_OFFICE_BUILD: '1' }, maxBuffer: 64 * 1024 * 1024 });
  if (g.status !== 0) fail([`animal-office-build: 柵に止められたので書かない（exit ${g.status}）。diagrams.json か office.json を直して再実行する。`, (g.stderr || g.stdout || '').trim()], g.status === 2 ? 2 : 1);

  fs.writeFileSync(outPath, html);
  for (const w of warn) process.stderr.write(`注意: ${w}（その行の辺やノードは会社に出ない）\n`);
  const floorsN = Object.keys(data.floors).length;
  const nodesN = Object.values(data.floors).reduce((s, f) => s + f.nodes.length, 0);
  const cast = [...lanes].map(([lane, a]) => `${lane}=${ANIMAL_NAME[a]}`).join('、');
  process.stdout.write(`OK  ${outPath}  ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB  回数欄 ${count}/${LIMIT}  フロア ${floorsN}・工程 ${nodesN}\n    配属: ${cast}\n`);
}

main();
