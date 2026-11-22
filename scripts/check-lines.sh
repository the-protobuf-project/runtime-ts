#!/usr/bin/env bash
# Fails when a hand-written source file is longer than 200 lines.
# Generated code (examples/*/gen, *.pb.go) is exempt.
set -euo pipefail
cd "$(dirname "$0")/.."
limit=200
status=0
while IFS= read -r file; do
  [[ -f "$file" ]] || continue
  lines=$(wc -l < "$file" | tr -d ' ')
  if (( lines > limit )); then
    echo "$file: $lines lines (limit $limit)"
    status=1
  fi
done < <(git ls-files --cached --others --exclude-standard -- '*.ts' '*.sh' \
  | grep -v -E '(^|/)node_modules/|(^|/)dist/')
exit $status
