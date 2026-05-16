set -euo pipefail
printf '#hide\nkeep\n' > input.txt && test "$(bash scripts/filter.sh input.txt)" = keep
bash -n 'scripts/filter.sh'
