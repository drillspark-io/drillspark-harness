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
FREEZE_GUARD="scripts/harness-freeze-guard.js"

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
guard_case "$PROC_GUARD" 0 "" "process: 再開用の 業務改善/進行.md は通す"        Write "$T/業務改善/進行.md" "$DIR/ok-progress.md"
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
# ハーネスの図は docs/harness/ の .md（図.md・改善/<日付>.md）に URL がある。業務一覧に無くても通す。案内は置き場を分けて示す
mkdir -p "$T/docs/harness/h/処理/p" "$T/hz/docs/harness"
printf '# p 図\n\n| DrillSpark | https://example.test/editor?id=33333333-3333-4333-8333-333333333333 |\n' > "$T/docs/harness/h/処理/p/図.md"
guard_case "$PROC_GUARD" 0 "" "process: docs/harness の 図.md にある図への update_diagram は通す" mcp__drillspark__update_diagram - - - "$T" - 33333333-3333-4333-8333-333333333333
guard_case "$PROC_GUARD" 2 "図.md" "process: 止めたときの案内に harness 側の置き場（図.md）が出る" mcp__drillspark__update_diagram - - - "$T" - 22222222-2222-4222-8222-222222222222
guard_case "$PROC_GUARD" 2 "書き換えない" "process: docs/harness だけの場所でも、どこにも無い図は止める" mcp__drillspark__update_diagram - - - "$T/hz" - 22222222-2222-4222-8222-222222222222
# スクリプトからの書き換え（python のヒアドキュメントで業務一覧が書き換えられた実例）
guard_case "$PROC_GUARD" 2 "Write" "process: python から 業務改善/ を書くのは止める"   Bash - - - - "python - <<'PY'
p='業務改善/業務一覧.md'
open(p,'w').write('x')
PY"
guard_case "$PROC_GUARD" 2 "Write" "process: node -e から 業務改善/ を書くのは止める"   Bash - - - - "node -e \"require('fs').writeFileSync('業務改善/改善案.md','x')\""
guard_case "$PROC_GUARD" 2 "Write" "process: PowerShell の Set-Content で 業務改善/ を書くのは止める" Bash - - - - "Set-Content 業務改善/改善案.md 'x'"
guard_case "$PROC_GUARD" 0 "" "process: node <ファイル> で lint を呼ぶのは止めない"   Bash - - - - "node scripts/process-table-lint.js 業務改善/業務一覧.md"
guard_case "$PROC_GUARD" 0 "" "process: 業務改善/ に触れない python は止めない"        Bash - - - - "python -c 'print(1)'"
DRILLSPARK_HARNESS_GUARDS=off guard_case "$PROC_GUARD" 0 "" "process: DRILLSPARK_HARNESS_GUARDS=off で柵を切れる" Write "$T/業務改善/業務一覧.md" "$DIR/ng-table-blank.md"
DRILLSPARK_HARNESS_GUARDS=off guard_case "$VIEW_GUARD" 0 "" "view: DRILLSPARK_HARNESS_GUARDS=off で柵を切れる"    Edit "$V" -

# 凍結した合格条件 — 番号付きの行は変えず消さず、足すだけ。足したら版を上げる
F="$T/docs/harness/h/処理/p/合格条件.md"
printf '# p 合格条件（凍結: 2026-01-01）\n\n| # | 条件 | 期待 |\n|---|---|---|\n| 1 | a を通す | exit 0 |\n| 2 | b を止める | exit 2 |\n' > "$F"
printf '# p 合格条件（凍結: 2026-01-01）\n\n| # | 条件 | 期待 |\n|---|---|---|\n| 1 | a を止める | exit 2 |\n| 2 | b を止める | exit 2 |\n' > "$T/other/凍結-変更.md"
printf '# p 合格条件（凍結: 2026-01-01）\n\n| # | 条件 | 期待 |\n|---|---|---|\n| 1 | a を通す | exit 0 |\n| 2 | b を止める | exit 2 |\n| 3 | c を止める | exit 2 |\n' > "$T/other/凍結-追加-版なし.md"
printf '# p 合格条件（凍結: 2026-01-01 / 第2版 2026-01-02）\n\n| # | 条件 | 期待 |\n|---|---|---|\n| 1 | a を通す | exit 0 |\n| 2 | b を止める | exit 2 |\n| 3 | c を止める | exit 2 |\n' > "$T/other/凍結-追加-第2版.md"
printf '# p 合格条件（第2版）\n\n| # | 条件 | 期待 |\n|---|---|---|\n| 1 | a を通す | exit 0 |\n| 2 | b を止める | exit 2 |\n' > "$T/other/凍結-語なし.md"
printf '# p 合格条件（下書き）\n\n| # | 条件 | 期待 |\n|---|---|---|\n| 1 | a を通す | exit 0 |\n' > "$T/docs/harness/h/処理/q-合格条件.md"
guard_case "$FREEZE_GUARD" 2 "凍結" "freeze: 凍結済みの番号行を変える Write は止める"        Write "$F" "$T/other/凍結-変更.md"
guard_case "$FREEZE_GUARD" 2 "版"   "freeze: 行を足すのに版を上げない Write は止める"        Write "$F" "$T/other/凍結-追加-版なし.md"
guard_case "$FREEZE_GUARD" 0 ""     "freeze: 行を足して第2版に上げる Write は通す"            Write "$F" "$T/other/凍結-追加-第2版.md"
guard_case "$FREEZE_GUARD" 2 "凍結" "freeze: 「凍結」の語を消す Write は止める"               Write "$F" "$T/other/凍結-語なし.md"
guard_case "$FREEZE_GUARD" 2 "凍結" "freeze: 番号行に掛かる Edit も止める"                   Edit  "$F" -
guard_case "$FREEZE_GUARD" 0 ""     "freeze: 凍結の語が無い合格条件.md は通す"                Write "$T/docs/harness/h/処理/q-合格条件.md" "$T/other/凍結-変更.md"
guard_case "$FREEZE_GUARD" 0 ""     "freeze: まだ無い合格条件.md への Write（初回の凍結）は通す" Write "$T/docs/harness/h/処理/r/合格条件.md" "$T/other/凍結-変更.md"
guard_case "$FREEZE_GUARD" 0 ""     "freeze: docs/harness の外の 合格条件.md は見ない"         Write "$T/other/合格条件.md" "$T/other/凍結-変更.md"
guard_case "$FREEZE_GUARD" 2 "Write" "freeze: Bash で 合格条件.md へ heredoc は止める"       Bash - - - - "cat > docs/harness/h/処理/p/合格条件.md <<'EOF'
x
EOF"
guard_case "$FREEZE_GUARD" 2 "Write" "freeze: sed -i の対象が 合格条件.md は止める"          Bash - - - - "sed -i 's/a/b/' docs/harness/h/処理/p/合格条件.md"
guard_case "$FREEZE_GUARD" 0 ""     "freeze: 合格条件.md を読むだけの Bash は通す"            Bash - - - - "cat docs/harness/h/処理/p/合格条件.md | head"
DRILLSPARK_HARNESS_GUARDS=off guard_case "$FREEZE_GUARD" 0 "" "freeze: DRILLSPARK_HARNESS_GUARDS=off で柵を切れる" Write "$F" "$T/other/凍結-変更.md"
# 壊れた入力・object でない JSON で無関係な作業を止めない（例外で落ちれば exit 1 になる）
for g in "$VIEW_GUARD" "$PROC_GUARD" "$FREEZE_GUARD"; do
  for bad in 'not json' '{}' 'null' '[]' '42'; do
    if printf '%s' "$bad" | node "$g" >/dev/null 2>&1; then echo "  PASS $(basename "$g")  入力 $bad は通す (exit 0)"; else echo "  FAIL $(basename "$g")  入力 $bad で止めた／落ちた"; fail=1; fi
  done
done
rm -rf "$T"

echo "== 1枚の生成 =="
# harness-view-build が map.json ＋ diagrams.json から1枚を組み立て、書く前に柵（回数欄・上書き・view-lint）を通すこと。
# 出力は map と同じフォルダに出るので、一時フォルダへ写してから走らせる。回数欄は 0 → 1 → 2 と進み、3回目は上限で止まる。
BUILD="scripts/harness-view-build.js"
T=$(mktemp -d); mkdir -p "$T/docs/harness/demo/可視化"   # 契約どおりの置き場にして、柵（harness-view-guard）が効く経路で検査する
cp "$DIR/ok-build-minimal.map.json" "$T/docs/harness/demo/可視化/記事を書く-2026-01-01.map.json"
cp "$DIR/ok-build-minimal.diagrams.json" "$T/docs/harness/demo/可視化/記事を書く-2026-01-01.diagrams.json"
for want_n in 0 1 2; do
  out=$(node "$BUILD" "$T/docs/harness/demo/可視化/記事を書く-2026-01-01.map.json" 2>&1); got=$?
  head=$(head -2 "$T/docs/harness/demo/可視化/記事を書く-2026-01-01.html" 2>/dev/null | grep -o '直し: [0-9]*/2')
  if [ "$got" -eq 0 ] && [ "$head" = "直し: $want_n/2" ] && node "scripts/harness-view-lint.js" "$T/docs/harness/demo/可視化/記事を書く-2026-01-01.html" >/dev/null 2>&1; then
    echo "  PASS ok-build-minimal  (exit 0 / 回数欄 $want_n/2 / view-lint 0)"
  else
    echo "  FAIL ok-build-minimal  期待 exit 0・回数欄 $want_n/2 / 実際 exit $got・${head:-回数欄なし}"; printf '%s\n' "$out" | sed 's/^/        /'; fail=1
  fi
done
out=$(node "$BUILD" "$T/docs/harness/demo/可視化/記事を書く-2026-01-01.map.json" 2>&1); got=$?
if [ "$got" -eq 2 ] && printf '%s' "$out" | grep -q '上限'; then echo "  PASS ok-build-minimal  4回目は上限で止まる (exit 2 / 「上限」)"; else echo "  FAIL ok-build-minimal  4回目が止まらない (exit $got)"; printf '%s\n' "$out" | sed 's/^/        /'; fail=1; fi
cp "$DIR/ng-build-no-purpose.map.json" "$T/docs/harness/demo/可視化/欠け-2026-01-01.map.json"
cp "$DIR/ok-build-minimal.diagrams.json" "$T/docs/harness/demo/可視化/欠け-2026-01-01.diagrams.json"
out=$(node "$BUILD" "$T/docs/harness/demo/可視化/欠け-2026-01-01.map.json" 2>&1); got=$?
if [ "$got" -eq 2 ] && printf '%s' "$out" | grep -q '必須の項目' && [ ! -e "$T/docs/harness/demo/可視化/欠け-2026-01-01.html" ]; then echo "  PASS ng-build-no-purpose  (exit 2 / 「必須の項目」 / 書かない)"; else echo "  FAIL ng-build-no-purpose  期待 exit 2・書かない / 実際 exit $got"; printf '%s\n' "$out" | sed 's/^/        /'; fail=1; fi
cp "$DIR/ok-build-minimal.map.json" "$T/docs/harness/demo/可視化/図なし-2026-01-01.map.json"
out=$(node "$BUILD" "$T/docs/harness/demo/可視化/図なし-2026-01-01.map.json" 2>&1); got=$?
if [ "$got" -eq 2 ] && printf '%s' "$out" | grep -q '図の JSON が無い'; then echo "  PASS 図の JSON が無いときは書かない  (exit 2)"; else echo "  FAIL 図の JSON が無いのに止まらない (exit $got)"; printf '%s\n' "$out" | sed 's/^/        /'; fail=1; fi
rm -rf "$T"

echo "== 第二階層の網羅 =="
# process-coverage が get_project の JSON から「全工程に第二階層があるか」を数えること。
# 1つ描いたところで §4 に進む事故（実測）を、記憶でなく機械で止めるための1本。
COV="scripts/process-coverage.js"
out=$(node "$COV" "$DIR/ok-coverage.json" 2>&1); got=$?
if [ "$got" -eq 0 ] && printf '%s' "$out" | grep -q '2/2'; then echo "  PASS ok-coverage.json  (exit 0 / 2/2)"; else echo "  FAIL ok-coverage.json  期待 exit 0・2/2 / 実際 exit $got"; printf '%s\n' "$out" | sed 's/^/        /'; fail=1; fi
out=$(node "$COV" - < "$DIR/ng-coverage-missing.json" 2>&1); got=$?
if [ "$got" -eq 2 ] && printf '%s' "$out" | grep -q '描いていない工程: 3, 4' && printf '%s' "$out" | grep -q '作業が1つしか無い工程: 2'; then echo "  PASS ng-coverage-missing.json  (exit 2 / 描いていない工程: 3, 4 / 作業が1つしか無い工程: 2 / 標準入力)"; else echo "  FAIL ng-coverage-missing.json  期待 exit 2・「描いていない工程: 3, 4」・「作業が1つしか無い工程: 2」 / 実際 exit $got"; printf '%s\n' "$out" | sed 's/^/        /'; fail=1; fi

echo "== 入力画面 =="
# process-improve の棚卸しシート（Artifact の db に保存する1枚）。選択肢の文字列が表の lint と食い違うと、画面で選べた値が
# 業務一覧で落ちる。外部資源は Google Fonts だけ（Artifact の CSP は他を黙って落とす）。公開時に包まれるので断片で書く。
SHEET="skills/process-improve/assets/棚卸しシート.html"
out=$(node - "$SHEET" <<'EOF'
const fs = require("fs");
const html = fs.readFileSync(process.argv[2], "utf8");
const lint = fs.readFileSync("scripts/process-table-lint.js", "utf8");
let bad = 0;
const check = (ok, label) => { console.log((ok ? "  PASS " : "  FAIL ") + label); if (!ok) bad++; };
const list = (name) => { const m = new RegExp("var " + name + " = \\[([^\\]]*)\\]").exec(html); return m ? (m[1].match(/'([^']*)'/g) || []).map((s) => s.slice(1, -1)) : []; };
check(!/<!doctype|<html[\s>]|<body[\s>]|<head[\s>]/i.test(html), "断片として書かれている（doctype / html / head / body を持たない）");
check(/window\.claude/.test(html) && /use\(['"]db['"]\)/.test(html), "claude.use(\"db\") で保存先に繋ぎ、無いときも表示できる");
const lintMethods = (/'測り方': \{ re: \/\^\(([^)]*)\)\$\//.exec(lint) || [, ""])[1].split("|");
check(list("METHODS").join("|") === lintMethods.join("|"), "測り方の選択肢が process-table-lint と一致する（" + lintMethods.join("／") + "）");
check(list("FREQ_UNITS").join("|") === "回/月|回/週|回/日|回/年" && /= ' \+ total \+ '時間\/月'/.test(html), "頻度の単位が 回/月・回/週・回/日・回/年 で、合計は必ず 時間/月 で組む（ABC がそのまま読める）");
const urls = (html.match(/https?:\/\/[^\s"'<>)]+/g) || []).filter((u) => !/^https:\/\/fonts\.(googleapis|gstatic)\.com/.test(u));
check(urls.length === 0, "外部資源は Google Fonts だけ" + (urls.length ? "（他: " + urls.join(" ") + "）" : ""));
check(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z]:\\|\/Users\/|[\w.+-]+@[\w-]+\.[\w.]+/i.test(html), "私的情報が無い（UUID・絶対パス・メール）");
process.exit(bad ? 1 : 0);
EOF
); got=$?
printf '%s\n' "$out"
if [ "$got" -ne 0 ]; then fail=1; fi

echo "== 図の表示 =="
# 本文で show_project を呼ぶスキルは、両方のサーバー名（drillspark / claude_ai_DrillSpark）で許可していること。
# 片方だけだと、もう一方の名前で繋いだ環境で図が出ずに止まる。
out=$(node -e '
  const fs = require("fs");
  let bad = 0, n = 0;
  for (const d of fs.readdirSync("skills")) {
    const p = "skills/" + d + "/SKILL.md";
    if (!fs.existsSync(p)) continue;
    const t = fs.readFileSync(p, "utf8");
    const head = t.split("\n").slice(0, 8).join("\n");
    const body = t.slice(head.length);
    if (!/show_project/.test(body)) continue;
    n++;
    const ok = /mcp__drillspark__show_project/.test(head) && /mcp__claude_ai_DrillSpark__show_project/.test(head);
    console.log((ok ? "  PASS " : "  FAIL ") + d + "  本文で show_project を呼び、両方の名前で許可している");
    if (!ok) bad = 1;
  }
  if (n === 0) { console.log("  FAIL show_project を呼ぶスキルが1つも無い"); bad = 1; }
  process.exit(bad);
' 2>&1); got=$?
printf '%s\n' "$out"
if [ "$got" -ne 0 ]; then fail=1; fi

echo "== 接続の案内 =="
# DrillSpark に繋がらないときの案内は、アカウントが無い人にクーポンコード（1ヶ月無料）を渡し、
# 無料期間が終わる前に自分で解約する、を同じ場所に添えていること。コードだけ渡すと解約を知らずに課金が始まる。
out=$(node -e '
  const fs = require("fs");
  let bad = 0;
  const setup = fs.readFileSync("reference/drillspark-setup.md", "utf8");
  const readme = fs.readFileSync("README.md", "utf8");
  const owner = setup.split("## 業務改善")[0];
  const staff = setup.split("## 業務改善")[1] || "";
  const cases = [
    ["setup.md 案内する文面（オーナー向け）", owner, /解約/],
    ["setup.md 業務改善の利用者向けの3行", staff, /解約/],
    ["README Connecting DrillSpark", readme, /[Cc]ancel/],
  ];
  for (const [name, text, cancel] of cases) {
    const ok = /`drill-kaizen`/.test(text) && cancel.test(text);
    console.log((ok ? "  PASS " : "  FAIL ") + name + "  クーポンコード drill-kaizen と解約の注記がある");
    if (!ok) bad = 1;
  }
  process.exit(bad);
' 2>&1); got=$?
printf '%s\n' "$out"
if [ "$got" -ne 0 ]; then fail=1; fi

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
  scripts/harness-view-build.js \
  skills/process-improve/SKILL.md \
  skills/process-improve/assets/棚卸しシート.html \
  skills/process-improve-view/SKILL.md \
  agents/process-expert.md \
  agents/process-improve-reviewer.md \
  reference/business-improvement-criteria.md \
  reference/business-improvement-tables.md \
  scripts/process-table-lint.js \
  scripts/process-plan-lint.js \
  scripts/file-saved-lint.js \
  scripts/process-abc.js \
  scripts/process-coverage.js \
  scripts/process-write-guard.js \
  scripts/harness-freeze-guard.js
do
  if [ -f "$p" ]; then echo "  PASS $p"; else echo "  FAIL $p が無い"; fail=1; fi
done

echo
if [ "$fail" -eq 0 ]; then echo "全件が期待どおり"; else echo "期待と違うものがある"; fi
exit "$fail"
