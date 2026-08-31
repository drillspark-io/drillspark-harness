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
for f in "$DIR"/*.mmd; do
  case "$(basename "$f")" in
    ok-*) want=0 ;;
    ng-*) want=2 ;;
    *)    echo "  SKIP $f （ok- / ng- で始まっていない）"; continue ;;
  esac

  node "$LINT" "$f" >/dev/null 2>&1
  got=$?
  if [ "$got" -eq "$want" ]; then
    echo "  PASS $(basename "$f")  (exit $got)"
  else
    echo "  FAIL $(basename "$f")  期待 $want / 実際 $got"
    node "$LINT" "$f" 2>&1 | sed 's/^/        /'
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

  expect=$(grep -o 'expect: [A-Z_]* x[0-9]*' "$f" | head -1)
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

  expect=$(grep -o 'expect: [A-Z_]* x[0-9]*' "$f" | head -1)
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
  skills/harness-implement/SKILL.md \
  skills/harness-implement/MAPPING.md \
  skills/harness-implement/FRONTIER.md \
  skills/harness-compose/SKILL.md \
  skills/harness-improve/SKILL.md \
  skills/harness-visualize/SKILL.md \
  agents/harness-design-reviewer.md \
  agents/harness-evaluator.md \
  reference/drillspark-setup.md \
  reference/harness-design-criteria.md \
  reference/設計.md.template \
  scripts/diagram-lint.js \
  scripts/harness-view-lint.js \
  skills/process-improve/SKILL.md \
  skills/process-improve-view/SKILL.md \
  agents/process-expert.md \
  agents/process-improve-reviewer.md \
  reference/business-improvement-criteria.md \
  reference/business-improvement-tables.md \
  scripts/process-table-lint.js \
  scripts/process-plan-lint.js \
  scripts/file-saved-lint.js
do
  if [ -f "$p" ]; then echo "  PASS $p"; else echo "  FAIL $p が無い"; fail=1; fi
done

echo
if [ "$fail" -eq 0 ]; then echo "全件が期待どおり"; else echo "期待と違うものがある"; fi
exit "$fail"
