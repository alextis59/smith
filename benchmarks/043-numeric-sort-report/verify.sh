set -euo pipefail
printf '10\n2\n1\n' > counts.txt && test "$(bash scripts/sort-counts.sh counts.txt)" = "$(printf '1\n2\n10')"
bash -n 'scripts/sort-counts.sh'
