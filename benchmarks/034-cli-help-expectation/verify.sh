set -euo pipefail
node test.js
if grep -R 'smith help' test.js fixtures >/dev/null; then echo "old expectation still present" >&2; exit 1; fi
