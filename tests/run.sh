#!/usr/bin/env bash
# drillspark-harness の合格条件。
# lint の期待挙動を固定するもので、lint に合わせて書き換えない。
#
#   bash tests/run.sh
#
# ファイル名の接頭辞が期待 exit code を表す:  ok-* → 0 / ng-* → 2
# 1件でも期待と違えば exit 1。

set -u
cd "$(dirname "$0")/.." || exit 1

LINT="scripts/diagram-lint.js"
DIR="tests"
fail=0

echo "== 図の構造 lint =="
# 終了コードだけを見ない。各サンプルは先頭に `%% expect: <コード> x<件数>` を持ち、コードと件数まで照合する
# （`%%` 行は lint が読み飛ばす。複数コードは sort -u してアルファベット順に + で連結）。
for f in "$DIR"/*.mmd; do
  base=$(basename "$f")
  case "$base" in
    ok-*) want=0 ;;
    ng-*) want=2 ;;
    *)    echo "  SKIP $f （ok- / ng- で始まっていない）"; continue ;;
  esac

  expect=$(grep -o 'expect: [A-Z_+]* x[0-9]*' "$f" | head -1)
  if [ -z "$expect" ]; then
    echo "  FAIL $base  expect: 行が無い（期待するコードと件数をサンプル自身に書く）"
    fail=1
    continue
  fi
  want_code=$(printf '%s' "$expect" | cut -d' ' -f2)
  want_n=$(printf '%s' "$expect" | cut -d' ' -f3 | tr -d 'x')

  out=$(node "$LINT" "$f" 2>&1)
  got=$?
  got_n=$(printf '%s\n' "$out" | grep -c '^  \[')
  got_code=$(printf '%s\n' "$out" | grep -o '^  \[[A-Z_]*\]' | tr -d ' []' | sort -u | tr '\n' '+' | sed 's/+$//')
  [ "$want_n" -eq 0 ] && want_code_cmp="" || want_code_cmp="$want_code"

  if [ "$got" -eq "$want" ] && [ "$got_n" -eq "$want_n" ] && [ "$got_code" = "$want_code_cmp" ]; then
    echo "  PASS $base  (exit $got / ${want_code} x${want_n})"
  else
    echo "  FAIL $base  期待 exit $want・${want_code} x${want_n} / 実際 exit $got・${got_code:-なし} x${got_n}"
    printf '%s\n' "$out" | sed 's/^/        /'
    fail=1
  fi
done

echo "== HTML の lint =="
# 終了コードだけを見る条件にしない。全部 exit 2 を返す壊れた lint も「違反サンプルで 2」を満たす。
# 各サンプルは自分の中に `expect: <コード> x<件数>` を持ち、そこまで照合する。
#
# サンプル名で lint を振り分ける。*-view-* は可視化HTML、*-plan-* は業務改善の1枚。
# 同じ HTML でも見るものが違う（1枚は DrillSpark の URL を持つので、可視化用の lint では落ちる）。
for f in "$DIR"/*.html; do
  base=$(basename "$f")
  case "$base" in
    ok-view-*|ng-view-*) VIEW_LINT="scripts/harness-view-lint.js" ;;
    ok-plan-*|ng-plan-*) VIEW_LINT="scripts/process-plan-lint.js" ;;
    *) echo "  SKIP $f （-view- / -plan- が無い）"; continue ;;
  esac
  case "$base" in
    ok-*) want=0 ;;
    ng-*) want=2 ;;
    *)    echo "  SKIP $f （ok- / ng- で始まっていない）"; continue ;;
  esac

  expect=$(grep -o 'expect: [A-Z_+]* x[0-9]*' "$f" | head -1)
  if [ -z "$expect" ]; then
    echo "  FAIL $base  expect: 行が無い（期待するコードと件数をサンプル自身に書く）"
    fail=1
    continue
  fi
  want_code=$(printf '%s' "$expect" | cut -d' ' -f2)
  want_n=$(printf '%s' "$expect" | cut -d' ' -f3 | tr -d 'x')

  out=$(node "$VIEW_LINT" "$f" 2>&1)
  got=$?
  got_n=$(printf '%s\n' "$out" | grep -c '^  \[')
  got_code=$(printf '%s\n' "$out" | grep -o '^  \[[A-Z_]*\]' | tr -d ' []' | sort -u | tr '\n' '+' | sed 's/+$//')
  [ "$want_n" -eq 0 ] && want_code_cmp="" || want_code_cmp="$want_code"

  if [ "$got" -eq "$want" ] && [ "$got_n" -eq "$want_n" ] && [ "$got_code" = "$want_code_cmp" ]; then
    echo "  PASS $base  (exit $got / ${want_code} x${want_n})"
  else
    echo "  FAIL $base  期待 exit $want・${want_code} x${want_n} / 実際 exit $got・${got_code:-なし} x${got_n}"
    printf '%s\n' "$out" | sed 's/^/        /'
    fail=1
  fi
done

echo "== 業務改善の表の lint =="
# 表は Markdown。ヘッダの列名で表の種類を判定するので、1ファイルに複数の表が入ってよい。
TABLE_LINT="scripts/process-table-lint.js"
for f in "$DIR"/*.md; do
  [ -e "$f" ] || continue
  base=$(basename "$f")
  case "$base" in
    ok-table-*) want=0 ;;
    ng-table-*) want=2 ;;
    *)    echo "  SKIP $f （ok-table- / ng-table- で始まっていない）"; continue ;;
  esac

  expect=$(grep -o 'expect: [A-Z_+]* x[0-9]*' "$f" | head -1)
  if [ -z "$expect" ]; then
    echo "  FAIL $base  expect: 行が無い（期待するコードと件数をサンプル自身に書く）"
    fail=1
    continue
  fi
  want_code=$(printf '%s' "$expect" | cut -d' ' -f2)
  want_n=$(printf '%s' "$expect" | cut -d' ' -f3 | tr -d 'x')

  out=$(node "$TABLE_LINT" "$f" 2>&1)
  got=$?
  got_n=$(printf '%s\n' "$out" | grep -c '^  \[')
  got_code=$(printf '%s\n' "$out" | grep -o '^  \[[A-Z_]*\]' | tr -d ' []' | sort -u | tr '\n' '+' | sed 's/+$//')
  [ "$want_n" -eq 0 ] && want_code_cmp="" || want_code_cmp="$want_code"

  if [ "$got" -eq "$want" ] && [ "$got_n" -eq "$want_n" ] && [ "$got_code" = "$want_code_cmp" ]; then
    echo "  PASS $base  (exit $got / ${want_code} x${want_n})"
  else
    echo "  FAIL $base  期待 exit $want・${want_code} x${want_n} / 実際 exit $got・${got_code:-なし} x${got_n}"
    printf '%s\n' "$out" | sed 's/^/        /'
    fail=1
  fi
done

echo "== ABC 分析 =="
# ok-table-abc.md（8/4/2/1/1 時間）を A x1 / B x2 / C x2 に分け、印の候補を語の一致で付ける。
ABC="scripts/process-abc.js"
out=$(node "$ABC" "$DIR/ok-table-abc.md" 2>&1); got=$?
a=$(printf '%s\n' "$out" | grep -c '| A |'); b=$(printf '%s\n' "$out" | grep -c '| B |'); c=$(printf '%s\n' "$out" | grep -c '| C |')
marks=$(printf '%s\n' "$out" | grep -c '転記（作業:')
if [ "$got" -eq 0 ] && [ "$a" -eq 1 ] && [ "$b" -eq 2 ] && [ "$c" -eq 2 ] && [ "$marks" -eq 2 ]; then
  echo "  PASS ok-table-abc.md  (A x1 / B x2 / C x2 / 転記の印 x2)"
else
  echo "  FAIL ok-table-abc.md  期待 exit 0・A x1 / B x2 / C x2 / 転記 x2 / 実際 exit $got・A x$a / B x$b / C x$c / 転記 x$marks"
  printf '%s\n' "$out" | sed 's/^/        /'
  fail=1
fi

# ok-table-abc-year.md（8時間/月・1時間/週・24時間/年・１，２００分／年）を 週 ×52/12・年 ÷12 で月に直し、
# A x1 / B x2 / C x1 に分ける（直す前は /月 以外が「単位不明」に落ちていた）。
out=$(node "$ABC" "$DIR/ok-table-abc-year.md" 2>&1); got=$?
a=$(printf '%s\n' "$out" | grep -c '| A |'); b=$(printf '%s\n' "$out" | grep -c '| B |'); c=$(printf '%s\n' "$out" | grep -c '| C |')
unknown=$(printf '%s\n' "$out" | grep -c '単位不明')
if [ "$got" -eq 0 ] && [ "$a" -eq 1 ] && [ "$b" -eq 2 ] && [ "$c" -eq 1 ] && [ "$unknown" -eq 0 ]; then
  echo "  PASS ok-table-abc-year.md  (A x1 / B x2 / C x1 / 単位不明 x0)"
else
  echo "  FAIL ok-table-abc-year.md  期待 exit 0・A x1 / B x2 / C x1 / 単位不明 x0 / 実際 exit $got・A x$a / B x$b / C x$c / 単位不明 x$unknown"
  printf '%s\n' "$out" | sed 's/^/        /'
  fail=1
fi

echo "== 保存の検査 =="
# 実在しないパスで NOT_SAVED、実在するファイルで exit 0。
FILE_LINT="scripts/file-saved-lint.js"
out=$(node "$FILE_LINT" "$DIR/この名前のファイルは存在しない.html" 2>&1); got=$?
got_n=$(printf '%s\n' "$out" | grep -c '^  \[')
if [ "$got" -eq 2 ] && [ "$got_n" -eq 1 ] && printf '%s\n' "$out" | grep -q 'NOT_SAVED'; then
  echo "  PASS 無いパス  (exit 2 / NOT_SAVED x1)"
else
  echo "  FAIL 無いパス  期待 exit 2・NOT_SAVED x1 / 実際 exit $got x$got_n"
  printf '%s\n' "$out" | sed 's/^/        /'
  fail=1
fi
if node "$FILE_LINT" "$DIR/ok-plan-minimal.html" >/dev/null 2>&1; then
  echo "  PASS 実在するファイル  (exit 0)"
else
  echo "  FAIL 実在するファイルで exit 0 にならない"
  fail=1
fi

echo "== 柵の検査 =="
# PreToolUse hook に渡る JSON を組み立てて guard 2本に流し、exit code と stderr の文言を照合する。
# 「止めるべきものを止める」と「無関係な書き込みを止めない」の両方を固定する（後者が破れると
# このプラグインを入れた人の全 Write/Bash が止まる）。guard は実パスを existsSync するので一時ディレクトリを使う。
T=$(mktemp -d)
mkdir -p "$T/docs/harness/x/可視化" "$T/業務改善/sub" "$T/other"
VIEW_GUARD="scripts/harness-view-guard.js"
PROC_GUARD="scripts/process-write-guard.js"

# guard_case <guard> <期待 exit> <期待する stderr の語（空なら見ない）> <名前> <tool> <file_path> <content の元ファイル> [回数欄] [cwd] [command] [project_id]
#   "-" は無しの意味。回数欄を与えると content の1行目の直後に <!-- 直し: N/2 --> を挿む。
guard_case() {
  local guard="$1" want="$2" word="$3" name="$4"; shift 4
  local out got
  out=$(node -e '
    const fs = require("fs");
    const [tool, file, cf, count, cwd, command, pid] = process.argv.slice(1);
    let content = cf && cf !== "-" ? fs.readFileSync(cf, "utf8") : "";
    if (count && count !== "-") content = content.replace(/^([^\n]*\n)/, "$1<!-- 直し: " + count + "/2 -->\n");
    const ti = {};
    if (file && file !== "-") ti.file_path = file;
    if (tool === "Write") ti.content = content;
    if (tool === "Edit") { ti.old_string = "a"; ti.new_string = "b"; }
    if (command && command !== "-") ti.command = command;
    if (pid && pid !== "-") ti.project_id = pid;
    const o = { tool_name: tool, tool_input: ti };
    if (cwd && cwd !== "-") o.cwd = cwd;
    process.stdout.write(JSON.stringify(o));
  ' "$@" | node "$guard" 2>&1 >/dev/null)
  got=$?
  if [ "$got" -eq "$want" ] && { [ -z "$word" ] || printf '%s' "$out" | grep -q -- "$word"; }; then
    echo "  PASS $name  (exit $got${word:+ / 「$word」})"
  else
    echo "  FAIL $name  期待 exit $want${word:+・「$word」} / 実際 exit $got"
    printf '%s\n' "$out" | sed 's/^/        /'
    fail=1
  fi
}

V="$T/docs/harness/x/可視化/処理-2026-01-01.html"
guard_case "$VIEW_GUARD" 0 ""            "view: 無関係な Write は通す"            Write "$T/other/a.html" "$DIR/ok-view-minimal.html"
guard_case "$VIEW_GUARD" 2 "部分修正しない" "view: 可視化の1枚への Edit は止める"     Edit  "$V" -
guard_case "$VIEW_GUARD" 2 "回数欄が無い"   "view: 回数欄の無い Write は止める"       Write "$V" "$DIR/ok-view-minimal.html"
guard_case "$VIEW_GUARD" 2 "0 から始める"   "view: 新規なのに 1/2 は止める"           Write "$V" "$DIR/ok-view-minimal.html" 1
guard_case "$VIEW_GUARD" 2 "view-lint に落ちた" "view: lint に落ちる内容は書かせない" Write "$V" "$DIR/ng-view-external-css.html" 0
guard_case "$VIEW_GUARD" 0 ""            "view: 新規 0/2 ＋ lint 合格は通す"        Write "$V" "$DIR/ok-view-minimal.html" 0
node -e 'const fs=require("fs");let s=fs.readFileSync(process.argv[1],"utf8");s=s.replace(/^([^\n]*\n)/,"$1<!-- 直し: 0/2 -->\n");fs.writeFileSync(process.argv[2],s)' "$DIR/ok-view-minimal.html" "$V"
guard_case "$VIEW_GUARD" 2 "進んでいない"   "view: 既存 0/2 に 0/2 で上書きは止める"  Write "$V" "$DIR/ok-view-minimal.html" 0
guard_case "$VIEW_GUARD" 2 "進んでいない"   "view: 既存 0/2 に 2/2 で飛ばすのは止める" Write "$V" "$DIR/ok-view-minimal.html" 2
guard_case "$VIEW_GUARD" 0 ""            "view: 既存 0/2 → 1/2 は通す"             Write "$V" "$DIR/ok-view-minimal.html" 1
node -e 'const fs=require("fs");let s=fs.readFileSync(process.argv[1],"utf8");s=s.replace(/^([^\n]*\n)/,"$1<!-- 直し: 2/2 -->\n");fs.writeFileSync(process.argv[2],s)' "$DIR/ok-view-minimal.html" "$V"
guard_case "$VIEW_GUARD" 2 "上限"          "view: 既存 2/2 → 3/2 は上限で止める"     Write "$V" "$DIR/ok-view-minimal.html" 3
cp "$DIR/ok-view-minimal.html" "$V"
guard_case "$VIEW_GUARD" 2 "上書きしない"   "view: 回数欄の無い既存物は上書きさせない" Write "$V" "$DIR/ok-view-minimal.html" 1
guard_case "$VIEW_GUARD" 2 "Write"         "view: Bash で 可視化/ へ heredoc は止める" Bash - - - - "cat > docs/harness/x/可視化/a.html <<'EOF'
<html></html>
EOF"
guard_case "$VIEW_GUARD" 2 "Write"         "view: Bash で 可視化/ へ cp は止める"     Bash - - - - "cp a.html docs/harness/x/可視化/b.html"
guard_case "$VIEW_GUARD" 0 ""              "view: 可視化/ を読むだけの Bash は通す"    Bash - - - - "cat docs/harness/x/可視化/a.html | head"

guard_case "$PROC_GUARD" 0 "" "process: 無関係な Write は通す"                 Write "$T/other/改善案.md" "$DIR/ng-table-blank.md"
guard_case "$PROC_GUARD" 0 "" "process: 表を持たない 業務改善/教訓.md は通す"    Write "$T/業務改善/教訓.md" "$DIR/run.sh"
guard_case "$PROC_GUARD" 2 "表の検査に落ちた" "process: 表 lint に落ちる内容は書かせない" Write "$T/業務改善/業務一覧.md" "$DIR/ng-table-blank.md"
guard_case "$PROC_GUARD" 0 "" "process: 表 lint 合格は通す"                    Write "$T/業務改善/業務一覧.md" "$DIR/ok-table-minimal.md"
guard_case "$PROC_GUARD" 2 "1枚の検査に落ちた" "process: 1枚 lint に落ちる内容は書かせない" Write "$T/業務改善/改善計画-x.html" "$DIR/ng-plan-external.html"
guard_case "$PROC_GUARD" 0 "" "process: 1枚 lint 合格は通す"                   Write "$T/業務改善/改善計画-x.html" "$DIR/ok-plan-minimal.html"
guard_case "$PROC_GUARD" 2 "Write" "process: Bash で 業務改善/ へ > は止める"  Bash - - - - "echo x > 業務改善/改善案.md"
guard_case "$PROC_GUARD" 2 "Write" "process: Bash で 業務改善/ へ tee は止める" Bash - - - - "printf x | tee 業務改善/改善案.md"
guard_case "$PROC_GUARD" 0 "" "process: Bash の 2>&1 は止めない"                Bash - - - - "grep -r 業務改善 . 2>&1"
guard_case "$PROC_GUARD" 0 "" "process: 業務改善 を含む git commit は止めない"    Bash - - - - "git commit -m '業務改善の表を足す'"
guard_case "$PROC_GUARD" 0 "" "process: 検索語の 業務改善 を別ファイルへ > は止めない" Bash - - - - "grep 業務改善 notes.md > out.txt"
guard_case "$PROC_GUARD" 2 "Write" "process: cd 業務改善 && > は止める"          Bash - - - - "cd 業務改善 && echo x > 表.md"
guard_case "$PROC_GUARD" 2 "Write" "process: cwd が 業務改善/ のとき > は止める"  Bash - - - "$T/業務改善" "echo x > 表.md"
guard_case "$PROC_GUARD" 2 "Write" "process: cp の宛先が 業務改善/ は止める"      Bash - - - - "cp a.md 業務改善/改善案.md"
guard_case "$PROC_GUARD" 2 "Write" "process: sed -i の対象が 業務改善/ は止める"  Bash - - - - "sed -i 's/a/b/' 業務改善/改善案.md"
guard_case "$PROC_GUARD" 2 "表の検査に落ちた" "process: 拡張子 .MD でも検査する"   Write "$T/業務改善/業務一覧.MD" "$DIR/ng-table-blank.md"
guard_case "$PROC_GUARD" 2 "表の検査に落ちた" "process: サブフォルダでも検査する"   Write "$T/業務改善/sub/業務一覧.md" "$DIR/ng-table-blank.md"
printf '| 日付 | 議題 | 決めたこと |\n|---|---|---|\n| 1日 | 予算 | 継続 |\n' > "$T/other/議事録.md"
guard_case "$PROC_GUARD" 0 "" "process: 業務改善/ の無関係な表（議事録）は通す"   Write "$T/業務改善/議事録.md" "$T/other/議事録.md"
printf '<!doctype html>\n<html><body><p>memo</p></body></html>\n' > "$T/other/memo.html"
guard_case "$PROC_GUARD" 0 "" "process: 業務改善/ の無関係な HTML は通す"        Write "$T/業務改善/memo.html" "$T/other/memo.html"
# 免除は他人のファイルにだけ効く。プラグインの固定名は中身が何でも検査に掛ける
guard_case "$PROC_GUARD" 2 "1枚の検査に落ちた" "process: 改善計画-*.html は data-block が無くても検査する" Write "$T/業務改善/改善計画-x.html" "$T/other/memo.html"
printf '| 業務 | 担当 | 時間 |\n|---|---|---|\n| 転記 | 経理 | 2h |\n' > "$T/other/別の表.md"
guard_case "$PROC_GUARD" 2 "表の検査に落ちた" "process: 業務一覧.md は列名が違っても検査する"      Write "$T/業務改善/業務一覧.md" "$T/other/別の表.md"
printf '| 日付 | 議題 | 決めたこと |\n|---|---|---|\n| 1日 | 予算 | 継続 |\n\n| 2日 | 人事 | 保留 |\n' > "$T/other/議事録2.md"
guard_case "$PROC_GUARD" 0 "" "process: 無関係な表は空行で切れていても通す"         Write "$T/業務改善/議事録.md" "$T/other/議事録2.md"
guard_case "$PROC_GUARD" 2 "Write" "process: cd 業務改善; > も止める"                Bash - - - - "cd 業務改善; echo x > 表.md"
guard_case "$PROC_GUARD" 2 "Write" "process: cp -r の宛先がフォルダ 業務改善 でも止める" Bash - - - - "cp -r src 業務改善"
printf '| 業務名 | 図の在りか |\n|---|---|\n| a | https://example.test/editor?id=11111111-1111-4111-8111-111111111111 |\n' > "$T/業務改善/業務一覧.md"
guard_case "$PROC_GUARD" 2 "書き換えない" "process: 一覧に無い図への update_diagram は止める" mcp__drillspark__update_diagram - - - "$T" - 22222222-2222-4222-8222-222222222222
guard_case "$PROC_GUARD" 0 "" "process: 一覧にある図への update_diagram は通す"     mcp__drillspark__update_diagram - - - "$T" - 11111111-1111-4111-8111-111111111111
guard_case "$PROC_GUARD" 0 "" "process: 一覧が無い場所からの update_diagram は通す"  mcp__drillspark__update_diagram - - - "$T/other" - 22222222-2222-4222-8222-222222222222
guard_case "$PROC_GUARD" 2 "書き換えない" "process: 第3のサーバー名でも update_diagram を見る" mcp__ds__update_diagram - - - "$T" - 22222222-2222-4222-8222-222222222222
DRILLSPARK_HARNESS_GUARDS=off guard_case "$PROC_GUARD" 0 "" "process: DRILLSPARK_HARNESS_GUARDS=off で柵を切れる" Write "$T/業務改善/業務一覧.md" "$DIR/ng-table-blank.md"
DRILLSPARK_HARNESS_GUARDS=off guard_case "$VIEW_GUARD" 0 "" "view: DRILLSPARK_HARNESS_GUARDS=off で柵を切れる"    Edit "$V" -
# 壊れた入力・object でない JSON で無関係な作業を止めない（例外で落ちれば exit 1 になる）
for g in "$VIEW_GUARD" "$PROC_GUARD"; do
  for bad in 'not json' '{}' 'null' '[]' '42'; do
    if printf '%s' "$bad" | node "$g" >/dev/null 2>&1; then echo "  PASS $(basename "$g")  入力 $bad は通す (exit 0)"; else echo "  FAIL $(basename "$g")  入力 $bad で止めた／落ちた"; fail=1; fi
  done
done
rm -rf "$T"

echo "== hook の配線 =="
# hooks.json が読めること、要る matcher が揃っていること、command が指すスクリプトが実在すること。
# （validate は JSON の文法しか見ない。パスだけ壊れた hook は validate を通る — 実測）
out=$(node -e '
  const fs = require("fs");
  const j = JSON.parse(fs.readFileSync("hooks/hooks.json", "utf8"));
  const pre = (j.hooks && j.hooks.PreToolUse) || [];
  const matchers = pre.map((m) => m.matcher);
  const need = ["Write|Edit|MultiEdit", "Bash", "update_diagram"];
  const missing = need.filter((n) => !matchers.some((m) => m.includes(n)));
  if (missing.length) { console.log("matcher が無い: " + missing.join(", ")); process.exit(1); }
  let n = 0;
  for (const m of pre) for (const h of m.hooks) {
    const p = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"/.exec(h.command);
    if (!p) { console.log("command の形が違う: " + h.command); process.exit(1); }
    if (!fs.existsSync(p[1])) { console.log("command が指すファイルが無い: " + p[1]); process.exit(1); }
    n++;
  }
  console.log(n + " 本の command が実在するスクリプトを指す");
' 2>&1); got=$?
if [ "$got" -eq 0 ]; then echo "  PASS hooks/hooks.json  ($out)"; else echo "  FAIL hooks/hooks.json  $out"; fail=1; fi

echo "== プラグインの検証 =="
if command -v claude >/dev/null 2>&1; then
  if claude plugin validate . --strict >/dev/null 2>&1; then
    echo "  PASS claude plugin validate . --strict (exit 0)"
  else
    echo "  FAIL claude plugin validate . --strict"
    claude plugin validate . --strict 2>&1 | sed 's/^/        /'
    fail=1
  fi
else
  echo "  SKIP claude コマンドが無い"
fi

echo "== 同梱ファイルの存在 =="
for p in \
  .claude-plugin/plugin.json \
  .claude-plugin/marketplace.json \
  hooks/hooks.json \
  README.md \
  CHANGELOG.md \
  LICENSE \
  .github/workflows/tests.yml \
  skills/harness-implement/SKILL.md \
  skills/harness-implement/MAPPING.md \
  skills/harness-implement/FRONTIER.md \
  skills/harness-compose/SKILL.md \
  skills/harness-improve/SKILL.md \
  skills/harness-visualize/SKILL.md \
  agents/harness-asis-reviewer.md \
  agents/harness-design-reviewer.md \
  agents/harness-evaluator.md \
  reference/drillspark-setup.md \
  reference/harness-design-criteria.md \
  reference/設計.md.template \
  scripts/diagram-lint.js \
  scripts/harness-view-lint.js \
  scripts/harness-view-guard.js \
  skills/process-improve/SKILL.md \
  skills/process-improve-view/SKILL.md \
  agents/process-expert.md \
  agents/process-improve-reviewer.md \
  reference/business-improvement-criteria.md \
  reference/business-improvement-tables.md \
  scripts/process-table-lint.js \
  scripts/process-plan-lint.js \
  scripts/file-saved-lint.js \
  scripts/process-abc.js \
  scripts/process-write-guard.js
do
  if [ -f "$p" ]; then echo "  PASS $p"; else echo "  FAIL $p が無い"; fail=1; fi
done

echo
if [ "$fail" -eq 0 ]; then echo "全件が期待どおり"; else echo "期待と違うものがある"; fi
exit "$fail"
