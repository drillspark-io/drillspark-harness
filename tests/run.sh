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

LINT="scripts/harness-diagram-lint.js"
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
  skills/harness-improve/SKILL.md \
  agents/harness-design-reviewer.md \
  agents/harness-evaluator.md \
  reference/harness-design-criteria.md \
  reference/設計.md.template \
  scripts/harness-diagram-lint.js
do
  if [ -f "$p" ]; then echo "  PASS $p"; else echo "  FAIL $p が無い"; fail=1; fi
done

echo
if [ "$fail" -eq 0 ]; then echo "全件が期待どおり"; else echo "期待と違うものがある"; fi
exit "$fail"
