#!/bin/sh
# The check before a push: what CI would refuse, in about two minutes on the new Mac.
#
#   pnpm check            # against origin/main
#   pnpm check HEAD~3     # against any other commit
#
# It runs both typecheckers, the data scripts' lint and tests (in parallel), the source audits, eslint on the
# files changed since the base, and the whole vitest suite, shuffled. CI runs the suite again on every push and the
# deploy waits for it (test.yml, oracle-deploy.yml).
set -eu
cd "$(dirname "$0")/.."
base=${1:-origin/main}

# The Mac's /usr/bin/python3 is 3.9 and can't read these scripts' f-strings.
PY=python3
[ -x /opt/homebrew/Caskroom/miniconda/base/bin/python3 ] && PY=/opt/homebrew/Caskroom/miniconda/base/bin/python3

# Each step says how long it took, and the end gives the total.
t0=$(date +%s); tlast=$t0
took(){ now=$(date +%s); echo "   ($(( now - tlast ))s)"; tlast=$now; }

echo "== 1/6 typecheck (app, Convex, extension, SDK)"
pnpm -s typecheck
took

echo "== 2/6 pyflakes over the data scripts"
"$PY" -m pyflakes scripts/*.py scripts/oracle/*.py
took

echo "== 3/6 data script tests"
# Fourteen at a time (Nov 24 2026: 17 s against 63 s one by one, the same results over three runs); each writes its own
# log, and a failure prints the end of its log.
logs=$(mktemp -d)
n=$(ls scripts/test_*.py scripts/oracle/test_*.py | wc -l | tr -d ' ')
ls scripts/test_*.py scripts/oracle/test_*.py | xargs -P "${CHECK_JOBS:-14}" -I{} sh -c \
  '"$0" "$1" > "$2/$(echo "$1" | tr / _).log" 2>&1 || echo "$1" >> "$2/failed"' "$PY" {} "$logs"
failed=0
if [ -f "$logs/failed" ]; then
  for t in $(sort "$logs/failed"); do failed=$((failed + 1)); echo "FAILED $t"; tail -20 "$logs/$(echo "$t" | tr / _).log"; done
fi
rm -rf "$logs"
echo "$n script tests, $failed failed"
[ "$failed" -eq 0 ]
took

echo "== 4/6 source audits (articles, contrast, every page registered, passed deadlines, private terms, every test file run)"
# audit_passed_deadlines.py reads today's date: an article that said "comments close" on a day now behind us
# fails here until the sentence says what happened (Nov 12 2026: seven articles had gone wrong by themselves).
# audit_private_terms.py reads a private list of the machinery's terms on the owner's machine (where no list exists,
# as on GitHub's runners, it says so and passes), so a push never carries them into the public repository.
for a in audit_articles.py audit_contrast.py audit_page_registration.py audit_passed_deadlines.py audit_private_terms.py; do
  "$PY" "scripts/$a" > /dev/null 2>&1 || { echo "FAILED $a"; "$PY" "scripts/$a" 2>&1 | tail -20; exit 1; }
done
node scripts/every_test_file_runs.mjs
# The placeholder audit measures text in the built Inter file, which a build or the dev server leaves in
# .next. The deploy's workflow runs it after its build; with a font on disk it runs here first, so a
# placeholder that doesn't fit, or one on a box that never shows it, fails before the push (Nov 9 2026:
# two builds failed on a date box's placeholder that this gate had no way to see).
if [ -n "$(find .next/static/media .next/dev/static/media -name '*.woff2' -print -quit 2>/dev/null)" ] && "$PY" -c "import fontTools" 2>/dev/null; then
  "$PY" scripts/audit_placeholders.py > /dev/null 2>&1 || { echo "FAILED audit_placeholders.py"; "$PY" scripts/audit_placeholders.py 2>&1 | tail -20; exit 1; }
else
  echo "   audit_placeholders.py not run: no built font in .next, or no fontTools. The deploy's build runs it."
fi
took

echo "== 5/6 eslint on the changed files"
lintable=$( { git diff --name-only --relative "$base" 2>/dev/null; git ls-files --others --exclude-standard; } | sort -u | grep -E '^(src|convex)/.*\.(ts|tsx|mjs|js)$' | while read -r f; do [ -f "$f" ] && echo "$f"; done || true)
if [ -n "$lintable" ]; then
  # --no-warn-ignored: a changed file eslint is told to skip (convex/_generated) is no warning of ours.
  # shellcheck disable=SC2086
  pnpm exec eslint --cache --cache-location node_modules/.cache/eslint --no-warn-ignored $lintable
else
  echo "   nothing to lint"
fi
took

echo "== 6/6 vitest: the whole suite, shuffled"
# The whole suite, every push (Nov 24 2026): on the new Mac it takes about a minute, less than the four targeted runs
# it replaced (tests affected since the base, tests naming a changed file, the tree-walking gates, the article tests:
# 77 s), and it can't miss a test that reads a file as text. Shuffled, as GitHub's run is (vitest.config.ts shuffles
# only when CI is set): Nov 10 2026, a test that passed in its written order here failed there. A failure prints its
# seed: rerun that file with --sequence.shuffle --sequence.seed=<seed> to see the same order.
pnpm exec vitest run --sequence.shuffle
took
echo "== passed in $(( $(date +%s) - t0 ))s"
