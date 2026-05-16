set -euo pipefail
mkdir -p logs && printf 'ERROR a\nINFO b\n' > logs/a.log && printf 'ERROR c\n' > logs/b.log && test "$(bash scripts/log-rollup.sh)" = 2
bash -n 'scripts/log-rollup.sh'
