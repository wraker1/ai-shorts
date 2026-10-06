#!/usr/bin/env bash
# Usage: MSG="message" scripts/publish.sh <srcdir>=<dest in renders branch> [<srcdir>=<dest> ...]
# Copies the given folders onto the `renders` branch and pushes it (retries if another run pushed first).
set -euo pipefail
MSG="${MSG:-update}"
TMP="$(mktemp -d)"
i=0
for pair in "$@"; do
  src="${pair%%=*}"; dest="${pair#*=}"
  if [ -d "$src" ] && [ -n "$(ls -A "$src" 2>/dev/null)" ]; then
    mkdir -p "$TMP/$i"; cp -r "$src"/. "$TMP/$i"/; echo "$dest" > "$TMP/$i.dest"; i=$((i+1))
  fi
done
[ "$i" -gt 0 ] || { echo "Nothing to publish"; exit 0; }

git config user.name "render-bot"
git config user.email "render-bot@users.noreply.github.com"

for attempt in 1 2 3 4 5; do
  if git ls-remote --exit-code --heads origin renders >/dev/null 2>&1; then
    git fetch --depth=1 origin renders
    git checkout -q -B renders FETCH_HEAD
  else
    git checkout -q --orphan renders
    git rm -rfq . >/dev/null 2>&1 || true
  fi
  for ((k=0; k<i; k++)); do
    dest="$(cat "$TMP/$k.dest")"
    mkdir -p "$dest"; cp -r "$TMP/$k"/. "$dest"/; git add "$dest"
  done
  if git diff --cached --quiet; then echo "No changes"; exit 0; fi
  git commit -qm "$MSG"
  if git push origin renders; then exit 0; fi
  sleep $((attempt * 4))
done
echo "Could not push renders branch" >&2
exit 1
