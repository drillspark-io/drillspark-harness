#!/usr/bin/env node
/**
 * diagram-lint — DrillSpark の図の「構造」を決定論で検査する。
 *
 *   node "$CLAUDE_PLUGIN_ROOT/scripts/diagram-lint.js" <file.mmd>
 *   MCP で取得した mermaid をそのまま流す場合:
 *     ... | node "$CLAUDE_PLUGIN_ROOT/scripts/diagram-lint.js" -
 *
 * 依存なし（Node 標準の fs だけ）。どのリポジトリからでも単体で動く。
 * exit 0 = 合格 / 2 = 違反あり / 1 = 実行エラー
 *
 * なぜ要るか:
 *   `validate_diagram` は**構文しか見ない**。実測で、decision を経ずに
 *   task から2本の出力を引いた図が2回とも valid:true で通った。
 *   ファイル編集に反応する hook はリポジトリ内のファイルにしか当たらないので、
 *   MCP で取得しただけの図には効かない。数値IDの検査をこちらにも置いてあるのはそのため。
 *
 * 見ないもの（決定論に落ちないので `reference/harness-design-criteria.md` のレビュー側 MUST に残す）:
 *   - 上限を超えたときの行き先 / 親子の備考の整合 / 段階の混入
 *   - task ラベルが「動詞＋名詞」か（日本語の品詞判定は決定論にならない）
 *   - データ系ノード（document / database）から複数のノードへ引く線。
 *     複数の読み手へ配るのは Data Association として正当なので、分岐かどうかを機械で区別できない
 */

const fs = require('fs');

const NODE_SHAPES = [
  { re: /^([A-Za-z0-9_]+)@\{\s*shape:\s*doc\s*,\s*label:\s*"([^"]*)"\s*\}/, type: 'document' },
  { re: /^([A-Za-z0-9_]+)\(\["([^"]*)"\]\)/, type: 'terminal' },
  { re: /^([A-Za-z0-9_]+)\[\("([^"]*)"\)\]/, type: 'database' },
  { re: /^([A-Za-z0-9_]+)\[\["([^"]*)"\]\]/, type: 'subroutine' },
  { re: /^([A-Za-z0-9_]+)\[\/"([^"]*)"\/\]/, type: 'io' },
  { re: /^([A-Za-z0-9_]+)\{"([^"]*)"\}/, type: 'decision' },
  { re: /^([A-Za-z0-9_]+)\["([^"]*)"\]/, type: 'task' },
];

const EDGE = /^([A-Za-z0-9_]+)\s*(-\.->|-->)\s*(?:\|\s*"?([^|"]*)"?\s*\|\s*)?([A-Za-z0-9_]+)\s*$/;
const ARROW = /(-\.->|-->)/g;
const DURATION = /^%%\s*duration\[([A-Za-z0-9_]+)\]\s*:/;
const SUBGRAPH = /^subgraph\s+([A-Za-z0-9_]+)\s*\[/;
const SKIP = /^(flowchart|graph|direction|click|classDef|class\s|style\s|linkStyle)/;
const NUMERIC_ID = /^[0-9]+(_[0-9]+)*$/;

/** データ系＝BPMN の Data Object / Data Store。フローのノードではないので一部の検査から外す */
const DATA_TYPES = new Set(['document', 'database']);

function parse(src) {
  const nodes = new Map();
  const edges = [];
  const durations = new Set();
  const duplicates = [];
  const unparsed = [];
  const laneStack = [];
  // 解析できない行は黙って捨てない。捨てると、そこに書かれていたエッジが
  // 無いものとして扱われ、到達不能や出口なしが「事実でない指摘」として大量に出る
  const reject = (lineNo, line, hint) => unparsed.push({
    line: lineNo,
    text: line.length > 60 ? line.slice(0, 60) + '…' : line,
    hint,
  });

  src.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const lineNo = i + 1;
    if (!line) return;

    const dur = line.match(DURATION);
    if (dur) { durations.add(dur[1]); return; }
    if (line.startsWith('%%')) return;

    const sg = line.match(SUBGRAPH);
    if (sg) { laneStack.push(sg[1]); return; }
    if (line === 'end') { laneStack.pop(); return; }
    if (SKIP.test(line)) return;

    const edge = line.match(EDGE);
    if (edge) {
      edges.push({ from: edge[1], to: edge[4], dashed: edge[2] === '-.->', label: (edge[3] || '').trim(), line: lineNo });
      return;
    }

    for (const shape of NODE_SHAPES) {
      const m = line.match(shape.re);
      if (!m) continue;
      // シェイプの後ろに何か残っている行（`2["X"] --> 3["Y"]`）は、定義としてもエッジとしても
      // 読めていない。先頭だけ取って残りを捨てると、エッジが消えたうえに再定義（DUPLICATE）に見える
      if (line.slice(m[0].length).trim()) {
        reject(lineNo, line, '1行に1つの定義。エッジは別行に分ける');
        return;
      }
      if (nodes.has(m[1])) duplicates.push({ id: m[1], line: lineNo, first: nodes.get(m[1]).line });
      nodes.set(m[1], {
        id: m[1], type: shape.type, label: m[2],
        lane: laneStack.length ? laneStack[laneStack.length - 1] : null,
        line: lineNo,
      });
      return;
    }

    const arrows = (line.match(ARROW) || []).length;
    reject(lineNo, line, arrows > 1 ? '連結エッジは1行1エッジに分ける' : (arrows === 1 ? 'エッジの書式が読めない' : 'ラベルは二重引用符で囲む'));
  });

  return { nodes, edges, durations, duplicates, unparsed };
}

function lint(src) {
  const findings = [];
  const add = (code, id, message) => findings.push({ code, id, message });

  if (!/^\s*flowchart\s+(TD|LR|TB|RL|BT)/m.test(src)) {
    add('SYNTAX', '-', 'flowchart TD|LR で始まっていない（graph は不可）');
    return findings;
  }

  const { nodes, edges, durations, duplicates, unparsed } = parse(src);
  // 1つも認識できなかった回でも、読めなかった行は先に出す。全行が `1["X"] --> 2["Y"]` の
  // 連結書きだと、ここで止めたときに「二重引用符で囲む」だけが残って直す場所を誤る
  for (const u of unparsed) add('UNPARSED', `${u.line}行目`, `解析できない: ${u.text} — ${u.hint}`);
  if (nodes.size === 0) {
    add('SYNTAX', '-', 'ノード定義を1つも認識できなかった。ラベルは二重引用符で囲む');
    return findings;
  }

  for (const d of duplicates) add('DUPLICATE', d.id, `${d.first}行目で定義済みのIDを ${d.line}行目で再定義している（先の定義が消える）`);

  const out = new Map();
  const inbound = new Map();
  for (const id of nodes.keys()) { out.set(id, []); inbound.set(id, []); }

  for (const e of edges) {
    for (const end of [e.from, e.to]) {
      if (!nodes.has(end)) add('UNDEFINED', end, `${e.line}行目のエッジが未定義のノード ${end} を指している`);
    }
    if (nodes.has(e.from) && nodes.has(e.to)) {
      out.get(e.from).push(e);
      inbound.get(e.to).push(e);
    }
  }

  for (const n of nodes.values()) {
    if (!NUMERIC_ID.test(n.id)) add('NODE_ID', n.id, 'ノードIDは数値（1・2・5_10_12）にする。英字IDは不可');
    if (!durations.has(n.id)) add('NO_DURATION', n.id, `%% duration[${n.id}]: が無い`);
    if (n.type === 'decision' && !/[?？]\s*$/.test(n.label.replace(/<br\/>.*$/s, '').trim())) {
      add('DECISION_FORM', n.id, `decision のラベルは疑問形にする（現在: "${n.label.split('<br/>')[0]}"）`);
    }
  }

  // Start / End はラベルではなく構造で決める。入りが無い terminal が Start、出が無い terminal が End。
  // ラベル文字列で判定すると、日本語の終端ラベルが一律で落ちる
  const terminals = [...nodes.values()].filter((n) => n.type === 'terminal');
  const starts = terminals.filter((n) => inbound.get(n.id).length === 0 && out.get(n.id).length > 0);
  const ends = terminals.filter((n) => out.get(n.id).length === 0 && inbound.get(n.id).length > 0);
  // Start / End の判定も入出次数に依るので、エッジを読み落としている回は出さない。
  // NO_EXIT と UNREACHABLE を抑止しておきながらここだけ漏れていた（段階7の初回評価で検出）
  if (unparsed.length === 0) {
    if (starts.length !== 1) add('START_END', '-', `入りエッジの無い terminal（＝Start）が ${starts.length} 個。1個であること`);
    if (ends.length !== 1) add('START_END', '-', `出エッジの無い terminal（＝End）が ${ends.length} 個。1個であること`);
  }

  const flowNodes = [...nodes.values()].filter((n) => !DATA_TYPES.has(n.type));
  // 10までは目安（DrillSpark 規約の aim）。止めるのは 15 超だけ — 分かりやすさのための
  // 1ノード追加を上限が阻まないようにする（オーナー決定）
  if (flowNodes.length < 5 || flowNodes.length > 15) {
    add('NODE_COUNT', '-', `process 系ノードが ${flowNodes.length} 個（5〜15に収める。10までが目安。document/database は数えない）`);
  }

  // 分岐は decision から出す。ただしデータ系への線は Data Association なので分岐に数えない
  for (const n of nodes.values()) {
    if (n.type === 'decision' || DATA_TYPES.has(n.type)) continue;
    const branches = out.get(n.id).filter((e) => {
      const dst = nodes.get(e.to);
      return dst && !DATA_TYPES.has(dst.type);
    });
    if (branches.length > 1) {
      add('MULTI_OUTPUT', n.id,
        `${n.type} ノードから出力が ${branches.length} 本（→ ${branches.map((e) => e.to).join(', ')}）。分岐は decision {} から出す`);
    }
  }

  // 出口の無いノードと到達可能性は、エッジを全部読めていることが前提。
  // 解析できない行が1つでもあると、そこに書かれていたエッジが無いものとして扱われ、
  // 「事実でない出口なし／到達不能」が大量に出て、読む側が別の場所を直しに行く
  if (unparsed.length > 0) {
    add('SKIPPED', '-', '解析できない行があるため、出口と到達可能性の検査を飛ばした。上の UNPARSED を先に直す');
  } else {
    // 出口の無いノード。End とデータ系は除く（データ系はフローのノードではない）
    for (const n of nodes.values()) {
      if (DATA_TYPES.has(n.type)) continue;
      if (n.type === 'terminal' && out.get(n.id).length === 0 && inbound.get(n.id).length > 0) continue;
      if (out.get(n.id).length === 0) add('NO_EXIT', n.id, '出力エッジが無い（End 以外は次へ繋ぐ）');
    }
  }

  if (unparsed.length === 0 && starts.length === 1) {
    const seen = new Set([starts[0].id]);
    const queue = [starts[0].id];
    while (queue.length) {
      for (const e of out.get(queue.shift())) {
        if (!seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
      }
    }
    for (const n of nodes.values()) {
      if (seen.has(n.id)) continue;
      if (DATA_TYPES.has(n.type)) {
        if (out.get(n.id).length === 0 && inbound.get(n.id).length === 0) {
          add('ORPHAN', n.id, 'どのノードとも繋がっていない');
        }
        continue;
      }
      add('UNREACHABLE', n.id, 'Start から到達できない');
    }
  }

  // 実線は同一レーン内、点線はレーンを跨ぐときだけ。レーン無しの図（単一担当）では飛ばす
  const usesLanes = [...nodes.values()].some((n) => n.lane !== null);
  if (usesLanes) {
    for (const e of edges) {
      const from = nodes.get(e.from);
      const to = nodes.get(e.to);
      if (!from || !to || from.lane === null || to.lane === null) continue;
      const crosses = from.lane !== to.lane;
      if (crosses && !e.dashed) {
        add('EDGE_STYLE', `${e.from}->${e.to}`, 'レーンを跨ぐのに実線 --> を使っている（点線 -.-> にする）');
      } else if (!crosses && e.dashed) {
        add('EDGE_STYLE', `${e.from}->${e.to}`, '同一レーン内なのに点線 -.-> を使っている（実線 --> にする）');
      }
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
