set -euo pipefail
test "$(bash scripts/forward.sh "two words" x)" = "two words|x"
bash -n 'scripts/forward.sh'
