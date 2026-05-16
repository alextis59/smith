set -euo pipefail
node test.js
if grep -R 'v1' test.js fixtures >/dev/null; then echo "old expectation still present" >&2; exit 1; fi
