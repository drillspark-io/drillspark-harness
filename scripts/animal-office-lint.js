#!/usr/bin/env node
/**
 * animal-office-lint — `animal-office-view` の1枚（*.office.html）が契約どおりかを決定論で検査する。
 *
 *   node "$CLAUDE_PLUGIN_ROOT/scripts/animal-office-lint.js" <file.office.html>
 *   標準入力から流す場合: ... | node "$CLAUDE_PLUGIN_ROOT/scripts/animal-office-lint.js" -
 *
 * exit 0 = 合格 / 2 = 違反あり / 1 = 実行エラー
 *
 * 見るもの:
 *   - EXTERNAL_REF  タグの属性・CSS で外を読んでいる（script src・link href・img src・url(http…)・@import）
 *   - NO_DATA       office-data / office-models / ランタイムの <script> が無い・JSON として読めない
 *   - BROKEN_DATA   フロアに工程が無い・ID の重複・辺の端が無い・部署の動物のモデルが無い・モデルが glTF でない
 *   - TOO_LARGE     8 MB を超える（開くのが重くなり、共有しにくい）
 *   - PRIVATE_INFO  利用者のホーム配下の絶対パス・UUID・メールアドレス・API キーの形（図の備考から入りうる）
 *
 * 見ないもの（**実装に無い**）:
 *   - 3D が実際に描けるか・動物が正しい位置に立つか（ブラウザで開いて見る）
 *   - インラインのランタイム（three.js 同梱）の中身。私的情報もランタイムと base64 のモデルの中は見ない
 *     （base64 は偶然 `/home/` の並びを含みうるため、データの JSON と HTML の地の部分だけを見る）
 *
 * 依存なし（Node 標準の fs だけ）。
 */

'use strict';
const fs = require('fs');

const MAX_BYTES = 8 * 1024 * 1024;
const PRIVATE_PATTERNS = [
  { re: /[A-Za-z]:[\\/](?:Users|home)[\\/][^\s"'<>]+/g, what: '利用者のホーム配下の絶対パス' },
  { re: /\/(?:Users|home)\/[A-Za-z0-9._-]+[^\s"'<>]*/g, what: '利用者のホーム配下の絶対パス' },
  { re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, what: 'UUID（プロジェクトID・セッションID）' },
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, what: 'メールアドレス' },
  { re: /\b(?:Bearer\s+[A-Za-z0-9._-]{8,}|dsk_[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/g, what: 'API キー・トークン' },
];
const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const LOAD_ATTR = /<([a-z][\w-]*)\b[^>]*?\s(src|href|srcset|poster|data)\s*=\s*["']?([^"'\s>]+)/gi;

function clip(text, max = 40) {
  const one = String(text).replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max) + '…' : one;
}

function lint(src) {
  const findings = [];
  const add = (code, id, message) => findings.push({ code, id, message });

  if (!/<html[\s>]/i.test(src) || !/<body[\s>]/i.test(src)) {
    add('SYNTAX', '-', '<html> と <body> が見当たらない');
    return findings;
  }
  const bytes = Buffer.byteLength(src);
  if (bytes > MAX_BYTES) add('TOO_LARGE', '-', `${(bytes / 1024 / 1024).toFixed(1)} MB（上限 8 MB）。部署を減らすか図を分ける`);

  // <script> を取り出し、地の HTML からは中身を抜く（three.js の文字列を外部読み込みと取り違えない）
  const scripts = [];
  const shell = src.replace(SCRIPT, (m, attrs, body) => {
    scripts.push({ attrs, body });
    return `<script${attrs}></script>`;
  }).replace(/<!--[\s\S]*?-->/g, '');

  LOAD_ATTR.lastIndex = 0;
  let a;
  while ((a = LOAD_ATTR.exec(shell)) !== null) {
    const [, tag, attr, value] = a;
    if (tag.toLowerCase() === 'a') continue;
    if (/^(data:|#)/i.test(value)) continue;
    add('EXTERNAL_REF', `<${tag} ${attr}>`, `外部を読んでいる: ${clip(value)} — 1ファイル完結にする`);
  }
  for (const re of [/url\(\s*["']?((?:https?:)?\/\/[^"')]+)/gi, /@import\s+(?:url\()?\s*["']?([^"';)\s]+)/gi]) {
    let m;
    while ((m = re.exec(shell)) !== null) add('EXTERNAL_REF', 'CSS', `外部を読んでいる: ${clip(m[1])}`);
  }
  for (const s of scripts) {
    if (/\bsrc\s*=/.test(s.attrs)) add('EXTERNAL_REF', '<script src>', 'ランタイムはインラインで埋め込む（script src は使わない）');
  }

  const byId = (id) => scripts.find((s) => new RegExp(`id=["']${id}["']`).test(s.attrs));
  const parse = (id) => {
    const s = byId(id);
    if (!s) { add('NO_DATA', id, `<script type="application/json" id="${id}"> が無い`); return null; }
    try { return JSON.parse(s.body); } catch (e) { add('NO_DATA', id, `JSON として読めない: ${clip(e.message)}`); return null; }
  };
  const data = parse('office-data');
  const models = parse('office-models');
  if (!scripts.some((s) => /animal-office runtime/.test(s.body.slice(0, 400)))) add('NO_DATA', 'runtime', '同梱ランタイム（assets/animal-office/runtime.js）が埋め込まれていない');

  if (data) {
    const floors = data.floors || {};
    if (!floors[data.rootKey]) add('BROKEN_DATA', 'rootKey', `rootKey "${data.rootKey}" のフロアが無い`);
    for (const [key, f] of Object.entries(floors)) {
      const ids = new Set();
      if (!Array.isArray(f.nodes) || !f.nodes.length) { add('BROKEN_DATA', key, 'フロアに工程が無い'); continue; }
      for (const n of f.nodes) {
        if (ids.has(n.id)) add('BROKEN_DATA', `${key}/${n.id}`, 'ノード ID がフロア内で重複している');
        ids.add(n.id);
        if (!Number.isFinite(n.x) || !Number.isFinite(n.z)) add('BROKEN_DATA', `${key}/${n.id}`, '座標が無い');
        if (n.drill && !floors[n.id]) add('BROKEN_DATA', `${key}/${n.id}`, '下の階があるはずの工程に、その階が無い');
      }
      for (const e of f.edges || []) {
        if (!ids.has(e.from) || !ids.has(e.to)) add('BROKEN_DATA', `${key}/${e.from}->${e.to}`, '辺の端のノードが無い');
      }
      for (const l of f.lanes || []) {
        if (models && !models[l.animal]) add('BROKEN_DATA', `${key}/${l.name}`, `部署の動物「${l.animal}」のモデルが埋め込まれていない`);
      }
      if (f.start && !ids.has(f.start)) add('BROKEN_DATA', key, `開始 "${f.start}" がフロアに無い`);
    }
  }
  if (models) {
    for (const [k, b64] of Object.entries(models)) {
      if (typeof b64 !== 'string' || !b64.startsWith('Z2xURg')) add('BROKEN_DATA', `model/${k}`, 'glTF バイナリ（.glb）の base64 でない');
    }
  }

  // 私的情報: データの JSON と地の HTML だけを見る
  const dataText = byId('office-data') ? byId('office-data').body : '';
  const seen = new Set();
  for (const [where, text] of [['office-data', dataText], ['HTML', shell]]) {
    for (const p of PRIVATE_PATTERNS) {
      p.re.lastIndex = 0;
      let q;
      while ((q = p.re.exec(text)) !== null) {
        if (seen.has(q[0])) continue;
        seen.add(q[0]);
        add('PRIVATE_INFO', where, `${p.what}が入っている: ${clip(q[0], 24)}（図の備考なら office.json の "omitNotes": true で外せる）`);
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
  if (!findings.length) {
    console.log(`OK  ${where}`);
    process.exit(0);
  }
  console.error(`NG  ${where} — ${findings.length} 件`);
  for (const f of findings) console.error(`  [${f.code}] ${f.id}: ${f.message}`);
  process.exit(2);
}

main();
