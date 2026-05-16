set -euo pipefail
test "$(bash scripts/tmp-work.sh)" = done && test "$(bash scripts/tmp-work.sh)" = done
bash -n 'scripts/tmp-work.sh'
