#!/usr/bin/env node
/**
 * process-table-lint — 業務改善の4つの表（業務一覧・改善案・AI化依頼書・保留）の
 * 「記入漏れ」と「定義に無い値」を決定論で検査する。
 *
 *   node "$CLAUDE_PLUGIN_ROOT/scripts/process-table-lint.js" <file.md>
 *   標準入力から流す場合: ... | node "$CLAUDE_PLUGIN_ROOT/scripts/process-table-lint.js" -
 *   表どうしを突き合わせる: ... <file.md> --list 業務改善/業務一覧.md
 *     （検査する表に業務一覧が無いとき、突き合わせ先の一覧を別ファイルで渡す）
 *
 * 依存なし（Node 標準の fs だけ）。どのリポジトリからでも単体で動く。
 * exit 0 = 合格 / 2 = 違反あり / 1 = 実行エラー
 *
 * なぜ要るか:
 *   `reference/business-improvement-tables.md` の原則は「**空欄だけが不合格**」。
 *   ところが空欄は目視で最も落ちる。加えて「保留」「未計測」「3種の語だけ並べる」は、
 *   **中身を決めないまま全行を承認まで通せる**逃げ道になる。
 *   逃げ道を塞ぐのは人間の注意力ではなく機械の仕事。
 *
 * **列が消えると検査も消える。** 検査は列を名前で引くので、列ごと落ちた表は
 *   「その検査が無かったこと」になって静かに通る。だから
 *   **表として認識できたのに必須列が欠けているもの**（MISSING_COLUMN）と、
 *   **業務改善の列名を持つのに4つのどれとも一致しないもの**（UNKNOWN_TABLE）を
 *   先に落とす。素通りさせない。
 *
 * **定義に無い値も落とす**（ENUM_VALUE）。`ECRS=AI化` `誰がやるか=両方` `出どころ=不明` は
 *   埋まって見えるが何も決めていない。列挙値は雛形と同じ一覧をここに持つ。
 *
 * 見ないもの（**実装に無い。ここを実際より広く書くと、通ったことが根拠に使われる**）:
 *   - **私的情報**（絶対パス・メール・UUID）。この lint は一切見ない
 *   - `承認が要る操作` の判断の**妥当さ**（`承認なし` を選ぶのは可。決めていないのが不合格）。
 *     見るのは「3種それぞれに判断が1つ続いているか」だけで、
 *     **`<種類>: <判断>` の並び順を前提にする**（`承認あり（外部送信）` のような逆順は拾えない）
 *   - `かかる時間` が `頻度 × 所要時間 = 合計` の形か（数字が1つでもあれば「ある」と見る）
 *   - `保留：`／`未確認：` の後ろが実在の人名か（日本語の固有名詞判定は決定論にならない）
 *   - `優先度` の根拠が「仕事の目的」への効き方か（数字であることしか見ない）
 *   - **4つの表がそろっているか**（無い表は無いまま通る。1ファイル1表でも複数表でも動く）
 *   - **業務改善の列名を2つ以上持たない表**（別件の表と見なして触らない）
 *   - 改善案.md の「成功の形」「案が出なかった段階とその理由」の節（表ではないので対象外）
 *   - 行の `工程` が図に実在するか（図はこのファイルの外にある。先頭がノードIDの形かだけ見る）
 *   - 業務一覧が手元に無いときの突き合わせ（`--list` で渡されず、同じファイルにも無ければ
 *     GUESSED_IN_REQUEST と DETAIL_MISSING は**出ない**。無いことを咎めない）
 */

const fs = require('fs');

/**
 * 表の種類は**ヘッダの列名**で決める。ファイル名で決めない
 * （1つのファイルに複数の表が入ることも、別名で保存されることもある）。
 * `must` は種類を見分けるための鍵、`columns` は揃っていなければならない全列。
 */
const TABLES = [
  {
    kind: '業務一覧',
    must: ['業務名', '仕事の目的'],
    columns: ['業務名', '誰が', 'きっかけ', '作業', '使う道具', '次へ渡す先',
      'かかる時間', '測り方', '仕事の目的', '聞いた相手', '図の在りか'],
  },
  {
    kind: 'AI化依頼書',
    must: ['任せ方', '承認が要る操作'],
    columns: ['業務名', '工程', '任せ方', '承認が要る操作', '削減見込み'],
  },
  {
    kind: '改善案',
    must: ['ECRS', '誰がやるか'],
    columns: ['業務名', '工程', 'ECRS', '誰がやるか', '優先度', '出どころ', '改善案'],
  },
  {
    kind: '保留',
    must: ['相談先'],
    columns: ['何が決まらなかったか', '相談先', 'いつ'],
  },
];

/** どれかの表に出る列名。2つ以上を持つ表は「業務改善の表のつもり」と見なす */
const ALL_COLUMNS = new Set(TABLES.flatMap((t) => t.columns));

/** 何列を共有したら「業務改善の表のつもり」と見なすか。1にすると別件の表を巻き込む */
const SUSPICIOUS_AT = 2;

/** 空でも不合格にしない列。図を描く前は埋まらない */
const EMPTY_OK = new Set(['図の在りか']);

/**
 * 定義された値（雛形 `business-improvement-tables.md` と同じ）。前方一致。
 * `聞いた相手` の `◯◯さん` は名前が入るので「さん」で終わることだけ見る
 */
const ENUMS = {
  '測り方': { re: /^(実測|実績記入|推定比率|未計測)$/, allowed: '実測／実績記入／推定比率／未計測' },
  'ECRS': { re: /^(E\s*なくす|C\s*まとめる|R\s*並び替える|S\s*簡単にする)/, allowed: 'E なくす／C まとめる／R 並び替える／S 簡単にする' },
  '誰がやるか': { re: /^(人がやる|AIに任せる)$/, allowed: '人がやる／AIに任せる' },
  '出どころ': { re: /^(本人の答え|一般例)$/, allowed: '本人の答え／一般例' },
  '聞いた相手': { re: /^(本人|AIの推測|.+さん)$/, allowed: '本人／◯◯さん／AIの推測' },
  '優先度': { re: /^[0-9０-９]+$/, allowed: '数字（1 が最優先）' },
};

/** 業務一覧で「分からない」を値として書ける列と、その書き方 */
const UNCONFIRMED_COLUMNS = ['誰が', 'きっかけ', '作業', '使う道具', '次へ渡す先', 'かかる時間'];
/** 工程2で選ばれてから聞く4列。それまでは `後で聞く` と書ける（2段の業務一覧） */
const LATER_COLUMNS = ['きっかけ', '作業', '使う道具', '次へ渡す先'];
const LATER = '後で聞く';

/** 工程の列は図のノードIDで始まる（`3` ／ `3_2`。バッククォート付きでも可） */
const NODE_REF = /^`?[0-9]+(_[0-9]+)*`?(\s|$)/;

/** 承認が要る操作に必ず3つとも出る種類と、それぞれに1つ続く判断 */
const APPROVAL_KINDS = ['外部送信', 'データ更新', '金銭'];
const APPROVAL_DECISIONS = ['承認あり', '承認なし', '該当なし'];

/** 削減見込みを書かない任せ方（人が主導する作業の短縮は測れない） */
const NO_ESTIMATE = /H[3-5]/;

const SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

/** Markdown の表を拾う。ヘッダ行 → 区切り行 → データ行 の並びだけを表と見なす */
function parseTables(src) {
  const lines = src.split(/\r?\n/);
  const tables = [];

  for (let i = 0; i < lines.length; i++) {
    if (!/\|/.test(lines[i])) continue;
    if (i + 1 >= lines.length || !SEPARATOR.test(lines[i + 1])) continue;

    const header = cells(lines[i]);
    const rows = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      const line = lines[j];
      if (!/\|/.test(line) || !line.trim()) break;
      rows.push({ values: cells(line), line: j + 1 });
    }

    const known = TABLES.find((t) => t.must.every((col) => header.includes(col)));
    const shared = header.filter((col) => ALL_COLUMNS.has(col));
    tables.push({
      kind: known ? known.kind : null,
      spec: known || null,
      header, rows, shared,
      line: i + 1,
    });
    i = j - 1;
  }

  return tables;
}

/** 業務一覧の行を業務名で引ける形にする（突き合わせ用） */
function indexList(tables) {
  const map = new Map();
  for (const t of tables.filter((t) => t.kind === '業務一覧')) {
    const at = (name) => t.header.indexOf(name);
    for (const row of t.rows) {
      const name = (row.values[at('業務名')] ?? '').trim();
      if (!name) continue;
      map.set(name, {
        asked: (row.values[at('聞いた相手')] ?? '').trim(),
        later: LATER_COLUMNS.filter((c) => at(c) !== -1 && (row.values[at(c)] ?? '').trim() === LATER),
      });
    }
  }
  return map;
}

function lint(src, listSrc) {
  const findings = [];
  const add = (code, id, message) => findings.push({ code, id, message });

  const tables = parseTables(src);
  const known = tables.filter((t) => t.kind);
  // 業務改善の列名を持つのに、4つの表のどれとも一致しないもの。
  // ヘッダの綴り違い・鍵になる列の欠落がここに落ちる。黙って通さない
  const suspicious = tables.filter((t) => !t.kind && t.shared.length >= SUSPICIOUS_AT);

  for (const t of suspicious) {
    add('UNKNOWN_TABLE', `${t.line}行目`,
      `業務改善の列名（${t.shared.join('・')}）を持つが、4つの表のどれとも一致しない — 見分けに使う列が欠けているか綴りが違う（業務一覧: 業務名＋仕事の目的 ／ 改善案: ECRS＋誰がやるか ／ AI化依頼書: 任せ方＋承認が要る操作 ／ 保留: 相談先）`);
  }

  if (known.length === 0 && suspicious.length === 0) {
    add('SYNTAX', '-', '業務改善の表を1つも認識できなかった（業務一覧・改善案・AI化依頼書・保留のどれかの列名を持つ表が要る）');
    return findings;
  }

  // 突き合わせ先の業務一覧: 同じファイルにあればそれ、無ければ --list のもの
  const list = indexList(known.some((t) => t.kind === '業務一覧') ? known : (listSrc ? parseTables(listSrc) : []));

  for (const table of known) {
    // 列が消えると、その列を引く検査ごと静かに消える。行を見る前に落とす
    const missingColumns = table.spec.columns.filter((col) => !table.header.includes(col));
    if (missingColumns.length > 0) {
      add('MISSING_COLUMN', `${table.line}行目`,
        `${table.kind}に ${missingColumns.join('・')} の列が無い（列ごと落ちると、その列を見る検査も一緒に消える）`);
    }

    const col = (row, name) => {
      const at = table.header.indexOf(name);
      return at === -1 ? null : (row.values[at] ?? '').trim();
    };

    for (const row of table.rows) {
      const where = `${row.line}行目`;
      /** その行で既に別コードを出した列。EMPTY_CELL と二重に出さない */
      const claimed = new Set();

      // 1. 行き先の無い「保留」「未確認」— 名前が無いと、答えられない行を全部保留にして承認を取れてしまう
      const purpose = col(row, '仕事の目的');
      if (purpose !== null && /^保留/.test(purpose)) {
        claimed.add('仕事の目的');
        const contact = purpose.replace(/^保留\s*[：:]?\s*/, '').trim();
        if (!contact) {
          add('HOLD_WITHOUT_CONTACT', where,
            `${table.kind}「仕事の目的」が「保留」だけで相談先の名前が無い（保留：◯◯さんに聞く の形にする）`);
        }
      }
      if (table.kind === '業務一覧') {
        for (const name of UNCONFIRMED_COLUMNS) {
          const v = col(row, name);
          if (v !== null && /^未確認/.test(v)) {
            claimed.add(name);
            const contact = v.replace(/^未確認\s*[：:]?\s*/, '').trim();
            if (!contact) {
              add('HOLD_WITHOUT_CONTACT', where,
                `${table.kind}「${name}」が「未確認」だけで相談先の名前が無い（未確認：◯◯さんに聞く の形にする）`);
            }
          }
        }
      }
      if (table.kind === '保留') {
        const contact = col(row, '相談先');
        if (contact !== null) {
          claimed.add('相談先');
          if (!contact) {
            add('HOLD_WITHOUT_CONTACT', where,
              `${table.kind}「相談先」が空。相談先の無い行は保留として成立しない`);
          }
        }
      }

      // 2. 時間の数字はあるが測り方が空 — 推定なのか実測なのかが読めない
      const method = col(row, '測り方');
      const time = col(row, 'かかる時間');
      if (method !== null && !method && time && /[0-9０-９]/.test(time)) {
        claimed.add('測り方');
        add('TIME_WITHOUT_METHOD', where,
          `${table.kind}「かかる時間」に数字（${time}）があるのに「測り方」が空（実測／実績記入／推定比率／未計測 のどれかを書く）`);
      }

      // 3. AI化依頼書 — 任せ方と、承認の3種それぞれの判断、削減見込みの置き場
      const has = table.kind === 'AI化依頼書' ? col(row, '任せ方') : null;
      if (table.kind === 'AI化依頼書') {
        if (has !== null) {
          claimed.add('任せ方');
          if (!/H[1-5]/.test(has)) {
            add('MISSING_HAS', where,
              `${table.kind}「任せ方」に H1〜H5 が無い（現在: "${has || '(空)'}"）`);
          }
        }
        const approval = col(row, '承認が要る操作');
        if (approval !== null) {
          claimed.add('承認が要る操作');
          const noWord = APPROVAL_KINDS.filter((k) => !approval.includes(k));
          // 語だけ並べても何も決めたことにならない。3種それぞれに判断が1つ続くこと
          const noDecision = APPROVAL_KINDS.filter((k) => !noWord.includes(k) &&
            !new RegExp(`${k}\\s*[:：]?\\s*(?:${APPROVAL_DECISIONS.join('|')})`).test(approval));
          if (noWord.length > 0 || noDecision.length > 0) {
            const parts = [];
            if (noWord.length > 0) parts.push(`${noWord.join('・')} が無い`);
            if (noDecision.length > 0) parts.push(`${noDecision.join('・')} に判断が続いていない`);
            add('MISSING_APPROVAL', where,
              `${table.kind}「承認が要る操作」— ${parts.join('、')}（外部送信: <判断> ／ データ更新: <判断> ／ 金銭: <判断> の形で、判断は 承認あり／承認なし／該当なし のどれか）`);
          }
        }
        // 削減見込みは H1・H2 の行だけ。H3〜H5 の空欄は正しく、書いてあれば違反
        const estimate = col(row, '削減見込み');
        if (NO_ESTIMATE.test(has || '')) {
          claimed.add('削減見込み');
          if (estimate) {
            add('ESTIMATE_NOT_ALLOWED', where,
              `${table.kind}「削減見込み」が ${has} の行に書かれている（人が主導する作業の短縮は測れない。H1・H2 の行だけに書く）`);
          }
        }
      }

      // 4. 工程は図のノードIDで始まる — 業務単位（「経理を自動化」）は工程ではない
      if (table.kind === 'AI化依頼書' || table.kind === '改善案') {
        const step = col(row, '工程');
        if (step) {
          if (!NODE_REF.test(step)) {
            claimed.add('工程');
            add('NODE_REF', where,
              `${table.kind}「工程」が図のノードIDで始まっていない（現在: "${step}"。\`3\` 金額を入力する のように、図のノードID＋工程名で書く。業務単位で書かない）`);
          }
        }
      }

      // 5. 定義に無い値 — 埋まって見えるが何も決めていない
      for (const [name, spec] of Object.entries(ENUMS)) {
        const v = col(row, name);
        if (v === null || !v || claimed.has(name)) continue;
        if (!spec.re.test(v)) {
          claimed.add(name);
          add('ENUM_VALUE', where,
            `${table.kind}「${name}」が定義に無い値（現在: "${v}"。入るのは ${spec.allowed}）`);
        }
      }

      // 6. 表の突き合わせ — 聞いた相手が AIの推測 の業務は依頼書に載せない／後で聞く が残る業務に案を付けない
      if ((table.kind === 'AI化依頼書' || table.kind === '改善案') && list.size > 0) {
        const name = col(row, '業務名');
        const hit = name ? list.get(name) : null;
        if (hit) {
          if (table.kind === 'AI化依頼書' && hit.asked === 'AIの推測') {
            add('GUESSED_IN_REQUEST', where,
              `${table.kind} の「${name}」は業務一覧で「聞いた相手」が AIの推測 — 確かめていない業務の削減見込みは根拠のない数字になる。本人か◯◯さんに確かめてから載せる`);
          }
          if (hit.later.length > 0) {
            add('DETAIL_MISSING', where,
              `${table.kind} の「${name}」は業務一覧の ${hit.later.join('・')} が「後で聞く」のまま — 選んだ業務は全列を埋めてから案を付ける`);
          }
        }
      }

      // 7. 空欄 — 上でコードを出した列は数えない（1つの違反に指摘は1つ）
      table.header.forEach((name, at) => {
        if (EMPTY_OK.has(name) || claimed.has(name)) return;
        const value = (row.values[at] ?? '').trim();
        if (!value) {
          add('EMPTY_CELL', where,
            `${table.kind}「${name}」が空欄（分からないなら値として書き、行き先を付ける）`);
        }
      });
    }
  }

  return findings;
}

function main() {
  const args = process.argv.slice(2);
  const listAt = args.indexOf('--list');
  const listPath = listAt !== -1 ? args[listAt + 1] : null;
  const arg = args.filter((a, i) => listAt === -1 || (i !== listAt && i !== listAt + 1))[0];
  let src;
  let listSrc = null;
  try {
    src = (!arg || arg === '-') ? fs.readFileSync(0, 'utf8') : fs.readFileSync(arg, 'utf8');
    if (listPath) listSrc = fs.readFileSync(listPath, 'utf8');
  } catch (err) {
    console.error(`読み込めない: ${err.message}`);
    process.exit(1);
  }

  const findings = lint(src, listSrc);
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
