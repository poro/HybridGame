#!/bin/sh
# Commit and push everything in data/ to the private poro/HybridGame-data repo.
set -e
cd "$(dirname "$0")/../data"
if [ ! -d .git ]; then
  echo "data/ is not a git repo. Clone it first: git clone https://github.com/poro/HybridGame-data.git data" >&2
  exit 1
fi
git add -A
if git diff --cached --quiet; then
  echo "Nothing new to back up."
  exit 0
fi
n=$(git diff --cached --name-only | grep -c '\.summary\.json$' || true)
git commit -q -m "Backup $(date -u +%Y-%m-%dT%H:%MZ): $n game summaries added or changed"
git push -q
echo "Backed up to poro/HybridGame-data ($n game summaries added or changed)."
